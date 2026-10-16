/**
 * String-only formatting helpers for lending amounts.
 *
 * Money and rates arrive from the API as decimal strings. They are never
 * parsed into JS numbers for arithmetic — these helpers only re-format text.
 */

const DECIMAL = /^(-?)(\d*)(?:\.(\d*))?$/;

/** "1234567.5" → "1,234,567.5". Non-decimal input is returned unchanged. */
export function fmtMoney(value: string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '—';
    const m = DECIMAL.exec(String(value).trim());
    if (!m) return String(value);
    const [, sign, int, frac] = m;
    const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${grouped}${frac !== undefined && frac !== '' ? `.${frac}` : ''}`;
}

/** Shift a decimal string's point by `places` (positive = multiply by 10^places). */
export function shiftDecimal(value: string, places: number): string {
    const m = DECIMAL.exec(String(value).trim());
    if (!m) return value;
    const [, sign] = m;
    let int = m[2] || '0';
    let frac = m[3] || '';
    if (places >= 0) {
        frac = frac.padEnd(places, '0');
        int = int + frac.slice(0, places);
        frac = frac.slice(places);
    } else {
        const p = -places;
        int = int.padStart(p + 1, '0');
        frac = int.slice(int.length - p) + frac;
        int = int.slice(0, int.length - p);
    }
    int = int.replace(/^0+(?=\d)/, '');
    frac = frac.replace(/0+$/, '');
    const out = frac ? `${int}.${frac}` : int;
    return out === '0' ? '0' : `${sign}${out}`;
}

/** "0.12" → "12%"; "0.0525" → "5.25%". */
export function fmtRate(value: string | null | undefined, maxDecimals = 4): string {
    if (value === null || value === undefined || value === '') return '—';
    const pct = shiftDecimal(String(value), 2);
    const [i, f] = pct.split('.');
    const trimmed = f ? `${i}.${f.slice(0, maxDecimals)}`.replace(/\.?0+$/, '') : i;
    return `${trimmed}%`;
}

/** "12.5" (percent entered by a user) → "0.125" (fraction for the API). */
export function percentToFraction(value: string): string {
    return shiftDecimal(value.trim(), -2);
}

/** True for strings like "12", "12.5", "0.0001". */
export function isDecimalString(v: string): boolean {
    return /^\d+(\.\d+)?$/.test(v.trim());
}

/** Compare two non-negative decimal strings without floating point. */
export function compareDecimal(a: string, b: string): number {
    const [ai, af = ''] = a.split('.');
    const [bi, bf = ''] = b.split('.');
    const AI = ai.replace(/^0+/, '');
    const BI = bi.replace(/^0+/, '');
    if (AI.length !== BI.length) return AI.length > BI.length ? 1 : -1;
    if (AI !== BI) return AI > BI ? 1 : -1;
    const len = Math.max(af.length, bf.length);
    const A = af.padEnd(len, '0');
    const B = bf.padEnd(len, '0');
    return A === B ? 0 : A > B ? 1 : -1;
}

/** Is a decimal string strictly greater than zero? */
export function isPositive(v: string | null | undefined): boolean {
    if (!v) return false;
    const s = String(v).trim();
    if (s.startsWith('-')) return false;
    return /[1-9]/.test(s);
}

export function fmtDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

export function fullName(b?: { firstName?: string | null; lastName?: string | null } | null): string {
    if (!b) return '—';
    return [b.firstName, b.lastName].filter(Boolean).join(' ') || '—';
}

/** Today's date as YYYY-MM-DD in the browser's local time. */
export function todayIso(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-10-16T09:30" (datetime-local input) → ISO 8601 with Z, or undefined. */
export function localToIso(v: string): string | undefined {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/* ── Exact decimal arithmetic on strings (BigInt-scaled, display only) ───── */

function toScaled(v: string, scale: number): bigint {
    const m = DECIMAL.exec(String(v ?? '0').trim() || '0');
    if (!m) return BigInt(0);
    const [, sign, int, frac = ''] = m;
    const digits = (int || '0') + frac.padEnd(scale, '0').slice(0, scale);
    const n = BigInt(digits || '0');
    return sign === '-' ? -n : n;
}

function fromScaled(n: bigint, scale: number): string {
    const neg = n < BigInt(0);
    const s = (neg ? -n : n).toString().padStart(scale + 1, '0');
    const int = s.slice(0, s.length - scale);
    const frac = s.slice(s.length - scale).replace(/0+$/, '');
    const out = frac ? `${int}.${frac}` : int;
    return neg && out !== '0' ? `-${out}` : out;
}

function scaleOf(...vals: (string | null | undefined)[]): number {
    return Math.max(2, ...vals.map((v) => (String(v ?? '').split('.')[1] ?? '').length));
}

/** Exact sum of decimal strings. */
export function addDecimal(...vals: (string | null | undefined)[]): string {
    const sc = scaleOf(...vals);
    return fromScaled(vals.reduce((acc, v) => acc + toScaled(v ?? '0', sc), BigInt(0)), sc);
}

/** Exact a − b of decimal strings. */
export function subDecimal(a: string | null | undefined, b: string | null | undefined): string {
    const sc = scaleOf(a, b);
    return fromScaled(toScaled(a ?? '0', sc) - toScaled(b ?? '0', sc), sc);
}
