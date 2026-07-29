import { Check } from 'lucide-react';

/**
 * The signup journey, made visible.
 *
 * Creating a workspace spans three screens — the form, a KHQR payment page you
 * may sit on for hours, and finally a login — but nothing told you that. On a
 * paid plan you submitted a form and landed on a QR code with no sense of how
 * much was left or whether something had gone wrong. This is the map.
 *
 * The payment step is conditional: a free plan activates immediately, and
 * showing a step that will never run implies work that isn't coming.
 */

export type JourneyStep = 'details' | 'payment' | 'active';

const ORDER: JourneyStep[] = ['details', 'payment', 'active'];

export function SignupJourney({
    current,
    includePayment,
    labels,
    className = '',
}: {
    current: JourneyStep;
    /** False on a free plan, where activation is immediate. */
    includePayment: boolean;
    /** Pre-translated, in journey order: details, payment, active. */
    labels: Record<JourneyStep, string>;
    className?: string;
}) {
    const steps = ORDER.filter(s => includePayment || s !== 'payment');
    const currentIndex = steps.indexOf(current);

    return (
        <ol className={`flex items-center gap-2 ${className}`} aria-label="Progress">
            {steps.map((step, i) => {
                const done = i < currentIndex;
                const active = i === currentIndex;
                return (
                    <li key={step} className="flex flex-1 items-center gap-2 min-w-0">
                        <span
                            aria-current={active ? 'step' : undefined}
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${done
                                ? 'bg-primary text-white'
                                : active
                                    ? 'bg-primary text-white ring-4 ring-primary/15'
                                    : 'bg-secondary text-muted-foreground border border-border'
                                }`}
                        >
                            {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                        </span>
                        <span
                            className={`truncate text-[11px] ${active
                                ? 'font-semibold text-foreground'
                                : 'text-muted-foreground'
                                }`}
                        >
                            {labels[step]}
                        </span>
                        {/* Connector, not after the last step. flex-1 makes it
                            absorb the leftover width so the steps stay evenly
                            spread whatever the label lengths — Khmer labels run
                            noticeably longer than English. */}
                        {i < steps.length - 1 && (
                            <span
                                aria-hidden
                                className={`h-px flex-1 min-w-[8px] ${done ? 'bg-primary' : 'bg-border'}`}
                            />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
