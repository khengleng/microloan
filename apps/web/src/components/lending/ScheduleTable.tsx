import type { LoanScheduleLine, ProposedLine, ScheduleLine } from './types';
import { addDecimal, subDecimal } from './format';
import { MoneyCell } from './MoneyCell';
import { StatusBadge } from './StatusBadge';
import { th, thR, td, tdR } from './ui';

/** Normalized row for display. */
export interface ScheduleRow {
    key: string;
    number: number;
    dueDate: string;
    principal: string;
    interest: string;
    charges: string;
    total: string;
    closingPrincipal: string | null;
    status?: string;
    projected?: boolean;
    note?: string;
}

export function rowsFromSimulation(lines: ScheduleLine[]): ScheduleRow[] {
    return lines.map((l) => ({
        key: `${l.number}-${l.dueDate}`,
        number: l.number,
        dueDate: l.dueDate,
        principal: l.principal,
        interest: l.interest,
        charges: l.capitalizedInterest && l.capitalizedInterest !== '0' ? l.capitalizedInterest : '0',
        total: l.total,
        closingPrincipal: l.closingPrincipal,
        status: l.kind && l.kind !== 'REGULAR' ? l.kind : undefined,
        projected: l.projected,
    }));
}

export function rowsFromProposal(lines: ProposedLine[]): ScheduleRow[] {
    return lines.map((l) => ({
        key: `${l.number}-${l.dueDate}`,
        number: l.number,
        dueDate: l.dueDate,
        principal: l.principal,
        interest: l.interest,
        charges: addDecimal(l.deferred?.interest, l.deferred?.fees, l.deferred?.penalties, l.deferred?.taxes),
        total: l.total,
        closingPrincipal: subDecimal(addDecimal(l.openingPrincipal, l.capitalizedInterest), l.principal),
    }));
}

export function rowsFromLoan(lines: LoanScheduleLine[]): ScheduleRow[] {
    return lines.map((l) => {
        const charges = addDecimal(l.deferredInterestDue, l.feeDue, l.taxDue, l.penaltyDue);
        const total = addDecimal(l.principalDue, l.interestDue, charges);
        const paid = addDecimal(l.principalPaid, l.interestPaid, l.feePaid, l.taxPaid, l.penaltyPaid);
        return {
            key: l.id,
            number: l.number,
            dueDate: l.dueDate,
            principal: l.principalDue,
            interest: l.interestDue,
            charges,
            total,
            closingPrincipal: subDecimal(addDecimal(l.openingPrincipal, l.capitalizedInterest), l.principalDue),
            status: l.status,
            projected: l.projected,
            note: paid !== '0' && paid !== '0.00' ? `paid ${paid}` : undefined,
        };
    });
}

/** Columns: #, due date, principal, interest, deferred/charges, total, closing principal, status. */
export function ScheduleTable({ rows, currency, chargesLabel = 'Deferred / charges', showStatus = true }: {
    rows: ScheduleRow[]; currency?: string; chargesLabel?: string; showStatus?: boolean;
}) {
    const anyProjected = rows.some((r) => r.projected);
    return (
        <div className="space-y-2">
            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>#</th>
                            <th className={th}>Due date</th>
                            <th className={thR}>Principal</th>
                            <th className={thR}>Interest</th>
                            <th className={thR}>{chargesLabel}</th>
                            <th className={thR}>Total{currency ? ` (${currency})` : ''}</th>
                            <th className={thR}>Closing principal</th>
                            {showStatus && <th className={th}>Status</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rows.map((r) => (
                            <tr key={r.key} className={r.projected ? 'bg-amber-50/50' : r.status === 'PAID' ? 'bg-emerald-50/30' : ''}>
                                <td className={td}>{r.number}</td>
                                <td className={`${td} whitespace-nowrap`}>{r.dueDate}</td>
                                <td className={tdR}><MoneyCell value={r.principal} /></td>
                                <td className={tdR}><MoneyCell value={r.interest} /></td>
                                <td className={tdR}><MoneyCell value={r.charges} /></td>
                                <td className={tdR}><MoneyCell value={r.total} strong /></td>
                                <td className={tdR}>{r.closingPrincipal === null ? '—' : <MoneyCell value={r.closingPrincipal} />}</td>
                                {showStatus && (
                                    <td className={`${td} whitespace-nowrap`}>
                                        <div className="flex items-center gap-1.5">
                                            {r.status && <StatusBadge status={r.status} />}
                                            {r.projected && <span className="text-[10px] font-bold uppercase text-amber-700 border border-amber-300 bg-amber-50 rounded px-1">projected</span>}
                                            {r.note && <span className="text-[11px] text-[#697386]">{r.note}</span>}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {anyProjected && (
                <p className="text-[11px] text-amber-800">Rows marked <b>projected</b> depend on a future rate observation and are not contractually fixed.</p>
            )}
        </div>
    );
}
