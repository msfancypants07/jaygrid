const OLD_PLAN_KEY = 'springboard-jhu-spring-2027-v1';
const PLANS_KEY = 'jaygrid-schedules-v1';
const TERM_KEY = 'jaygrid-selected-term';
const SCHEDULE_KEY = 'jaygrid-selected-schedules';
const CACHE_KEY = 'springboard-search-cache-v2';
const WATCHLIST_KEY = 'jaygrid-watchlist-v1';
const WATCH_TERM_KEY = 'jaygrid-watch-check-term';
const PANELS_KEY = 'jaygrid-hidden-panels';
const CACHE_TTL = 30 * 60 * 1000;
const dayNames = { M: 'Mon', Tu: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri' };
const dayOrder = Object.keys(dayNames);
const colors = [['#d7ebe8', '#188679'], ['#deebf4', '#397aa4'], ['#f7ead8', '#b58243'], ['#ebe4f3', '#8266a9'], ['#e7efdc', '#74924c']];
const searchState = { query: '', page: 0, found: 0, results: [], loading: false };
let searchRequestId = 0;
const terms = Array.from({ length: 16 }, (_, i) => 2020 + i).flatMap(year => ['Spring', 'Summer', 'Fall'].map(season => `${season} ${year}`));
let selectedTerm = terms.includes(localStorage.getItem(TERM_KEY)) ? localStorage.getItem(TERM_KEY) : 'Spring 2027';
let guestPlans = loadGuestPlans();
let selectedScheduleIds = loadScheduleIds();
let schedules = guestPlans[selectedTerm] || defaultSchedules();
let selectedScheduleId = selectedScheduleIds[selectedTerm] || schedules[0].id;
let entries = schedules.find(s => s.id === selectedScheduleId)?.entries || schedules[0].entries;
let recent = loadCache();
let account = null;
let cloudVersion = 0;
let savingPlan = false;
let loadingTerm = false;
const importedLocalKeys = new Set();
let guestWatchlist = loadGuestWatchlist();
let watchlist = guestWatchlist;
let watchVersion = 0;
let watchReady = true;
let watchSaving = false;
let watchChecking = false;
let watchLoadError = '';
let publishedTerms = null;
let selectedWatchTerm = terms.includes(localStorage.getItem(WATCH_TERM_KEY)) ? localStorage.getItem(WATCH_TERM_KEY) : selectedTerm;
const watchSearch = { query: '', results: [], truncated: false };
let watchSearchRequestId = 0;
const watchErrors = new Set();
const noteDrafts = new Map();

function validMeeting(m) {
  return m && Array.isArray(m.days) && m.days.length > 0 && m.days.every(d => dayOrder.includes(d)) &&
    /^\d\d:\d\d$/.test(m.start || '') && /^\d\d:\d\d$/.test(m.end || '') &&
    /^20\d\d-\d\d-\d\d$/.test(m.firstDate || '') && /^20\d\d-\d\d-\d\d$/.test(m.lastDate || '') &&
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
function defaultSchedules() { return [{ id: 'default', name: 'Schedule 1', entries: [] }]; }
function normalizeSchedules(value) {
  if (!Array.isArray(value) || !value.length) return defaultSchedules();
  if (!value.every(s => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.entries))) return null;
  const result = value.map(s => ({ id: s.id, name: s.name, entries: s.entries.map(normalizeEntry) }));
  return result.some(s => s.entries.some(e => !e)) ? null : result;
}
function loadGuestPlans() {
  let value = {};
  try { value = JSON.parse(localStorage.getItem(PLANS_KEY) || '{}'); } catch { /* use legacy plan */ }
  const plans = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const [term, saved] of Object.entries(value)) {
    const normalized = normalizeSchedules(saved); if (terms.includes(term) && normalized) plans[term] = normalized;
  }
  if (!plans['Spring 2027']) {
    try { const old = JSON.parse(localStorage.getItem(OLD_PLAN_KEY) || '[]');
      if (Array.isArray(old)) plans['Spring 2027'] = [{ id: 'default', name: 'Schedule 1', entries: old.map(normalizeEntry).filter(Boolean) }];
    } catch { /* no legacy plan */ }
  }
  return plans;
}
function loadScheduleIds() { try { const value = JSON.parse(localStorage.getItem(SCHEDULE_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } }
function setSchedules(next) {
  schedules = next;
  if (!schedules.some(s => s.id === selectedScheduleId)) selectedScheduleId = schedules[0].id;
  entries = schedules.find(s => s.id === selectedScheduleId).entries;
  selectedScheduleIds[selectedTerm] = selectedScheduleId;
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(selectedScheduleIds));
  render();
}
async function commitSchedules(nextSchedules) {
  if (savingPlan || loadingTerm) return false;
  if (!account) {
    guestPlans[selectedTerm] = nextSchedules;
    localStorage.setItem(PLANS_KEY, JSON.stringify(guestPlans));
    setSchedules(nextSchedules);
    return true;
  }
  savingPlan = true;
  document.getElementById('term-select').disabled = true;
  const status = document.getElementById('auth-status');
  status.textContent = 'Saving to your account…';
  try {
    const response = await fetch(`/api/plan?term=${encodeURIComponent(selectedTerm)}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedules: nextSchedules, version: cloudVersion }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save your plan.');
    cloudVersion = data.version; setSchedules(nextSchedules);
    status.textContent = 'Saved to your account. Registration happens in SIS.';
    return true;
  } catch (error) {
    status.textContent = error.message || 'Could not save your plan.';
    return false;
  } finally { savingPlan = false; document.getElementById('term-select').disabled = false; renderScheduleControls(); }
}
async function savePlan(nextEntries) { return commitSchedules(schedules.map(s => s.id === selectedScheduleId ? { ...s, entries: nextEntries } : s)); }
function loadCache() { try { const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); return Array.isArray(value) ? value.filter(x => x && x.when + CACHE_TTL > Date.now() && Array.isArray(x.data?.results) && x.data.query?.trim().toLowerCase() === x.query?.trim().toLowerCase() && x.data.page === x.page && terms.includes(x.data.term)).slice(0, 20) : []; } catch { return []; } }
function cacheKey(q, page, term = selectedTerm) { return `${term}|${q.trim().toLowerCase()}|${page}`; }
function cacheResult(q, page, data) {
  const key = cacheKey(q, page, data.term); recent = recent.filter(x => x.key !== key);
  recent.unshift({ key, query: q.trim(), page, when: Date.now(), data }); recent = recent.slice(0, 20);
  localStorage.setItem(CACHE_KEY, JSON.stringify(recent)); renderRecent();
}
function renderRecent() {
  const el = document.getElementById('recent-searches'); el.replaceChildren();
  const queries = [...new Set(recent.filter(x => x.page === 1 && x.data.term === selectedTerm).map(x => x.query))].slice(0, 5);
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

const termSelect = document.getElementById('term-select');
for (const term of terms) { const option = document.createElement('option'); option.value = term; option.textContent = term; termSelect.append(option); }
function scheduleName() { return schedules.find(s => s.id === selectedScheduleId)?.name || 'Schedule 1'; }
function manualDates() {
  const year = Number(selectedTerm.slice(-4)), season = selectedTerm.split(' ')[0];
  return season === 'Spring' ? [`${year}-01-20`, `${year}-05-15`] : season === 'Summer' ? [`${year}-05-20`, `${year}-08-15`] : [`${year}-08-20`, `${year}-12-20`];
}
function setManualDates() {
  const [first, last] = manualDates(), form = document.getElementById('entry-form');
  form.elements.firstDate.value = first; form.elements.lastDate.value = last;
}
function renderTerm() {
  termSelect.value = selectedTerm;
  document.getElementById('search-label').textContent = `${selectedTerm} courses`;
  const href = `https://courses.jhu.edu/?terms=${encodeURIComponent(selectedTerm)}`;
  document.getElementById('official-link').href = href;
  document.getElementById('footer-link').href = href;
}
function renderScheduleControls() {
  const select = document.getElementById('schedule-select'); select.replaceChildren();
  for (const schedule of schedules) { const option = document.createElement('option'); option.value = schedule.id; option.textContent = schedule.name; select.append(option); }
  select.value = selectedScheduleId;
  select.disabled = loadingTerm || savingPlan;
  for (const id of ['new-schedule', 'copy-schedule', 'rename-schedule', 'delete-schedule'])
    document.getElementById(id).disabled = loadingTerm || savingPlan || (id === 'delete-schedule' && schedules.length <= 1);
  document.getElementById('new-schedule').disabled ||= schedules.length >= 20;
  document.getElementById('copy-schedule').disabled ||= schedules.length >= 20;
  const guest = guestPlans[selectedTerm]?.find(s => s.id === selectedScheduleIds[selectedTerm]) || guestPlans[selectedTerm]?.find(s => s.entries.length);
  document.getElementById('import-local-plan').hidden = !account || !guest?.entries.length || importedLocalKeys.has(`${selectedTerm}|${guest.id}`);
}
function resetSearch() {
  searchRequestId++;
  Object.assign(searchState, { query: '', page: 0, found: 0, results: [], loading: false });
  document.getElementById('catalog-query').value = '';
  document.getElementById('search-status').textContent = '';
  document.getElementById('refresh-search').hidden = true;
  document.getElementById('load-more').hidden = true;
  renderRecent();
}
async function selectTerm(term) {
  if (!terms.includes(term) || savingPlan || loadingTerm || term === selectedTerm) { termSelect.value = selectedTerm; return; }
  const previous = { term: selectedTerm, schedules, selectedScheduleId, entries, cloudVersion };
  selectedTerm = term;
  selectedScheduleId = selectedScheduleIds[term] || 'default';
  resetSearch(); setManualDates(); renderTerm();
  if (!account) { setSchedules(guestPlans[term] || defaultSchedules()); localStorage.setItem(TERM_KEY, term); return; }
  loadingTerm = true; schedules = defaultSchedules(); entries = []; render();
  document.getElementById('auth-status').textContent = `Loading ${term} schedules…`;
  try {
    const response = await fetch(`/api/plan?term=${encodeURIComponent(term)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load schedules.');
    const next = normalizeSchedules(data.schedules);
    if (!next) throw new Error('Your cloud schedules contain invalid data.');
    cloudVersion = data.version; loadingTerm = false; setSchedules(next);
    localStorage.setItem(TERM_KEY, term);
    document.getElementById('auth-status').textContent = `Showing ${term}. Saved to your account.`;
  } catch (error) {
    selectedTerm = previous.term; schedules = previous.schedules; selectedScheduleId = previous.selectedScheduleId;
    entries = previous.entries; cloudVersion = previous.cloudVersion; loadingTerm = false;
    renderTerm(); setManualDates(); render();
    document.getElementById('auth-status').textContent = error.message || 'Could not load schedules.';
  }
}
termSelect.onchange = () => selectTerm(termSelect.value);
document.getElementById('schedule-select').onchange = e => {
  selectedScheduleId = e.target.value; selectedScheduleIds[selectedTerm] = selectedScheduleId;
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(selectedScheduleIds));
  entries = schedules.find(s => s.id === selectedScheduleId).entries; render();
};
document.getElementById('new-schedule').onclick = async () => {
  const used = new Set(schedules.map(s => s.name)); let n = 1; while (used.has(`Schedule ${n}`)) n++;
  const next = { id: crypto.randomUUID(), name: `Schedule ${n}`, entries: [] }, before = selectedScheduleId;
  selectedScheduleId = next.id;
  if (!await commitSchedules([...schedules, next])) selectedScheduleId = before;
};
document.getElementById('copy-schedule').onclick = async () => {
  const current = schedules.find(s => s.id === selectedScheduleId), before = selectedScheduleId;
  const next = { id: crypto.randomUUID(), name: `${current.name.slice(0, 55)} copy`, entries: current.entries.map(e => ({ ...e, id: crypto.randomUUID() })) };
  selectedScheduleId = next.id;
  if (!await commitSchedules([...schedules, next])) selectedScheduleId = before;
};
document.getElementById('rename-schedule').onclick = async () => {
  const name = prompt('Schedule name', scheduleName())?.trim();
  if (!name || name.length > 60 || name === scheduleName()) return;
  await commitSchedules(schedules.map(s => s.id === selectedScheduleId ? { ...s, name } : s));
};
document.getElementById('delete-schedule').onclick = async () => {
  if (schedules.length <= 1 || !confirm(`Delete “${scheduleName()}” and its courses?`)) return;
  const before = selectedScheduleId;
  selectedScheduleId = schedules.find(s => s.id !== before).id;
  if (!await commitSchedules(schedules.filter(s => s.id !== before))) selectedScheduleId = before;
};

function render() {
  renderTerm(); renderScheduleControls();
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
    let data; const cached = !refresh && recent.find(x => x.key === cacheKey(q, page) && x.when + CACHE_TTL > Date.now() && x.data.query?.trim().toLowerCase() === q.toLowerCase() && x.data.page === page && x.data.term === selectedTerm);
    if (cached) data = cached.data;
    else { const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${page}&term=${encodeURIComponent(selectedTerm)}${refresh ? '&refresh=1' : ''}`); data = await response.json(); if (!response.ok) throw new Error(data.error || 'Search unavailable');
      if (data.query?.trim().toLowerCase() !== q.toLowerCase() || data.page !== page || data.term !== selectedTerm || !Array.isArray(data.results)) throw new Error('Search returned mismatched results. Try refreshing.');
      cacheResult(q, page, data); }
    if (requestId !== searchRequestId) return;
    searchState.query = q; searchState.page = page; searchState.found = data.found;
    searchState.results = page === 1 ? data.results : [...searchState.results, ...data.results];
    status.textContent = data.found ? `${searchState.results.length} of ${data.found} sections${cached ? ' · cached' : ''}` : `No ${selectedTerm} sections found for “${q}”.`;
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
  if (await savePlan([...entries, entry])) { f.reset(); f.elements.start.value = '09:00'; f.elements.end.value = '10:15'; setManualDates(); f.elements.title.focus(); }
});
function download(name, content, type) { const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
function termSlug() { return selectedTerm.toLowerCase().replace(' ', '-'); }
document.getElementById('download-json').onclick = () => download(`${termSlug()}-${scheduleName().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, JSON.stringify({ term: selectedTerm, name: scheduleName(), entries }, null, 2), 'application/json');
document.getElementById('import-json').onchange = async e => { const file = e.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); if (data.term !== selectedTerm || !Array.isArray(data.entries)) throw Error('invalid'); const restored = data.entries.map(normalizeEntry); if (restored.some(x => !x)) throw Error('invalid'); await savePlan(restored.map(x => ({ ...x, id: crypto.randomUUID() }))); } catch { alert(`This is not a valid ${selectedTerm} schedule backup.`); } e.target.value = ''; };
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function icsStamp(date, time) { return `${date.replaceAll('-', '')}T${time.replace(':', '')}00`; }
function firstOnOrAfter(date, day) { const target = { M: 1, Tu: 2, W: 3, Th: 4, F: 5 }[day], d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (target - d.getUTCDay() + 7) % 7); return d.toISOString().slice(0, 10); }
document.getElementById('download-ics').onclick = () => {
  const by = { M: 'MO', Tu: 'TU', W: 'WE', Th: 'TH', F: 'FR' }, lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JayGrid//JHU Planner//EN', 'CALSCALE:GREGORIAN'];
  for (const e of entries) for (let i = 0; i < e.meetings.length; i++) for (const day of e.meetings[i].days) {
    const m = e.meetings[i], first = firstOnOrAfter(m.firstDate, day); if (first > m.lastDate) continue;
    lines.push('BEGIN:VEVENT', `UID:${e.id}-${i}-${day}@jaygrid.local`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART;TZID=America/New_York:${icsStamp(first, m.start)}`, `DTEND;TZID=America/New_York:${icsStamp(first, m.end)}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${m.lastDate.replaceAll('-', '')}T235959Z;BYDAY=${by[day]}`,
      `SUMMARY:${icsEscape(e.code + ' ' + e.title)}`, `LOCATION:${icsEscape(m.location)}`,
      `DESCRIPTION:${icsEscape('Section ' + (e.section || '—') + ' · Verify dates and exceptions in SIS.')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR'); download(`${termSlug()}-${scheduleName().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`, lines.join('\r\n') + '\r\n', 'text/calendar');
};
const authButton = document.getElementById('auth-button');
const authStatus = document.getElementById('auth-status');
const importLocalButton = document.getElementById('import-local-plan');
authButton.onclick = async () => {
  if (!account) { location.href = '/auth/login'; return; }
  const response = await fetch('/api/signout', { method: 'POST' });
  if (!response.ok) { authStatus.textContent = 'Could not sign out. Try again.'; return; }
  account = null; cloudVersion = 0;
  selectedScheduleId = selectedScheduleIds[selectedTerm] || 'default';
  setSchedules(guestPlans[selectedTerm] || defaultSchedules());
  guestWatchlist = loadGuestWatchlist(); watchlist = guestWatchlist; watchVersion = 0; watchReady = true; watchLoadError = ''; noteDrafts.clear(); renderWatchlist(); renderHistoryResults(); watchStatus('Saved on this device.');
  authButton.textContent = 'Sign in with Google';
  document.getElementById('storage-indicator').lastChild.textContent = ' Saved on this device';
  importLocalButton.hidden = true;
  authStatus.textContent = 'Signed out. Your account plan remains saved online.';
  render();
};
importLocalButton.onclick = async () => {
  const local = guestPlans[selectedTerm]?.find(s => s.id === selectedScheduleIds[selectedTerm]) || guestPlans[selectedTerm]?.find(s => s.entries.length);
  if (!account || !local?.entries.length || schedules.length >= 20) return;
  const before = selectedScheduleId;
  const next = { id: crypto.randomUUID(), name: `${local.name.slice(0, 42)} from this device`, entries: local.entries.map(e => ({ ...e, id: crypto.randomUUID() })) };
  selectedScheduleId = next.id;
  if (await commitSchedules([...schedules, next])) importedLocalKeys.add(`${selectedTerm}|${local.id}`);
  else selectedScheduleId = before;
  render();
};
async function initAccount() {
  loadingTerm = true; termSelect.disabled = true; renderScheduleControls();
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
    const planResponse = await fetch(`/api/plan?term=${encodeURIComponent(selectedTerm)}`);
    const plan = await planResponse.json();
    if (!planResponse.ok) throw new Error(plan.error || 'Could not load your cloud plan.');
    const restored = normalizeSchedules(plan.schedules);
    if (!restored) throw new Error('Your cloud schedules contain invalid data.');
    account = state.user; cloudVersion = plan.version; setSchedules(restored);
    await loadCloudWatchlist();
    authButton.textContent = 'Sign out';
    authButton.title = state.user.email || 'Sign out';
    document.getElementById('storage-indicator').lastChild.textContent = ' Synced to your account';
    authStatus.textContent = `Signed in as ${state.user.email || 'your account'}. Registration happens in SIS.`;
    render();
  } catch (error) { authStatus.textContent = error.message || 'Could not load your account.'; }
  finally { loadingTerm = false; termSelect.disabled = false; renderScheduleControls(); }
}
function initPanelToggles() {
  const workspace = document.getElementById('planner-view');
  let hidden = {};
  try { hidden = JSON.parse(localStorage.getItem(PANELS_KEY) || '{}') || {}; } catch { /* default: both shown */ }
  const panels = [
    { side: 'left', button: document.getElementById('toggle-left'), name: 'Search', what: 'course search' },
    { side: 'right', button: document.getElementById('toggle-right'), name: 'Schedules', what: 'schedules' },
  ];
  const apply = () => {
    for (const { side, button, name, what } of panels) {
      const isHidden = !!hidden[side];
      workspace.classList.toggle(`hide-${side}`, isHidden);
      button.setAttribute('aria-expanded', String(!isHidden));
      button.title = `${isHidden ? 'Show' : 'Hide'} ${what}`;
      button.textContent = side === 'left' ? `${isHidden ? '▸' : '◂'} ${name}` : `${name} ${isHidden ? '◂' : '▸'}`;
    }
  };
  for (const { side, button } of panels) button.onclick = () => {
    hidden = { ...hidden, [side]: !hidden[side] };
    try { localStorage.setItem(PANELS_KEY, JSON.stringify(hidden)); } catch { /* not persisted */ }
    apply();
  };
  apply();
}
setManualDates(); renderRecent(); render(); initWatchlist(); initAccount(); initPanelToggles();

function normalizeWatchItem(item) {
  if (!item || typeof item.code !== 'string' || typeof item.title !== 'string') return null;
  const code = item.code.trim().toUpperCase();
  if (!/^[A-Z]{2}\.\d{3}\.\d{3}$/.test(code) || !item.title.trim()) return null;
  const checks = {};
  if (item.checks && typeof item.checks === 'object' && !Array.isArray(item.checks)) {
    for (const [term, check] of Object.entries(item.checks).slice(-12)) {
      if (terms.includes(term) && Number.isSafeInteger(check?.found) && check.found >= 0 && !Number.isNaN(Date.parse(check.checkedAt)))
        checks[term] = { found: check.found, checkedAt: check.checkedAt };
    }
  }
  return { code, title: item.title.trim().slice(0, 300), notes: String(item.notes || '').slice(0, 2000),
    addedAt: !Number.isNaN(Date.parse(item.addedAt)) ? item.addedAt : new Date().toISOString(),
    seenTerms: [...new Set((Array.isArray(item.seenTerms) ? item.seenTerms : []).filter(term => /^(Spring|Summer|Fall|Intersession|Winter) 20\d{2}$/.test(term)))].slice(-20), checks };
}
function loadGuestWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    const items = saved.map(normalizeWatchItem).filter(Boolean), seen = new Set();
    return items.filter(item => !seen.has(item.code) && seen.add(item.code)).slice(0, 100);
  } catch { return []; }
}
function watchStatus(message) { document.getElementById('watch-status').textContent = message; }
function termRank(term) {
  const [season, year] = term.split(' '), order = { Intersession: 0, Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
  return Number(year) * 4 + (order[season] || 0);
}
function elapsedSince(date) {
  const then = new Date(`${date}T12:00:00Z`), now = new Date();
  const months = Math.max(0, (now.getUTCFullYear() - then.getUTCFullYear()) * 12 + now.getUTCMonth() - then.getUTCMonth());
  if (months < 4) return 'this term';
  if (months < 12) return `about ${months} months ago`;
  return `about ${Math.round(months / 6) / 2} years ago`;
}
function showView(view) {
  const watching = view === 'watchlist';
  document.getElementById('planner-view').hidden = watching;
  document.getElementById('watchlist-view').hidden = !watching;
  document.getElementById('planner-term-control').hidden = watching;
  for (const [id, active] of [['planner-tab', !watching], ['watchlist-tab', watching]]) {
    const button = document.getElementById(id); button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  if (watching) loadPublishedTerms();
}
function renderWatchTermOptions() {
  const select = document.getElementById('watch-term'); select.replaceChildren();
  for (const term of terms) { const option = document.createElement('option'); option.value = term; option.textContent = term; select.append(option); }
  select.value = selectedWatchTerm;
}
async function loadPublishedTerms() {
  if (publishedTerms) return publishedTerms;
  try {
    const response = await fetch('/api/terms'); const data = await response.json();
    if (!response.ok || !Array.isArray(data.terms)) throw new Error(data.error || 'Could not check catalog terms.');
    publishedTerms = data.terms.filter(term => terms.includes(term));
    renderWatchlist(); return publishedTerms;
  } catch (error) {
    watchStatus(error.message || 'Could not check catalog terms.'); return null;
  }
}
function watchCheckLabel(item) {
  if (watchErrors.has(item.code)) return ['Check failed', 'error'];
  if (publishedTerms && !publishedTerms.includes(selectedWatchTerm)) return ['Term not published', 'missing'];
  const check = item.checks[selectedWatchTerm];
  if (!check) return ['Not checked', ''];
  return check.found ? [`Listed · ${check.found} section${check.found === 1 ? '' : 's'}`, ''] : ['No listing found', 'missing'];
}
function renderWatchlist() {
  document.getElementById('watch-count').textContent = watchlist.length;
  const list = document.getElementById('watch-items'); list.replaceChildren();
  const importButton = document.getElementById('import-device-watchlist');
  importButton.hidden = !account || !watchReady || !guestWatchlist.some(local => {
    const remote = watchlist.find(item => item.code === local.code);
    return !remote || (!remote.notes && local.notes);
  });
  importButton.disabled = watchSaving || watchChecking;
  document.getElementById('check-watchlist').disabled = !watchReady || watchSaving || watchChecking || !watchlist.length;
  document.querySelector('#watch-manual-form button').disabled = !watchReady || watchSaving || watchChecking;
  if (!watchReady) { const empty = document.createElement('div'); empty.className = 'watch-empty'; text(empty, watchLoadError || 'Loading your watchlist…'); list.append(empty); return; }
  if (!watchlist.length) { const empty = document.createElement('div'); empty.className = 'watch-empty'; text(empty, 'No courses watched yet. Find a past course below, or add one by code.'); list.append(empty); return; }
  for (const item of watchlist) {
    const row = document.createElement('article'); row.className = 'watch-row';
    const main = document.createElement('div'); main.className = 'watch-row-main';
    const info = document.createElement('div'), code = document.createElement('div'), title = document.createElement('div'), meta = document.createElement('div');
    code.className = 'watch-row-code'; title.className = 'watch-row-title'; meta.className = 'watch-row-meta';
    text(code, item.code); text(title, item.title);
    const seen = [...item.seenTerms].sort((a, b) => termRank(b) - termRank(a)).slice(0, 5).join(', ');
    const checked = item.checks[selectedWatchTerm]?.checkedAt;
    text(meta, `${seen ? `Seen in ${seen}` : 'No past listing recorded'}${checked ? ` · Checked ${new Date(checked).toLocaleDateString()}` : ''}`);
    info.append(code, title, meta);
    const status = document.createElement('div'); status.className = 'watch-row-status';
    const [label, statusClass] = watchCheckLabel(item); text(status, label); if (statusClass) status.classList.add(statusClass);
    main.append(info, status); row.append(main);
    const actions = document.createElement('div'); actions.className = 'watch-row-actions';
    if (item.checks[selectedWatchTerm]?.found > 0 && publishedTerms?.includes(selectedWatchTerm)) {
      const add = document.createElement('button'); add.type = 'button'; text(add, 'Find sections for planner');
      add.onclick = () => openPlannerFor(item.code); actions.append(add);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-watch'; text(remove, 'Remove');
    remove.disabled = watchSaving || watchChecking; remove.onclick = async () => {
      if (confirm(`Remove ${item.code} from your watchlist?`)) await commitWatchlist(watchlist.filter(saved => saved.code !== item.code));
    }; actions.append(remove); row.append(actions);
    const note = document.createElement('details'); note.className = 'watch-note';
    const summary = document.createElement('summary'); text(summary, item.notes ? `Notes · ${item.notes.replace(/\s+/g, ' ').slice(0, 95)}${item.notes.length > 95 ? '…' : ''}` : 'Notes · Add a note'); note.append(summary);
    const textarea = document.createElement('textarea'); textarea.value = noteDrafts.get(item.code) ?? item.notes; textarea.maxLength = 2000; textarea.placeholder = 'Why do you want to take this course? Anything to remember?'; textarea.setAttribute('aria-label', `Notes for ${item.code}`);
    textarea.oninput = () => noteDrafts.set(item.code, textarea.value);
    const save = document.createElement('button'); save.type = 'button'; text(save, 'Save note');
    save.disabled = watchSaving || watchChecking;
    const noteStatus = document.createElement('span'); noteStatus.className = 'watch-note-status'; noteStatus.setAttribute('role', 'status');
    save.onclick = async () => {
      save.disabled = true;
      const next = watchlist.map(saved => saved.code === item.code ? { ...saved, notes: textarea.value } : saved);
      if (await commitWatchlist(next)) { noteDrafts.delete(item.code); watchStatus(`Saved note for ${item.code}.`); }
      else { noteStatus.textContent = 'Could not save note.'; save.disabled = false; }
    };
    note.append(textarea, save, noteStatus); row.append(note); list.append(row);
  }
}
async function commitWatchlist(next, fromStatusCheck = false) {
  if (!watchReady || watchSaving || (watchChecking && !fromStatusCheck) || next.length > 100) return false;
  if (!account) {
    watchlist = next; guestWatchlist = next;
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next)); renderWatchlist(); renderHistoryResults(); watchStatus('Saved on this device.'); return true;
  }
  watchSaving = true; watchStatus('Saving to your account…');
  let saved = false;
  try {
    const response = await fetch('/api/watchlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: next, version: watchVersion }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save your watchlist.');
    watchVersion = data.version; watchlist = next; saved = true; watchStatus('Saved to your account.'); return true;
  } catch (error) { watchStatus(error.message || 'Could not save your watchlist.'); return false; }
  finally { watchSaving = false; if (saved) { renderWatchlist(); renderHistoryResults(); } }
}
async function loadCloudWatchlist() {
  watchReady = false; watchLoadError = ''; watchlist = []; noteDrafts.clear(); renderWatchlist();
  try {
    const response = await fetch('/api/watchlist'); const data = await response.json();
    if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || 'Could not load your watchlist.');
    const items = data.items.map(normalizeWatchItem);
    if (items.some(item => !item)) throw new Error('Your saved watchlist contains invalid data.');
    watchlist = items; watchVersion = data.version; watchReady = true; renderWatchlist(); renderHistoryResults(); watchStatus('Synced to your account.');
  } catch (error) { watchLoadError = error.message || 'Could not load your watchlist. Reload to retry.'; watchStatus(watchLoadError); renderWatchlist(); }
}
async function addWatchCourse(course, seenTerms = []) {
  const item = normalizeWatchItem({ code: course.code, title: course.title, notes: '', addedAt: new Date().toISOString(), seenTerms, checks: {} });
  if (!item) { watchStatus('Use a course code like EN.601.415.'); return false; }
  if (watchlist.some(saved => saved.code === item.code)) { watchStatus(`${item.code} is already on your watchlist.`); return false; }
  if (watchlist.length >= 100) { watchStatus('The watchlist can hold up to 100 courses.'); return false; }
  return commitWatchlist([...watchlist, item]);
}
function renderHistoryResults() {
  const list = document.getElementById('watch-search-results'); list.replaceChildren();
  for (const course of watchSearch.results) {
    const row = document.createElement('div'); row.className = 'watch-search-result';
    const info = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('span');
    info.className = 'watch-search-result-info';
    const history = Array.isArray(course.history) ? course.history.slice(0, 5) : [];
    text(name, course.title);
    text(meta, history.length ? `${course.code} · Last listed ${history[0].term} (${elapsedSince(history[0].date)})` : `${course.code} · No past listing found`);
    info.append(name, meta);
    if (history.length) {
      const periods = document.createElement('div'); periods.className = 'watch-search-history';
      const label = document.createElement('span'); label.className = 'history-label'; text(label, 'Past listings'); periods.append(label);
      for (const occurrence of history) { const chip = document.createElement('span'); chip.className = 'history-term'; text(chip, occurrence.term); periods.append(chip); }
      info.append(periods);
    }
    if (course.upcoming) { const upcoming = document.createElement('span'); upcoming.className = 'watch-upcoming'; text(upcoming, `Also listed for ${course.upcoming.term}`); info.append(upcoming); }
    if (!course.historyComplete && history.length < 5) { const note = document.createElement('span'); note.className = 'watch-history-note'; text(note, 'Earlier catalog history may be incomplete.'); info.append(note); }
    const add = document.createElement('button'); add.type = 'button';
    const watched = watchlist.some(item => item.code === course.code);
    text(add, watched ? 'Watching' : '+ Watch'); add.disabled = watched || !watchReady || watchSaving || watchChecking;
    add.onclick = () => addWatchCourse(course, history.map(occurrence => occurrence.term)); row.append(info, add); list.append(row);
  }
}
async function searchAcrossYears(query) {
  const q = query.trim();
  if (q.length < 2) return;
  const requestId = ++watchSearchRequestId;
  const status = document.getElementById('watch-search-status');
  const button = document.querySelector('#watch-search-form button'); button.disabled = true;
  status.textContent = 'Searching all JHU catalog years…';
  watchSearch.query = q; watchSearch.results = []; watchSearch.truncated = false; renderHistoryResults();
  try {
    const response = await fetch(`/api/watch-search?q=${encodeURIComponent(q)}`), data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Course search unavailable.');
    if (data.query?.trim().toLowerCase() !== q.toLowerCase() || !Array.isArray(data.results)) throw new Error('Search returned mismatched results.');
    if (requestId !== watchSearchRequestId) return;
    watchSearch.results = data.results; watchSearch.truncated = Boolean(data.truncated);
    renderHistoryResults();
    status.textContent = data.results.length ? `${data.results.length} courses across all catalog years.${data.truncated ? ' Showing the most relevant matches; refine your search for more.' : ''}` : `No courses found for “${q}” in the catalog.`;
  } catch (error) { if (requestId === watchSearchRequestId) status.textContent = error.message || 'Course search unavailable.'; }
  finally { if (requestId === watchSearchRequestId) button.disabled = false; }
}
async function checkWatchlist() {
  if (!watchReady || watchSaving || !watchlist.length) return;
  if (!publishedTerms && !await loadPublishedTerms()) return;
  if (!publishedTerms.includes(selectedWatchTerm)) { watchStatus(`${selectedWatchTerm} is not published in JHU course search yet.`); renderWatchlist(); return; }
  const button = document.getElementById('check-watchlist'), term = selectedWatchTerm;
  watchChecking = true; watchErrors.clear(); renderWatchlist(); renderHistoryResults();
  button.disabled = true; document.getElementById('watch-term').disabled = true;
  const next = [...watchlist]; let index = 0, completed = 0, successful = 0;
  watchStatus(`Checking 0 of ${next.length} courses…`);
  async function worker() {
    while (index < next.length) {
      const i = index++, item = next[i];
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(item.code)}&term=${encodeURIComponent(term)}&page=1&refresh=1`);
        const data = await response.json();
        if (!response.ok || data.term !== term || data.query?.toUpperCase() !== item.code || !Number.isSafeInteger(data.found)) throw new Error();
        const checks = { ...item.checks, [term]: { found: data.found, checkedAt: new Date().toISOString() } };
        while (Object.keys(checks).length > 12) delete checks[Object.keys(checks)[0]];
        const seenTerms = data.found ? [...new Set([...item.seenTerms, term])].slice(-20) : item.seenTerms;
        next[i] = { ...item, checks, seenTerms }; successful++;
      } catch { watchErrors.add(item.code); }
      completed++; watchStatus(`Checked ${completed} of ${next.length} courses…`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, next.length) }, worker));
  const saved = successful ? await commitWatchlist(next, true) : true;
  watchStatus(saved ? `${successful} checked${watchErrors.size ? ` · ${watchErrors.size} failed` : ''}. ${term} listings can change; refresh again later.` : 'Statuses were checked but could not be saved. Try again.');
  watchChecking = false;
  document.getElementById('watch-term').disabled = false;
  renderWatchlist(); button.disabled = !watchReady || watchSaving || !watchlist.length;
}
async function openPlannerFor(code) {
  showView('planner');
  await selectTerm(selectedWatchTerm);
  if (selectedTerm !== selectedWatchTerm) return;
  document.getElementById('catalog-query').value = code;
  await doSearch(code);
  document.getElementById('official-search').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function initWatchlist() {
  localStorage.setItem(WATCH_TERM_KEY, selectedWatchTerm);
  renderWatchTermOptions(); renderWatchlist();
  document.getElementById('planner-tab').onclick = () => showView('planner');
  document.getElementById('watchlist-tab').onclick = () => showView('watchlist');
  document.getElementById('watch-term').onchange = e => {
    selectedWatchTerm = e.target.value; localStorage.setItem(WATCH_TERM_KEY, selectedWatchTerm); watchErrors.clear(); renderWatchlist();
  };
  document.getElementById('check-watchlist').onclick = checkWatchlist;
  document.getElementById('watch-search-form').onsubmit = e => { e.preventDefault(); searchAcrossYears(document.getElementById('watch-query').value); };
  document.getElementById('watch-manual-form').onsubmit = async e => {
    e.preventDefault(); const form = e.currentTarget, data = new FormData(form);
    if (await addWatchCourse({ code: String(data.get('code')), title: String(data.get('title')) })) form.reset();
  };
  document.getElementById('import-device-watchlist').onclick = async () => {
    const next = [...watchlist];
    for (const local of guestWatchlist) {
      const index = next.findIndex(item => item.code === local.code);
      if (index < 0) next.push(local);
      else if (!next[index].notes && local.notes) next[index] = { ...next[index], notes: local.notes,
        seenTerms: [...new Set([...next[index].seenTerms, ...local.seenTerms])].slice(-20) };
    }
    if (next.length > 100) { watchStatus('Import would exceed the 100-course watchlist limit.'); return; }
    if (await commitWatchlist(next)) watchStatus('Imported courses from this device.');
  };
}
