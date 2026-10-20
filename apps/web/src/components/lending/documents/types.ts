export const DOCUMENT_CATEGORIES = ['KYC', 'APPLICATION', 'LOAN', 'COLLATERAL', 'AGREEMENT', 'GENERATED', 'OTHER'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export interface DocumentVersion {
    id: string;
    version: number;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storageProvider: string;
    uploadedBy: string;
    uploaderType: 'USER' | 'CUSTOMER' | 'SYSTEM';
    note: string;
    reviewStatus: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
    purged: boolean;
    createdAt: string;
}

export interface CustomerDocument {
    id: string;
    borrowerId: string;
    category: DocumentCategory;
    typeCode: string;
    title: string;
    applicationId: string | null;
    loanAccountId: string | null;
    legacyLoanId: string | null;
    collateralId: string | null;
    requestId: string | null;
    origin: 'STAFF' | 'PORTAL' | 'GENERATED' | 'LEGACY';
    customerVisible: boolean;
    reviewStatus: 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'NOT_REQUIRED';
    currentVersion: number;
    issuedOn: string | null;
    expiresOn: string | null;
    daysToExpiry: number | null;
    expired: boolean;
    expiryState: 'NONE' | 'REMINDED' | 'EXPIRED';
    legalHold: boolean;
    legalHoldReason: string | null;
    status: 'ACTIVE' | 'DELETED';
    deletedAt: string | null;
    deletionReason: string | null;
    legacySource: string | null;
    retentionYears: number;
    createdBy: string;
    createdAt: string;
    versions: DocumentVersion[];
}

export interface DocumentRequest {
    id: string;
    borrowerId: string;
    category: DocumentCategory;
    typeCode: string;
    label: string;
    message: string;
    applicationId: string | null;
    dueOn: string | null;
    status: 'OPEN' | 'SUBMITTED' | 'ACCEPTED' | 'CANCELLED';
    documentId: string | null;
    lastRejection: string | null;
    createdAt: string;
}

export interface ChecklistItem {
    code: string;
    label: string;
    stage: string;
    mandatory: boolean;
    status: 'ACCEPTED' | 'PENDING_REVIEW' | 'REJECTED' | 'EXPIRED' | 'REQUESTED' | 'MISSING';
    present: boolean;
    documentIds: string[];
}

export interface Library {
    borrowerId: string;
    businessDate: string;
    documents: CustomerDocument[];
    requests: DocumentRequest[];
    checklist: { applicationId: string; reference: string; status: string; items: ChecklistItem[] }[];
}

export interface DocumentDetail extends CustomerDocument {
    retention: {
        years: number;
        source: string;
        relationshipOpen: boolean;
        retainUntil: string | null;
        eligibleForDeletion: boolean;
    };
    request: DocumentRequest | null;
    accessLog: { id: string; actorId: string; actorType: string; action: string; outcome: string; eventTime: string }[];
}

export interface DocumentLink {
    url: string;
    external: boolean;
    expiresAt: string;
    fileName: string;
}

export const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png,image/webp';
/** The API refuses files over 3.5 MB (base64 in a 5 MB JSON body). */
export const MAX_BYTES = 3.5 * 1024 * 1024;

/** Read a browser File as the base64 body the API expects. `tf` translates "LendingDocuments.file" keys. */
export function readFile(file: File, tf: (key: 'tooLarge' | 'unreadable') => string): Promise<{ fileName: string; mimeType: string; contentBase64: string }> {
    return new Promise((resolve, reject) => {
        if (file.size > MAX_BYTES) {
            reject(new Error(tf('tooLarge')));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(tf('unreadable')));
        reader.onload = () => {
            const s = String(reader.result || '');
            resolve({ fileName: file.name, mimeType: file.type, contentBase64: s.slice(s.indexOf(',') + 1) });
        };
        reader.readAsDataURL(file);
    });
}

/** Open a short-lived link: S3 links are absolute; API links go through the proxy. */
export function openLink(link: DocumentLink) {
    const href = link.external ? link.url : `/api/proxy${link.url}`;
    window.open(href, '_blank', 'noopener');
}

export function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
