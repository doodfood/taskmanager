/**
 * Date helpers. The API deals in yyyy-MM-dd date strings (compared
 * lexicographically) and UTC ISO timestamps (rendered in local time here).
 */

/** Format a Date as a local yyyy-MM-dd string. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse a yyyy-MM-dd string as a LOCAL date. `new Date('2026-07-21')` would be
 * UTC midnight and can shift the day in some timezones — never do that.
 */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add N days to a yyyy-MM-dd string, returning a yyyy-MM-dd string. */
export function addDaysStr(s: string, days: number): string {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Tue 21 Jul" for a yyyy-MM-dd string. */
export function formatDateShort(s: string): string {
  const d = parseDateStr(s);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Render a UTC ISO timestamp as local HH:mm (24h). */
export function formatTimeLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
