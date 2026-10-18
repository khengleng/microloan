import { PenLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { fmtDateTime } from '../format';
import { Person } from '../People';
import { shortHash, useRestructureLabels } from './labels';

/** Raw acceptance row as returned by the API (fields read defensively). */
export interface AcceptanceRow {
    id: string; method: string; evidence?: string | null; proposalHash: string; acceptedByType?: string; acceptedById?: string;
    actorId?: string | null; recordedBy?: string | null; acceptedBy?: string | null; createdAt: string;
}

/** Customer acceptances — a separate timeline from credit approvals. */
export function AcceptanceTimeline({ acceptances, currentHash }: { acceptances: AcceptanceRow[]; currentHash: string }) {
    const t = useTranslations('LendingRestructure');
    const L = useRestructureLabels();
    return (
        <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('acceptance.title')}</p>
            {acceptances.length === 0 ? (
                <p className="text-[12px] text-[#697386]">{t('acceptance.none')}</p>
            ) : (
                <ol className="relative border-l-2 border-emerald-200 ml-2 space-y-3">
                    {acceptances.map((a) => {
                        const matches = a.proposalHash === currentHash;
                        const who = a.acceptedById ?? a.acceptedBy ?? a.recordedBy ?? a.actorId ?? null;
                        return (
                            <li key={a.id} className="ml-4">
                                <span className="absolute -left-[9px] mt-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-white text-emerald-600">
                                    <PenLine size={14} />
                                </span>
                                <p className="text-[12px] font-semibold text-[#1A1F36]">{L.label('acceptanceMethod', a.method)}</p>
                                <p className="text-[11px] text-[#697386]">
                                    {fmtDateTime(a.createdAt)} · {a.acceptedByType ? `${L.label('actorType', a.acceptedByType)} ` : ''}{who ? <Person id={who} /> : t('common.unknown')}
                                </p>
                                <p className={`text-[11px] font-mono ${matches ? 'text-emerald-700' : 'text-red-700'}`}>
                                    {t(matches ? 'acceptance.hashMatches' : 'acceptance.hashMismatch', { hash: shortHash(a.proposalHash) })}
                                </p>
                                {a.evidence && <p className="text-[12px] text-[#3C4257] mt-0.5">{t('acceptance.evidence', { evidence: a.evidence })}</p>}
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
