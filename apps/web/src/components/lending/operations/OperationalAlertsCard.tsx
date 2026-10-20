"use client";

import { useTranslations } from 'next-intl';
import { Card, Notice } from '../ui';
import { useApi } from '../useAsync';
import { fmtDateTime } from '../format';
import { useWorkspace } from '@/lib/workspace';

export interface OperationalAlert {
    id: string;
    key: string;
    severity: 'CRITICAL' | 'WARNING';
    status: 'OPEN' | 'RESOLVED';
    summary: string;
    openedAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
    lastNotifiedAt: string | null;
    lastDelivery: 'EMAIL' | 'LOG_ONLY' | 'FAILED' | null;
}

/** The translated name of an alert's check, by its stable key (OpsAlerts.keys.*). */
export function useAlertTitle() {
    const t = useTranslations('OpsAlerts');
    return (key: string) => {
        const k = `keys.${key.replace(/\./g, '_')}`;
        return t.has(k) ? t(k) : key;
    };
}

/**
 * This lender's open operational alerts (D-150), above the operations tabs:
 * end of day behind or failing, month end not closed, outbox or webhook
 * backlog, reconciliation breaks, failed scheduled jobs. Shown only when
 * something is open; the health monitor resolves them by itself.
 */
export function OperationalAlertsCard() {
    const t = useTranslations('OpsAlerts');
    const title = useAlertTitle();
    const { can } = useWorkspace();
    // Asked only of those allowed to read it, so nobody else gets a refusal toast.
    const { data } = useApi<{ open: OperationalAlert[]; recentlyResolved: OperationalAlert[] }>(can('tenant_settings.read') ? '/lending/ops/alerts' : null);
    if (!data || data.open.length === 0) return null;
    const critical = data.open.some((a) => a.severity === 'CRITICAL');
    return (
        <Card title={t('title', { count: data.open.length })} subtitle={t('subtitle')}>
            <div className="space-y-2">
                {data.open.map((a) => (
                    <Notice key={a.id} tone={a.severity === 'CRITICAL' ? 'danger' : 'warn'} title={title(a.key)}>
                        <span className="block">{a.summary}</span>
                        <span className="block text-[11px] opacity-80">
                            {t('since', { at: fmtDateTime(a.openedAt) })}
                            {a.lastNotifiedAt ? ` · ${t(`delivery.${a.lastDelivery ?? 'LOG_ONLY'}`, { at: fmtDateTime(a.lastNotifiedAt) })}` : ''}
                        </span>
                    </Notice>
                ))}
                <p className="text-[12px] text-[#697386]">{critical ? t('criticalHint') : t('hint')}</p>
            </div>
        </Card>
    );
}
