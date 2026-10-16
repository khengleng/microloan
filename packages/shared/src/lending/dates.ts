import { D, Dec, EngineError } from './decimal.js';

/**
 * Business dates are plain calendar dates ("YYYY-MM-DD"), never instants.
 * A due date has no time zone; converting through `Date` objects in a server
 * time zone is how off-by-one-day schedule bugs happen. Internally a date is
 * an epoch-day integer computed with the proleptic Gregorian calendar.
 */
export type LocalDate = string;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function parseDate(value: LocalDate, field = 'date'): Ymd {
  const match = DATE_PATTERN.exec(String(value ?? ''));
  if (!match) throw new EngineError('INVALID_DATE', `${field} must be a YYYY-MM-DD date, got ${JSON.stringify(value)}.`);
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) {
    throw new EngineError('INVALID_DATE', `${field} ${value} is not a real calendar date.`);
  }
  return ymd;
}

export function formatDate({ y, m, d }: Ymd): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
export function toEpochDay(value: LocalDate): number {
  const { y: year, m, d } = parseDate(value);
  const y = m <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(z0: number): LocalDate {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return formatDate({ y: m <= 2 ? y + 1 : y, m, d });
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days);
}

export function daysBetween(start: LocalDate, end: LocalDate): number {
  return toEpochDay(end) - toEpochDay(start);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

/**
 * Add calendar months, clamping to month end. `anchorDay` keeps a schedule
 * anchored on its original day: 31 Jan + 1 month = 28/29 Feb, and the next
 * step returns to 31 Mar rather than drifting to 28 Mar.
 */
export function addMonths(date: LocalDate, months: number, anchorDay?: number): LocalDate {
  const { y, m, d } = parseDate(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm));
  return formatDate({ y: ny, m: nm, d: day });
}

/** ISO day of week: 1 = Monday … 7 = Sunday. */
export function dayOfWeek(date: LocalDate): number {
  // 1970-01-01 was a Thursday (ISO 4).
  return ((((toEpochDay(date) + 3) % 7) + 7) % 7) + 1;
}

// ── Day-count conventions ───────────────────────────────────────────────────

export const SUPPORTED_DAY_COUNTS = ['ACT_365_FIXED', 'ACT_360', 'ACT_ACT_ISDA', 'THIRTY_360_ISDA', 'THIRTY_E_360'] as const;
export type DayCountConvention = (typeof SUPPORTED_DAY_COUNTS)[number];

export function assertDayCount(value: string): asserts value is DayCountConvention {
  if (!(SUPPORTED_DAY_COUNTS as readonly string[]).includes(value)) {
    // Never approximate an unknown convention with a "close" one — the
    // contract names a specific convention and anything else is a pricing error.
    throw new EngineError(
      'UNSUPPORTED_DAY_COUNT',
      `Day-count convention ${value} is not supported. Supported: ${SUPPORTED_DAY_COUNTS.join(', ')}.`,
    );
  }
}

function thirty360Days(start: Ymd, end: Ymd, european: boolean): number {
  let d1 = start.d;
  let d2 = end.d;
  if (european) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else {
    // 30/360 ISDA (bond basis): D1=31→30; D2=31→30 only when D1 is (now) 30.
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;
  }
  return 360 * (end.y - start.y) + 30 * (end.m - start.m) + (d2 - d1);
}

/**
 * Year fraction between two dates under a day-count convention.
 * For ACT/ACT ISDA the period is split at year boundaries: days falling in a
 * leap year count over 366, the rest over 365.
 */
export function yearFraction(start: LocalDate, end: LocalDate, convention: string): Dec {
  assertDayCount(convention);
  const s = toEpochDay(start);
  const e = toEpochDay(end);
  if (e < s) throw new EngineError('INVALID_PERIOD', `Period end ${end} precedes start ${start}.`);
  switch (convention) {
    case 'ACT_365_FIXED':
      return new D(e - s).div(365);
    case 'ACT_360':
      return new D(e - s).div(360);
    case 'THIRTY_360_ISDA':
      return new D(thirty360Days(parseDate(start), parseDate(end), false)).div(360);
    case 'THIRTY_E_360':
      return new D(thirty360Days(parseDate(start), parseDate(end), true)).div(360);
    case 'ACT_ACT_ISDA': {
      let fraction = new D(0);
      let cursor = s;
      while (cursor < e) {
        const year = parseDate(fromEpochDay(cursor)).y;
        const nextYearStart = toEpochDay(`${String(year + 1).padStart(4, '0')}-01-01`);
        const segmentEnd = Math.min(nextYearStart, e);
        fraction = fraction.plus(new D(segmentEnd - cursor).div(isLeapYear(year) ? 366 : 365));
        cursor = segmentEnd;
      }
      return fraction;
    }
  }
}

/** Number of accrual days a convention counts in a period (for explanations). */
export function dayCountDays(start: LocalDate, end: LocalDate, convention: string): number {
  assertDayCount(convention);
  if (convention === 'THIRTY_360_ISDA') return thirty360Days(parseDate(start), parseDate(end), false);
  if (convention === 'THIRTY_E_360') return thirty360Days(parseDate(start), parseDate(end), true);
  return daysBetween(start, end);
}

// ── Business-day calendars ──────────────────────────────────────────────────

export type BusinessDayConvention = 'NONE' | 'FOLLOWING' | 'MODIFIED_FOLLOWING' | 'PRECEDING';

export interface HolidayCalendar {
  code: string;
  /** ISO days of week that are not business days. Default Saturday + Sunday. */
  weekendDays: number[];
  holidays: LocalDate[];
}

export function isBusinessDay(date: LocalDate, calendar: HolidayCalendar): boolean {
  return !calendar.weekendDays.includes(dayOfWeek(date)) && !calendar.holidays.includes(date);
}

/** Move a date onto a business day according to the convention. */
export function adjustBusinessDay(date: LocalDate, convention: BusinessDayConvention, calendar?: HolidayCalendar): LocalDate {
  if (convention === 'NONE' || !calendar) return date;
  const step = (d: LocalDate, dir: 1 | -1) => {
    let cursor = d;
    for (let guard = 0; !isBusinessDay(cursor, calendar); guard++) {
      if (guard > 366) throw new EngineError('CALENDAR_ERROR', `Calendar ${calendar.code} has no business day near ${date}.`);
      cursor = addDays(cursor, dir);
    }
    return cursor;
  };
  if (convention === 'FOLLOWING') return step(date, 1);
  if (convention === 'PRECEDING') return step(date, -1);
  const following = step(date, 1);
  return parseDate(following).m === parseDate(date).m ? following : step(date, -1);
}
