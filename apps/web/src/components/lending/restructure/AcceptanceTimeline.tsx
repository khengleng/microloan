import { PenLine } from 'lucide-react';
import { fmtDateTime } from '../format';
import { shortHash } from './labels';

/** Raw acceptance row as returned by the API (fields read defensively). */
export interface AcceptanceRow {
    id: string; method: string; evidence?: string | null; proposalHash: string; acceptedByType?: string; acceptedById?: string;
    actorId?: string | null; recordedBy?: string | null; acceptedBy?: string | null; createdAt: string;
}

const METHOD_LABEL: Record<string, string> = {
    PORTAL_CONFIRMATION: 'Customer confirmed in portal',
    SIGNED_FORM: 'Signed form (branch)',
    WITNESSED_VERBAL: 'Witnessed verbal acceptance (branch)',
};

/** Customer acceptances — a separate timeline from credit approvals. */
export function AcceptanceTimeline({ acceptances, currentHash }: { acceptances: AcceptanceRow[]; currentHash: string }) {
    return (
        <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">Customer acceptance</p>
            {acceptances.length === 0 ? (
                <p className="text-[12px] text-[#697386]">The customer has not accepted this proposal.</p>
            ) : (
                <ol className="relative border-l-2 border-emerald-200 ml-2 space-y-3">
                    {acceptances.map((a) => {
                        const matches = a.proposalHash === currentHash;
                        const who = a.acceptedById ?? a.acceptedBy ?? a.recordedBy ?? a.actorId ?? 'unknown';
                        return (
                            <li key={a.id} className="ml-4">
                                <span className="absolute -left-[9px] mt-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-white text-emerald-600">
                                    <PenLine size={14} />
                                </span>
                                <p className="text-[12px] font-semibold text-[#1A1F36]">{METHOD_LABEL[a.method] ?? a.method}</p>
                                <p className="text-[11px] text-[#697386]">
                                    {fmtDateTime(a.createdAt)} · {a.acceptedByType ? `${a.acceptedByType.replace(/_/g, ' ').toLowerCase()} ` : ''}<span className="font-mono">{who}</span>
                                </p>
                                <p className={`text-[11px] font-mono ${matches ? 'text-emerald-700' : 'text-red-700'}`}>
                                    hash {shortHash(a.proposalHash)} {matches ? '✓ matches proposal' : '✗ does not match current proposal'}
                                </p>
                                {a.evidence && <p className="text-[12px] text-[#3C4257] mt-0.5">Evidence: {a.evidence}</p>}
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
