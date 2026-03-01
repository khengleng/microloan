"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskPhone = maskPhone;
exports.maskIdNumber = maskIdNumber;
exports.maskEmail = maskEmail;
exports.maskName = maskName;
exports.scrubSensitiveKeys = scrubSensitiveKeys;
exports.maskBorrowerForAudit = maskBorrowerForAudit;
exports.maskUserForAudit = maskUserForAudit;
exports.maskBorrowerDto = maskBorrowerDto;
const SENSITIVE_KEYS = new Set([
    'password', 'passwordHash', 'adminPassword', 'twoFactorSecret',
    'secret', 'token', 'access_token', 'refresh_token', 'authorization',
    'apiKey', 'api_key',
]);
function partialMask(value, showFirst = 0, showLast = 0) {
    if (!value || value.length <= showFirst + showLast)
        return '***';
    const masked = '*'.repeat(Math.max(3, value.length - showFirst - showLast));
    return value.slice(0, showFirst) + masked + value.slice(value.length - showLast || value.length);
}
function maskPhone(phone) {
    if (!phone)
        return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4)
        return '****';
    return '****' + digits.slice(-4);
}
function maskIdNumber(id) {
    if (!id)
        return '';
    return partialMask(id, 2, 0);
}
function maskEmail(email) {
    if (!email || !email.includes('@'))
        return email;
    const [local, domain] = email.split('@');
    if (local.length <= 2)
        return `${local[0]}***@${domain}`;
    return `${local[0]}${local[1]}***@${domain}`;
}
function maskName(name) {
    if (!name)
        return '';
    return name.split(' ')
        .filter(Boolean)
        .map(n => n[0].toUpperCase() + '.')
        .join(' ');
}
function scrubSensitiveKeys(obj, depth = 0) {
    if (depth > 5 || obj === null || obj === undefined)
        return obj;
    if (Array.isArray(obj))
        return obj.map(v => scrubSensitiveKeys(v, depth + 1));
    if (typeof obj !== 'object')
        return obj;
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        const lk = key.toLowerCase();
        if (SENSITIVE_KEYS.has(lk) || SENSITIVE_KEYS.has(key)) {
            result[key] = '[REDACTED]';
        }
        else if (lk === 'phone' && typeof value === 'string') {
            result[key] = maskPhone(value);
        }
        else if ((lk === 'idnumber' || lk === 'id_number' || lk === 'nationid') && typeof value === 'string') {
            result[key] = maskIdNumber(value);
        }
        else {
            result[key] = scrubSensitiveKeys(value, depth + 1);
        }
    }
    return result;
}
function maskBorrowerForAudit(borrower) {
    if (!borrower)
        return null;
    return {
        id: borrower.id,
        name: `${borrower.firstName?.[0] ?? ''}. ${borrower.lastName?.[0] ?? ''}.`,
        phone: maskPhone(borrower.phone || ''),
        idNumber: maskIdNumber(borrower.idNumber || ''),
        address: borrower.address ? borrower.address.replace(/\d+/g, 'XX') : '',
        tenantId: borrower.tenantId,
    };
}
function maskUserForAudit(user) {
    if (!user)
        return null;
    return {
        id: user.id,
        email: maskEmail(user.email || ''),
        role: user.role,
    };
}
function maskBorrowerDto(dto) {
    return {
        firstName: dto.firstName?.[0] ? dto.firstName[0] + '.' : '',
        lastName: dto.lastName?.[0] ? dto.lastName[0] + '.' : '',
        phone: maskPhone(dto.phone || ''),
        idNumber: maskIdNumber(dto.idNumber || ''),
        address: dto.address ? '[address recorded]' : '',
        dob: dto.dob ? '[dob recorded]' : undefined,
    };
}
//# sourceMappingURL=mask.js.map