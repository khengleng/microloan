"use client";

import { useTranslations } from 'next-intl';
import { Disclosure } from '../ui';
import { DecisionExplain } from '../DecisionExplain';
import type { Capabilities } from '../useAsync';

/**
 * "Why can't I…" — lists every action the capability map reports as blocked,
 * with the policy layers responsible. Server enforcement remains authoritative.
 */
export function WhyBlocked({ caps, actions }: { caps: Capabilities | undefined; actions: { code: string; label: string }[] }) {
    const t = useTranslations('LendingOrigination');
    if (!caps) return null;
    const blocked = actions.filter((a) => caps[a.code] && !caps[a.code].allowed);
    if (blocked.length === 0) return null;
    return (
        <Disclosure summary={t('whyBlocked.summary', { count: blocked.length })}>
            <div className="space-y-3 border border-[#E3E8EE] rounded-md p-3 bg-[#F7FAFC]">
                {blocked.map((a) => (
                    <div key={a.code}>
                        <p className="text-[12px] font-bold text-[#1A1F36]">
                            {a.label} <span className="font-mono text-[10px] text-[#8792A2]">{a.code}</span>
                        </p>
                        <div className="mt-1">
                            <DecisionExplain blockedBy={caps[a.code].blockedBy} />
                        </div>
                    </div>
                ))}
            </div>
        </Disclosure>
    );
}
