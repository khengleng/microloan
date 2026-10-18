// Credit Bureau Cambodia (CBC) provider abstraction.
//
// Licensed lenders in Cambodia must query CBC at origination and report loan
// performance. The real CBC API requires member credentials and an
// interbank/whitelisted network, which are provisioned per-institution. This
// interface isolates that integration so the rest of the app is provider-
// agnostic. Until real credentials (CBC_API_URL / CBC_API_KEY) are configured
// the bureau is simply unavailable: there is no sandbox that could pass a
// fabricated score off as a bureau result.

export interface CbcSubject {
    firstName: string;
    lastName: string;
    idNumber?: string | null;
    phone?: string | null;
}

export interface CbcCreditReport {
    score: number; // bureau score (e.g. 300–850 range)
    grade: string; // derived letter grade A..E
    reportRef: string; // bureau's reference id
    summary: string; // human-readable, no raw PII
}

export interface CbcProvider {
    readonly name: string;
    checkCredit(subject: CbcSubject): Promise<CbcCreditReport>;
}

// Message shown when the bureau integration has not been provisioned yet.
export const CBC_NOT_READY_MESSAGE = 'CBC integration is not ready.';

/** True only when real CBC member credentials are configured. */
export function isCbcConfigured(): boolean {
    return !!(process.env.CBC_API_URL?.trim() && process.env.CBC_API_KEY?.trim());
}

function gradeForScore(score: number): string {
    if (score >= 750) return 'A';
    if (score >= 650) return 'B';
    if (score >= 550) return 'C';
    if (score >= 450) return 'D';
    return 'E';
}

/**
 * Live CBC provider. Posts an enquiry to the member API and maps the response.
 * The exact request/response contract is defined by CBC's member spec; the
 * mapping below is defensive and should be adjusted to the institution's
 * onboarding documentation.
 */
export class HttpCbcProvider implements CbcProvider {
    readonly name = 'CBC';
    constructor(
        private readonly apiUrl: string,
        private readonly apiKey: string,
    ) { }

    async checkCredit(subject: CbcSubject): Promise<CbcCreditReport> {
        const res = await fetch(`${this.apiUrl.replace(/\/$/, '')}/enquiries`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                firstName: subject.firstName,
                lastName: subject.lastName,
                nationalId: subject.idNumber || undefined,
                phone: subject.phone || undefined,
            }),
        });
        if (!res.ok) {
            throw new Error(`CBC enquiry failed with status ${res.status}`);
        }
        const body: any = await res.json();
        const score = Number(body.score ?? body.creditScore ?? 0);
        return {
            score,
            grade: String(body.grade ?? gradeForScore(score)),
            reportRef: String(body.reportId ?? body.referenceId ?? ''),
            summary: String(body.summary ?? 'CBC report retrieved.'),
        };
    }
}
