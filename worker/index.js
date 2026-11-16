const page = __PAGE_HTML__;
const styles = __PAGE_CSS__;
const client = __PAGE_JS__;
const TERM_PATTERN = /^(Spring|Summer|Fall) 20\d{2}$/;
const SEARCH_TTL = 15 * 60 * 1000;
const CONFIG_TTL = 10 * 60 * 1000;
const searchCache = new Map();
let configCache = null;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
function staticResponse(body, type) {
  return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
}
function parseDayString(value) {
  const text = String(value || '').replace(/[^A-Za-z]/g, '');
  const days = [];
  for (let i = 0; i < text.length;) {
    const part = text.slice(i);
    if (/^Th/i.test(part)) { days.push('Th'); i += 2; }
    else if (/^Tu/i.test(part)) { days.push('Tu'); i += 2; }
    else if (/^M/i.test(part)) { days.push('M'); i++; }
    else if (/^T/i.test(part)) { days.push('Tu'); i++; }
    else if (/^W/i.test(part)) { days.push('W'); i++; }
    else if (/^R/i.test(part)) { days.push('Th'); i++; }
    else if (/^F/i.test(part)) { days.push('F'); i++; }
    else if (/^(Sa|Su)/i.test(part)) { i += 2; }
    else i++;
  }
  return [...new Set(days)];
}
function parseTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let h = Number(match[1]); const m = Number(match[2]);
  if (m > 59 || h > 23) return null;
  if (match[3]) { if (h < 1 || h > 12) return null; h = h % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0); }
  return `${String(h).padStart(2, '0')}:${match[2]}`;
}
function isoDate(value) {
  const match = String(value || '').match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : null;
}
function normalizeMeeting(m) {
  const days = parseDayString(m.DOW);
  const times = String(m.Times || '').split(/\s+-\s+/);
  const dates = String(m.Dates || '').split(/\s+to\s+/i);
  const start = parseTime(times[0]); const end = parseTime(times[1]);
  const firstDate = isoDate(dates[0]); const lastDate = isoDate(dates[1]);
  if (!days.length || !start || !end || !firstDate || !lastDate || start >= end) return null;
  return { days, start, end, firstDate, lastDate, location: String(m.Building || '') };
}
function normalizeCourse(doc) {
  const rawMeetings = doc.SectionDetails?.Meetings || [];
  const meetings = Array.isArray(rawMeetings) ? rawMeetings.map(normalizeMeeting).filter(Boolean) : [];
  return {
    sourceId: String(doc.SSS_SectionsID || doc.id || ''),
    title: String(doc.Title || ''), code: String(doc.OfferingName || ''),
    section: String(doc.SectionName || ''), instructor: String(doc.InstructorsFullName || ''),
    credits: Number(doc.Credits) || 0, status: String(doc.Status || ''),
    location: String(doc.Location || ''), meetings,
  };
}
async function getConfig() {
  if (configCache && configCache.expires > Date.now()) return configCache.value;
  const response = await fetch('https://api.sis.jhu.edu/api/coursesearch/configuration', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Configuration unavailable (${response.status})`);
  const payload = await response.json();
  const value = payload.data;
  if (!value?.typesenseNearestNode || !value?.typesenseApiKey || !value?.typesenseSchemaName) throw new Error('Invalid search configuration');
  configCache = { value, expires: Date.now() + CONFIG_TTL };
  return value;
}
async function search(q, page, term, refresh = false) {
  const key = `${term}|${q.toLowerCase()}|${page}`;
  const cached = searchCache.get(key);
  if (!refresh && cached && cached.expires > Date.now()) return { ...cached.value, cache: 'server' };
  const config = await getConfig();
  const courseCode = /^[A-Za-z]{2}\.\d{3}\.\d{3}$/.test(q) ? q.toUpperCase() : null;
  const url = new URL(`https://${config.typesenseNearestNode}/collections/${encodeURIComponent(config.typesenseSchemaName)}/documents/search`);
  url.searchParams.set('q', courseCode ? '*' : q);
  url.searchParams.set('query_by', 'Title,OfferingName,OfferingVariations,SectionName,InstructorsFullName');
  url.searchParams.set('filter_by', `Term_JSS:=[\`${term}\`]${courseCode ? ` && OfferingName:=\`${courseCode}\`` : ''}`);
  url.searchParams.set('sort_by', '_text_match:desc,OfferingName:asc,SectionName:asc');
  url.searchParams.set('per_page', '30');
  url.searchParams.set('page', String(page));
  const response = await fetch(url, { headers: { 'X-TYPESENSE-API-KEY': config.typesenseApiKey, accept: 'application/json' } });
  if (!response.ok) throw new Error(`Course search unavailable (${response.status})`);
  const raw = await response.json();
  const value = { query: q, term, page, perPage: 30, found: Number(raw.found) || 0,
    results: (raw.hits || []).map(hit => normalizeCourse(hit.document || {})),
    fetchedAt: new Date().toISOString(), cache: 'live' };
  searchCache.set(key, { value, expires: Date.now() + SEARCH_TTL });
  while (searchCache.size > 60) searchCache.delete(searchCache.keys().next().value);
  return value;
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (url.pathname === '/') return staticResponse(page, 'text/html; charset=utf-8');
    if (url.pathname === '/styles.css') return staticResponse(styles, 'text/css; charset=utf-8');
    if (url.pathname === '/app.js') return staticResponse(client, 'text/javascript; charset=utf-8');
    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      const term = url.searchParams.get('term') || 'Spring 2027';
      const pageNumber = Number(url.searchParams.get('page') || 1);
      if (q.length < 2 || q.length > 80 || !TERM_PATTERN.test(term) || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 20) return json({ error: 'Enter a query of 2–80 characters, a valid semester, and a page from 1–20.' }, 400);
      try { return json(await search(q, pageNumber, term, url.searchParams.get('refresh') === '1')); }
      catch (error) { return json({ error: 'JHU course search is temporarily unavailable. You can still add a section manually.' }, 502); }
    }
    return new Response('Not found', { status: 404 });
  },
};
