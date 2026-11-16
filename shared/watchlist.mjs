import { validTerm } from './plans.mjs';

// A dedicated, user-owned row in the existing RLS-protected plans table.
export const WATCHLIST_ROW = '__watchlist__';
const CATALOG_TERM_PATTERN = /^(Spring|Summer|Fall|Intersession|Winter) 20\d{2}$/;
export const validCatalogTerm = term => typeof term === 'string' && CATALOG_TERM_PATTERN.test(term);

export function validWatchlist(items) {
  return Array.isArray(items) && items.length <= 100 &&
    new Set(items.map(item => item?.code)).size === items.length && items.every(item =>
      item && typeof item.code === 'string' && /^[A-Z]{2}\.\d{3}\.\d{3}$/.test(item.code) &&
      typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 300 &&
      typeof item.notes === 'string' && item.notes.length <= 2000 &&
      typeof item.addedAt === 'string' && !Number.isNaN(Date.parse(item.addedAt)) &&
      Array.isArray(item.seenTerms) && item.seenTerms.length <= 20 && item.seenTerms.every(validCatalogTerm) &&
      item.checks && typeof item.checks === 'object' && !Array.isArray(item.checks) &&
      Object.keys(item.checks).length <= 12 && Object.entries(item.checks).every(([term, check]) =>
        validTerm(term) && check && Number.isSafeInteger(check.found) && check.found >= 0 &&
        typeof check.checkedAt === 'string' && !Number.isNaN(Date.parse(check.checkedAt))));
}
