import { addDays, format, parseISO } from 'date-fns';

/**
 * Central clock. ALL "current time" reads in the app must go through here so
 * the date can be spoofed for testing scenarios (env var SPOOF_DATE at boot,
 * or the /api/debug/clock endpoints at runtime).
 */
let spoofed: Date | null = null;

export function now(): Date {
  return spoofed ? new Date(spoofed.getTime()) : new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

/** Today's date as yyyy-MM-dd (local server timezone). */
export function todayStr(): string {
  return format(now(), 'yyyy-MM-dd');
}

/** Set (or clear, with null) the spoofed current date/time. */
export function setSpoofedDate(date: string | Date | null): void {
  if (date === null) {
    spoofed = null;
    return;
  }
  // Date-only strings ("2026-07-25") would normally parse as UTC midnight,
  // which can land on the previous local day in positive-offset timezones.
  // Anchor them at local noon instead so the intended date always wins.
  const normalised = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00` : date;
  const d = typeof normalised === 'string' ? new Date(normalised) : normalised;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${String(date)}`);
  }
  spoofed = d;
}

export function getSpoofedDate(): string | null {
  return spoofed ? spoofed.toISOString() : null;
}

export function isSpoofed(): boolean {
  return spoofed !== null;
}

/** Add days to a yyyy-MM-dd date string, returning yyyy-MM-dd. */
export function addDaysStr(dateStr: string, days: number): string {
  return format(addDays(parseISO(dateStr), days), 'yyyy-MM-dd');
}

/** today + days, as yyyy-MM-dd */
export function todayPlus(days: number): string {
  return addDaysStr(todayStr(), days);
}
