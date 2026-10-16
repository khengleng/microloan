import { fmtMoney, fmtRate, isPositive } from './format';

/** Right-aligned money string (never parsed to a number). */
export function MoneyCell({ value, currency, muted, strong, highlightNonZero }: {
    value: string | null | undefined; currency?: string; muted?: boolean; strong?: boolean; highlightNonZero?: boolean;
}) {
    const zero = !isPositive(value) && !(value ?? '').startsWith('-');
    const cls = [
        'tabular-nums whitespace-nowrap',
        strong ? 'font-bold text-[#1A1F36]' : '',
        muted || zero ? 'text-[#AAB7C4]' : '',
        highlightNonZero && !zero ? 'text-red-600 font-semibold' : '',
    ].join(' ');
    return (
        <span className={cls}>
            {currency && <span className="text-[10px] text-[#8792A2] mr-1">{currency}</span>}
            {fmtMoney(value)}
        </span>
    );
}

export function Money({ value, currency }: { value: string | null | undefined; currency?: string }) {
    return <span className="tabular-nums">{currency ? `${currency} ` : ''}{fmtMoney(value)}</span>;
}

export function Rate({ value }: { value: string | null | undefined }) {
    return <span className="tabular-nums">{fmtRate(value)}</span>;
}
