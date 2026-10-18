import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BlockedBy } from './useAsync';
import type { DecisionCheck } from './types';
import { th, td } from './ui';

/** Renders either a list of blocking layers or a full decision check table. */
export function DecisionExplain({ blockedBy, checks, compact }: { blockedBy?: BlockedBy[] | null; checks?: DecisionCheck[] | null; compact?: boolean }) {
    const t = useTranslations('LendingShared.decision');
    if (checks && checks.length > 0) {
        return (
            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>{t('layer')}</th>
                            <th className={th}>{t('check')}</th>
                            <th className={th}>{t('result')}</th>
                            <th className={th}>{t('message')}</th>
                            {!compact && <th className={th}>{t('detail')}</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {checks.map((c, i) => (
                            <tr key={i} className={c.passed ? '' : 'bg-red-50/60'}>
                                <td className={td}><span className="font-mono text-[11px] font-bold">{c.layer}</span></td>
                                <td className={td}><span className="font-mono text-[11px]">{c.code}</span></td>
                                <td className={td}>
                                    {c.passed
                                        ? <span className="inline-flex items-center gap-1 text-emerald-700 text-[12px] font-semibold"><CheckCircle2 size={13} /> {t('pass')}</span>
                                        : <span className="inline-flex items-center gap-1 text-red-700 text-[12px] font-semibold"><XCircle size={13} /> {t('fail')}</span>}
                                </td>
                                <td className={td}>{c.message}</td>
                                {!compact && (
                                    <td className={td}>
                                        {c.detail === undefined || c.detail === null ? '—' : (
                                            <code className="text-[11px] break-all">{typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}</code>
                                        )}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    if (blockedBy && blockedBy.length > 0) {
        return (
            <ul className="space-y-1">
                {blockedBy.map((b, i) => (
                    <li key={i} className="flex gap-2 text-[13px]">
                        <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800 h-fit">{b.layer}</span>
                        <span className="text-[#3C4257]">{b.message}</span>
                    </li>
                ))}
            </ul>
        );
    }
    return <p className="text-[12px] text-[#697386]">{t('noBlocking')}</p>;
}
