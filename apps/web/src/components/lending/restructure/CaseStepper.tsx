import { Check, Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TERMINAL_STATUSES, useRestructureLabels } from './labels';

/** Step labels are LendingRestructure.stepper.steps.<key>. */
const STEPS: { key: string; branches?: string[] }[] = [
    { key: 'REQUESTED' },
    { key: 'AFFORDABILITY_ASSESSED', branches: ['SPECIALIST_REVIEW', 'MORE_INFO_REQUIRED'] },
    { key: 'OPTIONS_PROPOSED' },
    { key: 'APPROVED' },
    { key: 'CUSTOMER_ACCEPTED' },
    { key: 'CONDITIONS_SATISFIED' },
    { key: 'MONITORING' },
    { key: 'COMPLETED' },
];

function stepIndex(status: string): number {
    const i = STEPS.findIndex((s) => s.key === status || s.branches?.includes(status));
    return i;
}

/** Workflow progress for a restructure case, with branch and terminal states. */
export function CaseStepper({ status, lastActiveStatus }: { status: string; lastActiveStatus?: string }) {
    const t = useTranslations('LendingRestructure.stepper');
    const L = useRestructureLabels();
    const terminal = TERMINAL_STATUSES.includes(status);
    const current = terminal ? stepIndex(lastActiveStatus ?? '') : stepIndex(status);
    const branch = !terminal && (status === 'SPECIALIST_REVIEW' || status === 'MORE_INFO_REQUIRED') ? status : null;
    return (
        <div className="space-y-3">
            {terminal && (
                <div className={`flex items-start gap-2 rounded-md border px-4 py-3 text-[13px] ${status === 'REJECTED' || status === 'REVERSED' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-slate-100 border-slate-300 text-slate-700'}`}>
                    <Ban size={16} className="mt-0.5 shrink-0" />
                    <div>
                        <p className="font-bold">{L.status(status)}</p>
                        <p>{t.has(`terminal.${status}`) ? t(`terminal.${status}`) : null}</p>
                    </div>
                </div>
            )}
            <ol className="flex flex-wrap gap-y-3">
                {STEPS.map((s, i) => {
                    const done = current >= 0 && i < current;
                    const active = !terminal && i === current;
                    const isBranch = active && branch;
                    const circle = done
                        ? 'bg-[#635BFF] text-white border-[#635BFF]'
                        : isBranch
                            ? 'bg-amber-500 text-white border-amber-500'
                            : active
                                ? 'bg-white text-[#635BFF] border-[#635BFF] ring-4 ring-[#635BFF]/15'
                                : 'bg-white text-[#AAB7C4] border-[#E3E8EE]';
                    return (
                        <li key={s.key} className="flex items-center min-w-0">
                            <div className="flex flex-col items-center w-[104px] text-center">
                                <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[12px] font-bold ${circle}`}>
                                    {done ? <Check size={14} /> : i + 1}
                                </span>
                                <span className={`mt-1 text-[11px] leading-tight ${active || done ? 'text-[#1A1F36] font-semibold' : 'text-[#8792A2]'} ${terminal ? 'opacity-60' : ''}`}>{t(`steps.${s.key}`)}</span>
                                {isBranch && (
                                    <span className="mt-1 text-[10px] font-bold uppercase text-amber-800 bg-amber-100 border border-amber-300 rounded px-1">
                                        {L.status(branch)}
                                    </span>
                                )}
                            </div>
                            {i < STEPS.length - 1 && <span className={`hidden md:block h-0.5 w-4 -mx-1 ${done ? 'bg-[#635BFF]' : 'bg-[#E3E8EE]'}`} />}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
