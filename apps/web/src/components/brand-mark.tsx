import Image from 'next/image';

/**
 * The product wordmark.
 *
 * Replaces a hardcoded `M` div that had been copy-pasted into four screens —
 * the real logo file existed in `public/` the whole time but nothing rendered
 * it. Keeping the mark in one component is what stops the next screen from
 * inventing a fifth version of it.
 *
 * The PNG carries its own rounded corners in the alpha channel, so no CSS
 * rounding here — that would clip the artwork a second time and fringe it.
 */
export function BrandMark({
    size = 28,
    showName = true,
    className = '',
}: {
    size?: number;
    showName?: boolean;
    className?: string;
}) {
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <Image
                src="/logo.png"
                // Decorative when the name is beside it; the name already
                // carries the meaning, so announcing it twice is noise.
                alt={showName ? '' : 'MicroLoan'}
                aria-hidden={showName || undefined}
                width={size}
                height={size}
                priority
                className="shrink-0"
            />
            {showName && (
                <span className="text-[16px] font-bold text-foreground">MicroLoan</span>
            )}
        </div>
    );
}
