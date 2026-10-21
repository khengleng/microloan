/** Repayments to the lender's static KHQR code (DECISIONS D-160…D-165). */

export type KhqrCurrency = 'USD' | 'KHR';
export const KHQR_CURRENCIES: KhqrCurrency[] = ['USD', 'KHR'];

export interface KhqrCode {
    id: string;
    branchId: string | null;
    currency: string;
    /** GENERATED, UPLOADED_PAYLOAD, UPLOADED_IMAGE */
    source: string;
    bakongAccountId: string;
    merchantName: string;
    merchantCity: string;
    bankName: string | null;
    accountNumber: string | null;
    payload: string | null;
    /** PENDING, ACTIVE, REJECTED, RETIRED */
    status: string;
    makerId: string;
    checkerId: string | null;
    decidedAt: string | null;
    reason: string;
    createdAt: string;
    image: string | null;
}

export interface CodesView {
    active: KhqrCode[];
    pending: KhqrCode[];
    history: KhqrCode[];
    branches: { id: string; name: string; code: string }[];
}

/** What a borrower is shown to pay with. */
export interface PayableCode {
    id: string;
    currency: string;
    branchId: string | null;
    merchantName: string;
    merchantCity: string;
    bakongAccountId: string;
    bankName: string | null;
    accountNumber: string | null;
    payload: string | null;
    image: string;
}

export type ReceiptSource = 'PORTAL_CLAIM' | 'STAFF' | 'STATEMENT';
export const RECEIPT_SOURCES: ReceiptSource[] = ['PORTAL_CLAIM', 'STAFF', 'STATEMENT'];
export const RECEIPT_STATUSES = ['PENDING', 'POSTED', 'REJECTED'] as const;

export interface Receipt {
    id: string;
    reference: string;
    loanAccountId: string;
    loanReference: string | null;
    borrowerId: string;
    borrowerName?: string;
    source: ReceiptSource;
    status: 'PENDING' | 'POSTED' | 'REJECTED';
    amount: string;
    currency: string;
    paidAt: string;
    valueDate: string;
    bankRef: string;
    payerName: string | null;
    payerAccount: string | null;
    remark: string;
    screenshotDocumentId: string | null;
    statementLineId: string | null;
    unidentifiedPaymentId: string | null;
    makerType: string;
    makerId: string;
    decidedBy: string | null;
    decidedAt: string | null;
    decisionNote: string;
    financialEventId: string | null;
    createdAt: string;
    /** The signed-in person recorded it: they cannot verify it. */
    yours?: boolean;
}

export interface QueueView {
    counts: Record<string, number>;
    receipts: Receipt[];
}

export interface LoanReceiptsView {
    reference: string;
    currency: string;
    code: PayableCode | null;
    receipts: Receipt[];
}

export interface StatementMapping {
    code: string;
    label: string;
    verified: boolean;
}

export interface MappingsView {
    autoPost: boolean;
    claimMatchWindowDays: number;
    mappings: StatementMapping[];
}

export interface PreviewLine {
    lineNo: number;
    valueDate: string;
    amount: string;
    currency: string;
    bankRef: string;
    payerName: string | null;
    payerAccount: string | null;
    remark: string;
    proposed: 'POST' | 'HOLD_FOR_VERIFICATION' | 'SUSPENSE' | 'DUPLICATE';
    rule: string | null;
    loanReference: string | null;
    reason: string;
}

export interface PreviewView {
    dryRun: true;
    mapping: string;
    columns: Record<string, string>;
    skipped: { lineNo: number; reason: string }[];
    totals: Record<string, string>;
    autoPost: boolean;
    lines: PreviewLine[];
}

/** A small sample in the generic layout, shown as the file format. */
export const STATEMENT_SAMPLE = [
    'Transaction Date,Reference No,Description,Sender Name,From Account,Credit,Currency',
    '05/02/2026,FT26036AB12C,LN-260105-AB12CD,SOK DARA,sokdara@bank,50.00,USD',
    '05/02/2026,8a3f9c21e4,thank you,CHAN SOKHA,,200000,KHR',
].join('\n');

/** Read a picked file: CSV as text, a spreadsheet as base64. */
export async function readStatementFile(file: File): Promise<{ content?: string; contentBase64?: string }> {
    if (/\.xlsx$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { contentBase64: btoa(bin) };
    }
    return { content: await file.text() };
}

/** A picked image as base64 (no data: prefix) and its type. */
export function readImage(file: File): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
            const dataUrl = String(r.result || '');
            resolve({ dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: file.type });
        };
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}
