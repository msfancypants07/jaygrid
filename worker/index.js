const page = __PAGE_HTML__;
const styles = __PAGE_CSS__;
const client = __PAGE_JS__;
const icon = __PAGE_ICON__;
const TERM_PATTERN = /^(Spring|Summer|Fall) 20\d{2}$/;
const SEARCH_TTL = 15 * 60 * 1000;
const CONFIG_TTL = 10 * 60 * 1000;
const searchCache = new Map();
const watchSearchCache = new Map();
const historyCache = new Map();
let configCache = null;
let termsCache = null;

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
async function publishedTerms() {
  if (termsCache && termsCache.expires > Date.now()) return termsCache.value;
  const config = await getConfig();
  const url = new URL(`https://${config.typesenseNearestNode}/collections/${encodeURIComponent(config.typesenseSchemaName)}/documents/search`);
  for (const [key, value] of Object.entries({ q: '*', query_by: 'Title', facet_by: 'Term_JSS', max_facet_values: '250', per_page: '1' })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { 'X-TYPESENSE-API-KEY': config.typesenseApiKey, accept: 'application/json' } });
  if (!response.ok) throw new Error(`Course terms unavailable (${response.status})`);
  const raw = await response.json();
  const facet = raw.facet_counts?.find(item => item.field_name === 'Term_JSS');
  if (!facet) throw new Error('Course terms unavailable');
  const seasonOrder = { Spring: 0, Summer: 1, Fall: 2 };
  const terms = facet.counts.map(item => item.value).filter(term => TERM_PATTERN.test(term))
    .sort((a, b) => Number(b.slice(-4)) - Number(a.slice(-4)) || seasonOrder[b.split(' ')[0]] - seasonOrder[a.split(' ')[0]]);
  termsCache = { value: terms, expires: Date.now() + 60 * 60 * 1000 };
  return terms;
}
async function typesenseSearch(config, params) {
  const url = new URL(`https://${config.typesenseNearestNode}/collections/${encodeURIComponent(config.typesenseSchemaName)}/documents/search`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { 'X-TYPESENSE-API-KEY': config.typesenseApiKey, accept: 'application/json' } });
  if (!response.ok) throw new Error(`Course search unavailable (${response.status})`);
  return response.json();
}
async function courseHistory(code, config) {
  const cached = historyCache.get(code);
  if (cached && cached.expires > Date.now()) return cached.value;
  const today = new Date().toISOString().slice(0, 10);
  const byTerm = new Map(); let complete = false;
  for (let page = 1; page <= 4; page++) {
    const raw = await typesenseSearch(config, { q: '*', query_by: 'Title', filter_by: `OfferingName:=\`${code}\``, sort_by: 'TermStartDate:desc', per_page: 250, page });
    for (const hit of raw.hits || []) {
      const doc = hit.document || {}, term = String(doc.Term || doc.Term_JSS?.[0] || ''), date = String(doc.TermStartDate || '').slice(0, 10);
      if (!/^20\d\d-\d\d-\d\d$/.test(date) || !/^(Spring|Summer|Fall|Intersession|Winter) 20\d{2}$/.test(term)) continue;
      if (!byTerm.has(term)) byTerm.set(term, { term, date, title: String(doc.Title || ''), description: String(doc.Description || doc.SectionDetails?.Description || '').trim() });
      else if (!byTerm.get(term).description) byTerm.get(term).description = String(doc.Description || doc.SectionDetails?.Description || '').trim();
    }
    if (Array.from(byTerm.values()).filter(item => item.date <= today).length >= 5 || page * 250 >= Number(raw.found || 0)) { complete = true; break; }
  }
  const all = Array.from(byTerm.values()).sort((a, b) => b.date.localeCompare(a.date));
  const past = all.filter(item => item.date <= today).slice(0, 5);
  const upcoming = all.filter(item => item.date > today).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const described = [...past, ...all.filter(item => item.date > today)].find(item => item.description);
  const value = { code, title: past[0]?.title || upcoming?.title || '', description: described?.description || '', descriptionTerm: described?.term || '', history: past.map(({ term, date }) => ({ term, date })),
    upcoming: upcoming ? { term: upcoming.term, date: upcoming.date } : null, historyComplete: complete };
  historyCache.set(code, { value, expires: Date.now() + 60 * 60 * 1000 });
  while (historyCache.size > 200) historyCache.delete(historyCache.keys().next().value);
  return value;
}
async function discoverWatchCourses(query) {
  const q = query.trim(), key = q.toLowerCase();
  const cached = watchSearchCache.get(key);
  if (cached && cached.expires > Date.now()) return { ...cached.value, cache: 'server' };
  const config = await getConfig(), codeQuery = /^[A-Za-z]{2}\.\d{3}\.\d{3}$/.test(q) ? q.toUpperCase() : null;
  const codes = [];
  let truncated = false;
  if (codeQuery) codes.push(codeQuery);
  else {
    const seen = new Set();
    for (let page = 1; page <= 3 && codes.length < 12; page++) {
      const raw = await typesenseSearch(config, { q, query_by: 'Title,OfferingName,OfferingVariations,InstructorsFullName',
        sort_by: '_text_match:desc,TermStartDate:desc', per_page: 250, page });
      for (const hit of raw.hits || []) {
        const code = String(hit.document?.OfferingName || '').toUpperCase();
        if (/^[A-Z]{2}\.\d{3}\.\d{3}$/.test(code) && !seen.has(code)) { seen.add(code); codes.push(code); }
        if (codes.length >= 12) break;
      }
      if (codes.length >= 12) { truncated = Number(raw.found || 0) > page * 250 || seen.size >= 12; break; }
      if (page * 250 >= Number(raw.found || 0)) break;
      if (page === 3) truncated = true;
    }
  }
  const results = [];
  for (let start = 0; start < codes.length; start += 4) {
    const batch = await Promise.all(codes.slice(start, start + 4).map(code => courseHistory(code, config)));
    results.push(...batch.filter(item => item.title));
  }
  const value = { query: q, results, truncated, fetchedAt: new Date().toISOString(), cache: 'live' };
  watchSearchCache.set(key, { value, expires: Date.now() + SEARCH_TTL });
  while (watchSearchCache.size > 50) watchSearchCache.delete(watchSearchCache.keys().next().value);
  return value;
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (url.pathname === '/') return staticResponse(page, 'text/html; charset=utf-8');
    if (url.pathname === '/styles.css') return staticResponse(styles, 'text/css; charset=utf-8');
    if (url.pathname === '/app.js') return staticResponse(client, 'text/javascript; charset=utf-8');
    if (url.pathname === '/favicon.svg') return staticResponse(icon, 'image/svg+xml; charset=utf-8');
    if (url.pathname === '/api/terms') {
      try { return json({ terms: await publishedTerms() }); }
      catch { return json({ error: 'Could not check published JHU semesters.' }, 502); }
    }
    if (url.pathname === '/api/watch-search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2 || q.length > 80) return json({ error: 'Enter a course title or code with 2–80 characters.' }, 400);
      try { return json(await discoverWatchCourses(q)); }
      catch { return json({ error: 'JHU course search is temporarily unavailable.' }, 502); }
    }
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
