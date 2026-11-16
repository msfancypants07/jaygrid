const PLAN_KEY = 'springboard-jhu-spring-2027-v1';
const CACHE_KEY = 'springboard-search-cache-v2';
const CACHE_TTL = 30 * 60 * 1000;
const dayNames = { M: 'Mon', Tu: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri' };
const dayOrder = Object.keys(dayNames);
const colors = [['#d7ebe8', '#188679'], ['#deebf4', '#397aa4'], ['#f7ead8', '#b58243'], ['#ebe4f3', '#8266a9'], ['#e7efdc', '#74924c']];
const searchState = { query: '', page: 0, found: 0, results: [], loading: false };
let searchRequestId = 0;
let entries = loadPlan();
let guestEntries = entries;
let recent = loadCache();
let account = null;
let cloudVersion = 0;
let savingPlan = false;

function validMeeting(m) {
  return m && Array.isArray(m.days) && m.days.length > 0 && m.days.every(d => dayOrder.includes(d)) &&
    /^\d\d:\d\d$/.test(m.start || '') && /^\d\d:\d\d$/.test(m.end || '') &&
    /^2027-\d\d-\d\d$/.test(m.firstDate || '') && /^2027-\d\d-\d\d$/.test(m.lastDate || '') &&
    m.start < m.end && m.firstDate <= m.lastDate;
}
function normalizeEntry(e) {
  if (!e || typeof e.title !== 'string' || typeof e.code !== 'string') return null;
  const meetings = Array.isArray(e.meetings) ? e.meetings.filter(validMeeting) :
    validMeeting(e) ? [{ days: e.days, start: e.start, end: e.end, firstDate: e.firstDate, lastDate: e.lastDate, location: e.location || '' }] : [];
  if (!meetings.length && !e.sourceId) return null;
  return { id: e.id || crypto.randomUUID(), sourceId: e.sourceId || '', title: e.title, code: e.code,
    section: e.section || '', instructor: e.instructor || '', credits: Number(e.credits) || 0,
    status: e.status || 'Planning', meetings };
}
function loadPlan() { try { const value = JSON.parse(localStorage.getItem(PLAN_KEY) || '[]'); return Array.isArray(value) ? value.map(normalizeEntry).filter(Boolean) : []; } catch { return []; } }
async function savePlan(nextEntries) {
  if (savingPlan) return false;
  if (!account) {
    entries = nextEntries; guestEntries = nextEntries;
    localStorage.setItem(PLAN_KEY, JSON.stringify(entries)); render();
    return true;
  }
  savingPlan = true;
  const status = document.getElementById('auth-status');
  status.textContent = 'Saving to your account…';
  try {
    const response = await fetch('/api/plan', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: nextEntries, version: cloudVersion }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save your plan.');
    cloudVersion = data.version; entries = nextEntries; render();
    status.textContent = 'Saved to your account. Registration happens in SIS.';
    return true;
  } catch (error) {
    status.textContent = error.message || 'Could not save your plan.';
    return false;
  } finally { savingPlan = false; }
}
function loadCache() { try { const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); return Array.isArray(value) ? value.filter(x => x && x.when + CACHE_TTL > Date.now() && Array.isArray(x.data?.results) && x.data.query?.trim().toLowerCase() === x.query?.trim().toLowerCase() && x.data.page === x.page && x.data.term === 'Spring 2027').slice(0, 20) : []; } catch { return []; } }
function cacheKey(q, page) { return `${q.trim().toLowerCase()}|${page}`; }
function cacheResult(q, page, data) {
  const key = cacheKey(q, page); recent = recent.filter(x => x.key !== key);
  recent.unshift({ key, query: q.trim(), page, when: Date.now(), data }); recent = recent.slice(0, 20);
  localStorage.setItem(CACHE_KEY, JSON.stringify(recent)); renderRecent();
}
function renderRecent() {
  const el = document.getElementById('recent-searches'); el.replaceChildren();
  const queries = [...new Set(recent.filter(x => x.page === 1).map(x => x.query))].slice(0, 5);
  el.hidden = !queries.length;
  for (const q of queries) { const button = document.createElement('button'); button.type = 'button'; button.textContent = q;
    button.onclick = () => { document.getElementById('catalog-query').value = q; doSearch(q); }; el.append(button); }
}
function text(el, value) { el.textContent = value; return el; }
function minutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function pretty(t) { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; }
function meetingLabel(m) { return `${m.days.map(d => dayNames[d]).join(', ')} · ${pretty(m.start)}–${pretty(m.end)}`; }
function overlaps(a, b) { return a.firstDate <= b.lastDate && b.firstDate <= a.lastDate &&
  a.days.some(d => b.days.includes(d)) && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end); }
