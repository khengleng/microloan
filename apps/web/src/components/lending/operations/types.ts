export interface BusinessDate { businessDate: string; note?: string }

export interface BatchResult {
    businessDate: string;
    processed: number;
    failed: { id: string; error: string }[];
}

/** `GET /lending/ops/rates` row. Rates are decimal fractions (0.05 = 5%). */
export interface RateObservation {
    id: string;
    benchmarkCode: string;
    observationDate: string;
    rate: string;
    source: string;
    recordedBy?: string;
    createdAt?: string;
}

export interface CalendarHoliday { id?: string; date: string; name: string }

/** `GET /lending/ops/calendars` row. weekendDays are ISO days 1 (Mon) – 7 (Sun). */
export interface HolidayCalendar {
    id: string;
    code: string;
    name: string;
    weekendDays: number[];
    holidays: CalendarHoliday[];
}

export interface AdapterStatus { name: string; real: boolean; usable: boolean }

/** `GET /lending/ops/integrations`. */
export type IntegrationsStatus = Record<string, AdapterStatus>;
