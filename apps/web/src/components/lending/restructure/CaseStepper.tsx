import { Check, Ban } from 'lucide-react';
import { TERMINAL_STATUSES } from './labels';

const STEPS: { key: string; label: string; branches?: string[] }[] = [
    { key: 'REQUESTED', label: 'Requested' },
    { key: 'AFFORDABILITY_ASSESSED', label: 'Affordability assessed', branches: ['SPECIALIST_REVIEW', 'MORE_INFO_REQUIRED'] },
    { key: 'OPTIONS_PROPOSED', label: 'Options proposed' },
    { key: 'APPROVED', label: 'Approved' },
    { key: 'CUSTOMER_ACCEPTED', label: 'Customer accepted' },
    { key: 'CONDITIONS_SATISFIED', label: 'Conditions satisfied' },
    { key: 'MONITORING', label: 'Monitoring' },
    { key: 'COMPLETED', label: 'Completed' },
];

function stepIndex(status: string): number {
    const i = STEPS.findIndex((s) => s.key === status || s.branches?.includes(status));
    return i;
}

const TERMINAL_TEXT: Record<string, string> = {
    REJECTED: 'This case was rejected. No change was made to the loan.',
    WITHDRAWN: 'This case was withdrawn. No change was made to the loan.',
    EXPIRED: 'This case expired before it was completed. No change was made to the loan.',
    REVERSED: 'The executed amendment was reversed. The loan has been restored to its previous terms.',
};

/** Workflow progress for a restructure case, with branch and terminal states. */
export function CaseStepper({ status, lastActiveStatus }: { status: string; lastActiveStatus?: string }) {
    const terminal = TERMINAL_STATUSES.includes(status);
    const current = terminal ? stepIndex(lastActiveStatus ?? '') : stepIndex(status);
    const branch = !terminal && (status === 'SPECIALIST_REVIEW' || status === 'MORE_INFO_REQUIRED') ? status : null;
    return (
        <div className="space-y-3">
            {terminal && (
                <div className={`flex items-start gap-2 rounded-md border px-4 py-3 text-[13px] ${status === 'REJECTED' || status === 'REVERSED' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-slate-100 border-slate-300 text-slate-700'}`}>
                    <Ban size={16} className="mt-0.5 shrink-0" />
                    <div>
                        <p className="font-bold">{status.replace(/_/g, ' ')}</p>
                        <p>{TERMINAL_TEXT[status]}</p>
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
                                <span className={`mt-1 text-[11px] leading-tight ${active || done ? 'text-[#1A1F36] font-semibold' : 'text-[#8792A2]'} ${terminal ? 'opacity-60' : ''}`}>{s.label}</span>
                                {isBranch && (
                                    <span className="mt-1 text-[10px] font-bold uppercase text-amber-800 bg-amber-100 border border-amber-300 rounded px-1">
                                        {branch.replace(/_/g, ' ')}
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
