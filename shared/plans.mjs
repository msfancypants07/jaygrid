export const DEFAULT_TERM = 'Spring 2027';
export const DEFAULT_SCHEDULE = 'Schedule 1';
export const TERM_PATTERN = /^(Spring|Summer|Fall) 20\d{2}$/;

export function validTerm(term) {
  return typeof term === 'string' && TERM_PATTERN.test(term);
}

export function validEntries(entries) {
  return Array.isArray(entries) && entries.length <= 100 && entries.every(e =>
    e && typeof e.id === 'string' && e.id.length <= 100 &&
    typeof e.title === 'string' && e.title.length <= 300 &&
    typeof e.code === 'string' && e.code.length <= 80 && Array.isArray(e.meetings));
}

export function validSchedules(schedules) {
  return Array.isArray(schedules) && schedules.length >= 1 && schedules.length <= 20 &&
    new Set(schedules.map(s => s?.id)).size === schedules.length && schedules.every(s =>
      s && typeof s.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(s.id) &&
      typeof s.name === 'string' && s.name.trim().length > 0 && s.name.length <= 60 &&
      validEntries(s.entries));
}

export function normalizedSchedules(value) {
  if (!Array.isArray(value) || value.length === 0) return [{ id: 'default', name: DEFAULT_SCHEDULE, entries: [] }];
  if (validSchedules(value)) return value;
  if (validEntries(value)) return [{ id: 'default', name: DEFAULT_SCHEDULE, entries: value }];
  return null;
}
