import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { fmtDateTime } from '../format';
import { Person } from '../People';

/** Raw approval row as returned by the API (fields read defensively). */
export interface ApprovalRow {
    id: string; approverId?: string; actorId?: string; decision?: string; comment?: string | null; note?: string | null; createdAt: string;
}

/** Credit / risk approvals — kept visually separate from customer acceptance. */
export function ApprovalTimeline({ approvals, required }: { approvals: ApprovalRow[]; required: number }) {
    const t = useTranslations('LendingRestructure');
    const approved = approvals.filter((a) => (a.decision ?? 'APPROVE') === 'APPROVE').length;
    return (
        <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">
                {t.rich('approval.title', { approved, required, n: (c) => <span className="text-[#1A1F36]">{c}</span> })}
            </p>
            {approvals.length === 0 ? (
                <p className="text-[12px] text-[#697386]">{t('approval.none')}</p>
            ) : (
                <ol className="relative border-l-2 border-[#C9D7FF] ml-2 space-y-3">
                    {approvals.map((a) => {
                        const reject = a.decision === 'REJECT';
                        return (
                            <li key={a.id} className="ml-4">
                                <span className={`absolute -left-[9px] mt-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-white ${reject ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {reject ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
                                </span>
                                <p className="text-[12px] font-semibold text-[#1A1F36]">
                                    {t.rich(reject ? 'approval.rejectedBy' : 'approval.approvedBy', { who: () => (a.approverId ?? a.actorId ? <Person id={a.approverId ?? a.actorId} /> : t('common.unknown')) })}
                                </p>
                                <p className="text-[11px] text-[#697386]">{fmtDateTime(a.createdAt)}</p>
                                {(a.comment || a.note) && <p className="text-[12px] text-[#3C4257] mt-0.5">“{a.comment ?? a.note}”</p>}
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