function conflictIds() { const ids = new Set(); for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++)
  if (entries[i].meetings.some(a => entries[j].meetings.some(b => overlaps(a, b)))) { ids.add(entries[i].id); ids.add(entries[j].id); } return ids; }

function render() {
  const list = document.getElementById('course-list'), conflicts = conflictIds(); list.replaceChildren();
  const credits = entries.reduce((n, e) => n + e.credits, 0);
  document.getElementById('summary').textContent = entries.length ? `${entries.length} section${entries.length === 1 ? '' : 's'} · ${credits.toLocaleString()} credits` : 'No sections added yet.';
  if (!entries.length) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.innerHTML = '<span>◇</span>No courses yet.'; list.append(empty); }
  for (const e of entries) {
    const card = document.createElement('article'); card.className = 'course-card'; const top = document.createElement('div'); top.className = 'course-card-top';
    const content = document.createElement('div'), code = document.createElement('div'), title = document.createElement('div');
    code.className = 'course-code'; title.className = 'course-title'; text(code, `${e.code}${e.section ? ' · ' + e.section : ''}`); text(title, e.title);
    content.append(code, title); top.append(content);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'remove-button'; del.setAttribute('aria-label', `Remove ${e.title}`); del.textContent = '×';
    del.onclick = async () => { await savePlan(entries.filter(x => x.id !== e.id)); }; top.append(del); card.append(top);
    if (!e.meetings.length) { const meta = document.createElement('div'); meta.className = 'course-meta'; text(meta, 'No scheduled meeting time'); card.append(meta); }
    for (const m of e.meetings) { const meta = document.createElement('div'); meta.className = 'course-meta'; text(meta, `${meetingLabel(m)}${m.location ? ' · ' + m.location : ''}`); card.append(meta); }
    if (e.instructor) { const instructor = document.createElement('div'); instructor.className = 'course-meta'; text(instructor, e.instructor); card.append(instructor); }
    const chip = document.createElement('span'); chip.className = 'status-chip'; text(chip, conflicts.has(e.id) ? 'Time conflict' : e.status); card.append(chip); list.append(card);
  }
  document.getElementById('download-ics').disabled = !entries.some(e => e.meetings.length); document.getElementById('download-json').disabled = !entries.length;
  const banner = document.getElementById('conflict-banner'); banner.hidden = !conflicts.size;
  if (conflicts.size) banner.textContent = `⚠ ${conflicts.size} sections overlap in time. Review the highlighted blocks.`;
  renderCalendar(conflicts); renderSearchResults();
}
function renderCalendar(conflicts) {
  const allMeetings = entries.flatMap(e => e.meetings);
  const min = Math.min(8 * 60, ...allMeetings.map(m => Math.floor(minutes(m.start) / 60) * 60));
  const max = Math.max(21 * 60, ...allMeetings.map(m => Math.ceil(minutes(m.end) / 60) * 60));
  const span = max - min, col = document.getElementById('day-columns'), time = document.getElementById('time-col');
  col.replaceChildren(); time.replaceChildren();
  const step = 563 / (span / 60); col.style.backgroundImage = `repeating-linear-gradient(to bottom, transparent 0, transparent ${step - 1}px, #e7ecef ${step - 1}px, #e7ecef ${step}px)`;
  for (let h = min / 60; h <= max / 60; h++) { const label = document.createElement('div'); label.className = 'time-label'; label.style.top = `${37 + (h * 60 - min) / span * 563}px`; text(label, `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`); time.append(label); }
  dayOrder.forEach(day => {
    const column = document.createElement('div'); column.className = 'day-column'; const head = document.createElement('div'); head.className = 'day-head'; text(head, dayNames[day].toUpperCase()); column.append(head);
    const meetings = entries.flatMap((e, index) => e.meetings.filter(m => m.days.includes(day) && minutes(m.end) > min && minutes(m.start) < max).map(m => ({ e, m, index })));
    meetings.forEach(({ e, m, index }) => {
      const start = Math.max(min, minutes(m.start)), end = Math.min(max, minutes(m.end));
      const simultaneous = meetings.filter(({ m: other }) => minutes(m.start) < minutes(other.end) && minutes(other.start) < minutes(m.end));
      const lane = simultaneous.findIndex(item => item.e.id === e.id && item.m === m), count = simultaneous.length;
      const block = document.createElement('div'); block.className = 'class-block' + (conflicts.has(e.id) ? ' conflict' : '');
      block.style.top = `${37 + (start - min) / span * 563}px`; block.style.height = `${Math.max(28, (end - start) / span * 563)}px`;
      if (count > 1) { block.style.width = `calc(${100 / count}% - 6px)`; block.style.left = `calc(${lane * 100 / count}% + 3px)`; block.style.right = 'auto'; }
      const palette = colors[index % colors.length]; if (!conflicts.has(e.id)) { block.style.background = palette[0]; block.style.borderLeftColor = palette[1]; }
      const name = document.createElement('strong'), detail = document.createElement('span'); text(name, e.code); text(detail, `${pretty(m.start)}–${pretty(m.end)}`); block.append(name, detail);
      block.title = `${e.title} (${e.code})`; column.append(block);
    }); col.append(column);
  });
  if (!entries.length) { const empty = document.createElement('div'); empty.className = 'empty-calendar'; text(empty, 'No classes added.'); col.append(empty); }
}
function renderSearchResults() {
  const el = document.getElementById('search-results'); el.replaceChildren();
  for (const course of searchState.results) {
    const card = document.createElement('article'); card.className = 'result-card'; const top = document.createElement('div'); top.className = 'result-top';
    const info = document.createElement('div'), title = document.createElement('div'), code = document.createElement('div');
    title.className = 'result-title'; code.className = 'result-code'; text(title, course.title); text(code, `${course.code} · ${course.section || '—'}`); info.append(title, code); top.append(info);
    const add = document.createElement('button'); add.type = 'button'; add.className = 'result-add';
    const already = entries.some(e => e.sourceId && e.sourceId === course.sourceId);
    add.disabled = already; add.textContent = already ? 'Added' : '+ Add';
    add.onclick = async () => { const entry = normalizeEntry({ ...course, id: crypto.randomUUID(), status: 'Planning' }); if (entry) await savePlan([...entries, entry]); };
    top.append(add); card.append(top);
    const meta = document.createElement('div'); meta.className = 'result-meta'; text(meta, `${course.instructor || 'Instructor TBA'} · ${course.credits} credits · ${course.status || 'Status unknown'}`); card.append(meta);
    for (const m of course.meetings) { const time = document.createElement('div'); time.className = 'result-time'; text(time, meetingLabel(m)); card.append(time); }
    if (!course.meetings.length) { const noTime = document.createElement('div'); noTime.className = 'result-time'; text(noTime, 'No scheduled meeting time'); card.append(noTime); }
    el.append(card);
  }
  document.getElementById('load-more').hidden = !searchState.query || searchState.results.length >= searchState.found || searchState.page >= 20;
}
async function doSearch(query, page = 1, refresh = false) {
  const q = query.trim(), status = document.getElementById('search-status'); if (q.length < 2) { status.textContent = 'Enter at least 2 characters.'; return; }
  const requestId = ++searchRequestId;
  searchState.loading = true; status.textContent = 'Searching JHU…';
  document.getElementById('load-more').disabled = true;
  document.getElementById('refresh-search').hidden = true;
  if (page === 1) { searchState.query = q; searchState.page = 0; searchState.found = 0; searchState.results = []; renderSearchResults(); }
  try {
    let data; const cached = !refresh && recent.find(x => x.key === cacheKey(q, page) && x.when + CACHE_TTL > Date.now() && x.data.query?.trim().toLowerCase() === q.toLowerCase() && x.data.page === page && x.data.term === 'Spring 2027');
    if (cached) data = cached.data;
    else { const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${page}${refresh ? '&refresh=1' : ''}`); data = await response.json(); if (!response.ok) throw new Error(data.error || 'Search unavailable');
      if (data.query?.trim().toLowerCase() !== q.toLowerCase() || data.page !== page || data.term !== 'Spring 2027' || !Array.isArray(data.results)) throw new Error('Search returned mismatched results. Try refreshing.');
      cacheResult(q, page, data); }
    if (requestId !== searchRequestId) return;
    searchState.query = q; searchState.page = page; searchState.found = data.found;
    searchState.results = page === 1 ? data.results : [...searchState.results, ...data.results];
    status.textContent = data.found ? `${searchState.results.length} of ${data.found} sections${cached ? ' · cached' : ''}` : `No Spring 2027 sections found for “${q}”.`;
    document.getElementById('refresh-search').hidden = false;
    renderSearchResults(); renderRecent();
  } catch (error) { if (requestId === searchRequestId) { status.textContent = error.message || 'Search unavailable'; document.getElementById('refresh-search').hidden = false; } }
  finally { if (requestId === searchRequestId) { searchState.loading = false; document.getElementById('load-more').disabled = false; } }
}
document.getElementById('official-search').addEventListener('submit', e => { e.preventDefault(); doSearch(document.getElementById('catalog-query').value); });
document.getElementById('load-more').onclick = () => doSearch(searchState.query, searchState.page + 1);
document.getElementById('refresh-search').onclick = () => doSearch(searchState.query || document.getElementById('catalog-query').value, 1, true);
document.getElementById('entry-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget, data = new FormData(f), days = data.getAll('days'), err = document.getElementById('form-error'); err.hidden = true;
  const start = String(data.get('start')), end = String(data.get('end')), firstDate = String(data.get('firstDate')), lastDate = String(data.get('lastDate'));
  if (!days.length) { err.textContent = 'Choose at least one meeting day.'; err.hidden = false; return; }
  if (start >= end || firstDate > lastDate) { err.textContent = 'Check the meeting time and dates.'; err.hidden = false; return; }
  const entry = normalizeEntry({ id: crypto.randomUUID(), title: String(data.get('title')).trim(), code: String(data.get('code')).trim().toUpperCase(),
    section: String(data.get('section')).trim(), instructor: String(data.get('instructor')).trim(), credits: Number(data.get('credits')) || 0,
    status: String(data.get('status')), meetings: [{ days, start, end, firstDate, lastDate, location: String(data.get('location')).trim() }] });
  if (!entry) { err.textContent = 'Enter a valid section and meeting.'; err.hidden = false; return; }
  if (await savePlan([...entries, entry])) { f.reset(); f.elements.start.value = '09:00'; f.elements.end.value = '10:15'; f.elements.firstDate.value = '2027-01-25'; f.elements.lastDate.value = '2027-04-30'; f.elements.title.focus(); }
});
function download(name, content, type) { const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
document.getElementById('download-json').onclick = () => download('spring-2027-plan.json', JSON.stringify({ term: 'Spring 2027', entries }, null, 2), 'application/json');
document.getElementById('import-json').onchange = async e => { const file = e.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); if (data.term !== 'Spring 2027' || !Array.isArray(data.entries)) throw Error('invalid'); const restored = data.entries.map(normalizeEntry); if (restored.some(x => !x)) throw Error('invalid'); await savePlan(restored.map(x => ({ ...x, id: crypto.randomUUID() }))); } catch { alert('This is not a valid Spring 2027 plan backup.'); } e.target.value = ''; };
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function icsStamp(date, time) { return `${date.replaceAll('-', '')}T${time.replace(':', '')}00`; }
function firstOnOrAfter(date, day) { const target = { M: 1, Tu: 2, W: 3, Th: 4, F: 5 }[day], d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (target - d.getUTCDay() + 7) % 7); return d.toISOString().slice(0, 10); }
document.getElementById('download-ics').onclick = () => {
  const by = { M: 'MO', Tu: 'TU', W: 'WE', Th: 'TH', F: 'FR' }, lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JayGrid//JHU Planner//EN', 'CALSCALE:GREGORIAN'];
  for (const e of entries) for (let i = 0; i < e.meetings.length; i++) for (const day of e.meetings[i].days) {
    const m = e.meetings[i], first = firstOnOrAfter(m.firstDate, day); if (first > m.lastDate) continue;
    lines.push('BEGIN:VEVENT', `UID:${e.id}-${i}-${day}@springboard.local`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART;TZID=America/New_York:${icsStamp(first, m.start)}`, `DTEND;TZID=America/New_York:${icsStamp(first, m.end)}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${m.lastDate.replaceAll('-', '')}T235959Z;BYDAY=${by[day]}`,
      `SUMMARY:${icsEscape(e.code + ' ' + e.title)}`, `LOCATION:${icsEscape(m.location)}`,
      `DESCRIPTION:${icsEscape('Section ' + (e.section || '—') + ' · Verify dates and exceptions in SIS.')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR'); download('spring-2027-classes.ics', lines.join('\r\n') + '\r\n', 'text/calendar');
};
const authButton = document.getElementById('auth-button');
const authStatus = document.getElementById('auth-status');
const importLocalButton = document.getElementById('import-local-plan');
authButton.onclick = async () => {
  if (!account) { location.href = '/auth/login'; return; }
  const response = await fetch('/api/signout', { method: 'POST' });
  if (!response.ok) { authStatus.textContent = 'Could not sign out. Try again.'; return; }
  account = null; cloudVersion = 0; entries = guestEntries;
  authButton.textContent = 'Sign in with Google';
  document.getElementById('storage-indicator').lastChild.textContent = ' Saved on this device';
  importLocalButton.hidden = true;
  authStatus.textContent = 'Signed out. Your account plan remains saved online.';
  render();
};
importLocalButton.onclick = async () => {
  if (!account || !guestEntries.length) return;
  const merged = [...entries];
  for (const local of guestEntries) {
    if (!merged.some(e => e.id === local.id || (e.sourceId && local.sourceId && e.sourceId === local.sourceId))) merged.push(local);
  }
  if (await savePlan(merged)) importLocalButton.hidden = true;
};
async function initAccount() {
  if (new URLSearchParams(location.search).has('auth_error')) {
    authStatus.textContent = 'Google sign-in did not finish. Please try again.';
    history.replaceState(null, '', location.pathname);
  }
  try {
    const response = await fetch('/api/account');
    const state = await response.json();
    if (!response.ok) throw new Error('Could not check sign-in status.');
    authButton.hidden = false;
    if (!state.configured) {
      authButton.disabled = true;
      authButton.title = 'Connect a Supabase project to enable sign-in';
      authStatus.textContent = 'Saved on this device. Cloud sign-in needs setup.';
      return;
    }
    if (!state.user) return;
    const planResponse = await fetch('/api/plan');
    const plan = await planResponse.json();
    if (!planResponse.ok || !Array.isArray(plan.entries)) throw new Error(plan.error || 'Could not load your cloud plan.');
    const restored = plan.entries.map(normalizeEntry);
    if (restored.some(x => !x)) throw new Error('Your cloud plan contains invalid data.');
    account = state.user; cloudVersion = plan.version; entries = restored;
    authButton.textContent = 'Sign out';
    authButton.title = state.user.email || 'Sign out';
    document.getElementById('storage-indicator').lastChild.textContent = ' Synced to your account';
    importLocalButton.hidden = !guestEntries.length;
    authStatus.textContent = `Signed in as ${state.user.email || 'your account'}. Registration happens in SIS.`;
    render();
  } catch (error) { authStatus.textContent = error.message || 'Could not load your account.'; }
}
renderRecent(); render(); initAccount();
