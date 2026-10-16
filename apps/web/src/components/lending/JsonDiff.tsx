import type { DiffEntry } from './types';
import { th, td } from './ui';

function show(v: unknown) {
    if (v === undefined) return <span className="text-[#AAB7C4] italic">absent</span>;
    if (v === null) return <span className="text-[#AAB7C4] italic">null</span>;
    return <code className="text-[11px] break-all whitespace-pre-wrap">{typeof v === 'string' ? v : JSON.stringify(v, null, 1)}</code>;
}

/** Renders `[{ path, before, after }]` as a change table. */
export function JsonDiff({ diff, emptyLabel = 'No differences.' }: { diff: DiffEntry[] | null | undefined; emptyLabel?: string }) {
    if (!diff || diff.length === 0) return <p className="text-[13px] text-[#697386]">{emptyLabel}</p>;
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
                <thead>
                    <tr className="border-b border-[#E3E8EE]">
                        <th className={th}>Path</th>
                        <th className={th}>Before</th>
                        <th className={th}>After</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2F5]">
                    {diff.map((d, i) => (
                        <tr key={i}>
                            <td className={`${td} font-mono text-[12px] font-semibold text-[#1A1F36]`}>{d.path}</td>
                            <td className={`${td} bg-red-50/60 max-w-[380px]`}>{show(d.before)}</td>
                            <td className={`${td} bg-emerald-50/60 max-w-[380px]`}>{show(d.after)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
