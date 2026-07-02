// Email / SMS delivery abstraction.
//
// Kept dependency-free: the email provider talks to Resend over HTTP and the SMS
// provider posts to a generic gateway — both via fetch, no SDKs. When the
// relevant credentials are absent the provider is a no-op that logs and reports
// "not configured" (never throws), so the rest of the app can call notifications
// unconditionally and they simply activate once a provider is set.

export interface SendResult {
    sent: boolean;
    provider: string;
    reason?: string;
    ref?: string;
}

export function isEmailConfigured(): boolean {
    return !!process.env.RESEND_API_KEY?.trim();
}

export function isSmsConfigured(): boolean {
    return !!(process.env.SMS_API_URL?.trim() && process.env.SMS_API_KEY?.trim());
}

export async function sendEmailViaProvider(
    to: string,
    subject: string,
    html: string,
): Promise<SendResult> {
    if (!isEmailConfigured()) {
        return { sent: false, provider: 'none', reason: 'Email provider not configured (set RESEND_API_KEY).' };
    }
    const from = process.env.EMAIL_FROM?.trim() || 'no-reply@localhost';
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        },
        body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
        return { sent: false, provider: 'resend', reason: `Email send failed (HTTP ${res.status}).` };
    }
    const body: any = await res.json().catch(() => ({}));
    return { sent: true, provider: 'resend', ref: body?.id };
}

export async function sendSmsViaProvider(to: string, message: string): Promise<SendResult> {
    if (!isSmsConfigured()) {
        return { sent: false, provider: 'none', reason: 'SMS provider not configured (set SMS_API_URL/SMS_API_KEY).' };
    }
    const res = await fetch(process.env.SMS_API_URL!.trim(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SMS_API_KEY!.trim()}`,
        },
        body: JSON.stringify({ to, message }),
    });
    if (!res.ok) {
        return { sent: false, provider: 'sms', reason: `SMS send failed (HTTP ${res.status}).` };
    }
    return { sent: true, provider: 'sms' };
}
