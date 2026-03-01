/**
 * Data masking utilities for audit trail compliance.
 *
 * Rules:
 *  - Passwords / secrets          → never logged (replaced with '[REDACTED]')
 *  - National ID / ID numbers     → first 2 digits visible, rest masked  e.g. "12*******"
 *  - Phone numbers                → last 4 digits only  e.g. "****1234"
 *  - Email addresses              → local part masked   e.g. "jo***@example.com"
 *  - JWT / bearer tokens          → '[TOKEN]'
 *  - Full names in delete records → initials only       e.g. "J. D."
 */

const SENSITIVE_KEYS = new Set([
    'password', 'passwordHash', 'adminPassword', 'twoFactorSecret',
    'secret', 'token', 'access_token', 'refresh_token', 'authorization',
    'apiKey', 'api_key',
]);

/** Replace a string with asterisks keeping first N and last M chars */
function partialMask(value: string, showFirst = 0, showLast = 0): string {
    if (!value || value.length <= showFirst + showLast) return '***';
    const masked = '*'.repeat(Math.max(3, value.length - showFirst - showLast));
    return value.slice(0, showFirst) + masked + value.slice(value.length - showLast || value.length);
}

export function maskPhone(phone: string): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '****';
    return '****' + digits.slice(-4);
}

export function maskIdNumber(id: string): string {
    if (!id) return '';
    return partialMask(id, 2, 0);
}

export function maskEmail(email: string): string {
    if (!email || !email.includes('@')) return email;
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    return `${local[0]}${local[1]}***@${domain}`;
}

export function maskName(name: string): string {
    // Returns initials: "John Doe" → "J. D."
    if (!name) return '';
    return name.split(' ')
        .filter(Boolean)
        .map(n => n[0].toUpperCase() + '.')
        .join(' ');
}

/** Recursively scrub sensitive keys from any object */
export function scrubSensitiveKeys(obj: any, depth = 0): any {
    if (depth > 5 || obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(v => scrubSensitiveKeys(v, depth + 1));
    if (typeof obj !== 'object') return obj;

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
        const lk = key.toLowerCase();
        if (SENSITIVE_KEYS.has(lk) || SENSITIVE_KEYS.has(key)) {
            result[key] = '[REDACTED]';
        } else if (lk === 'phone' && typeof value === 'string') {
            result[key] = maskPhone(value);
        } else if ((lk === 'idnumber' || lk === 'id_number' || lk === 'nationid') && typeof value === 'string') {
            result[key] = maskIdNumber(value);
        } else {
            result[key] = scrubSensitiveKeys(value, depth + 1);
        }
    }
    return result;
}

/**
 * Build a safe audit metadata object for a Borrower record.
 * Only stores: masked name, masked phone, masked ID, address (non-sensitive), and IDs.
 */
export function maskBorrowerForAudit(borrower: any): any {
    if (!borrower) return null;
    return {
        id: borrower.id,
        name: `${borrower.firstName?.[0] ?? ''}. ${borrower.lastName?.[0] ?? ''}.`,
        phone: maskPhone(borrower.phone || ''),
        idNumber: maskIdNumber(borrower.idNumber || ''),
        address: borrower.address ? borrower.address.replace(/\d+/g, 'XX') : '',
        tenantId: borrower.tenantId,
    };
}

/**
 * Build safe audit metadata for a User record.
 * Strips password hash, MFA secret.
 */
export function maskUserForAudit(user: any): any {
    if (!user) return null;
    return {
        id: user.id,
        email: maskEmail(user.email || ''),
        role: user.role,
    };
}

/**
 * Safe DTO for borrower create/update.
 * Phone and idNumber are masked before storage.
 */
export function maskBorrowerDto(dto: any): any {
    return {
        firstName: dto.firstName?.[0] ? dto.firstName[0] + '.' : '',
        lastName: dto.lastName?.[0] ? dto.lastName[0] + '.' : '',
        phone: maskPhone(dto.phone || ''),
        idNumber: maskIdNumber(dto.idNumber || ''),
        address: dto.address ? '[address recorded]' : '',
        dob: dto.dob ? '[dob recorded]' : undefined,
    };
}
