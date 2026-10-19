import type { DiffEntry } from '../types';

export type PolicyKind = 'PREPAYMENT' | 'LATE_CHARGES' | 'ALLOCATION' | 'NON_ACCRUAL';
export type PolicyVersionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETIRED';

export const POLICY_KINDS: PolicyKind[] = ['PREPAYMENT', 'LATE_CHARGES', 'ALLOCATION', 'NON_ACCRUAL'];

export const KIND_INFO: Record<PolicyKind, { label: string; keys: string[]; path: string }> = {
    PREPAYMENT: {
        label: 'Prepayment & lock-in',
        keys: ['prepayment', 'earlySettlement', 'earlyRepaymentCharges'],
        path: 'repayment.prepayment / earlySettlement / earlyRepaymentCharges',
    },
    LATE_CHARGES: { label: 'Late charges', keys: ['penalty'], path: 'pricing.penalty' },
    ALLOCATION: { label: 'Payment allocation', keys: ['allocation'], path: 'repayment.allocation' },
    NON_ACCRUAL: { label: 'Non-accrual', keys: ['nonAccrual'], path: 'operations.nonAccrual' },
};

export interface PolicyParameter {
    type: 'int' | 'decimal';
    default: number;
    min: number;
    max: number;
    label?: string;
}

export interface LendingPolicyVersion {
    id: string;
    policyId: string;
    version: number;
    status: PolicyVersionStatus | string;
    parameters: Record<string, PolicyParameter>;
    body: Record<string, unknown>;
    bodyHash: string;
    changeSummary: string;
    makerId: string;
    submittedAt: string | null;
    checkerId: string | null;
    approvedAt: string | null;
    retiredAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
}

export interface LendingPolicy {
    id: string;
    kind: PolicyKind;
    code: string;
    name: string;
    description: string;
    createdBy: string;
    createdAt: string;
    versions: LendingPolicyVersion[];
}

/** One editable row of the parameters table (numbers kept as text while editing). */
export interface ParamRow {
    name: string;
    type: 'int' | 'decimal';
    default: string;
    min: string;
    max: string;
    label: string;
}

export interface PolicyTemplate {
    label: string;
    description: string;
    parameters: Record<string, PolicyParameter>;
    body: Record<string, unknown>;
}

/** Starter templates per kind: each body has exactly the shape of its configuration part. */
export const POLICY_TEMPLATES: Record<PolicyKind, PolicyTemplate[]> = {
    PREPAYMENT: [
        {
            label: 'Lock-in: charge during the first months',
            description: '3% of the amount repaid early until the lock-in ends; free afterwards.',
            parameters: { lockInMonths: { type: 'int', default: 12, min: 6, max: 24, label: 'Lock-in months' } },
            body: {
                earlyRepaymentCharges: {
                    basis: 'AMOUNT_REPAID',
                    tiers: [{ untilMonth: { $param: 'lockInMonths' }, action: 'CHARGE', rate: '0.03' }],
                },
            },
        },
        {
            label: 'Hard lock-in: refuse, then charge',
            description: 'No early repayment for the first months, then a declining charge.',
            parameters: { lockInMonths: { type: 'int', default: 6, min: 3, max: 12, label: 'Hard lock-in months' } },
            body: {
                earlyRepaymentCharges: {
                    appliesTo: ['PARTIAL_PREPAYMENT', 'EARLY_SETTLEMENT'],
                    basis: 'OUTSTANDING_PRINCIPAL',
                    tiers: [
                        { untilMonth: { $param: 'lockInMonths' }, action: 'REFUSE' },
                        { untilMonth: 24, action: 'CHARGE', rate: '0.02' },
                    ],
                },
            },
        },
        {
            label: 'Free prepayment',
            description: 'Partial prepayment and early settlement allowed without a fee.',
            parameters: {},
            body: {
                prepayment: { allowed: true, minAmount: null, feeRate: null, allowedStrategies: ['RECAST', 'SHORTEN'], defaultStrategy: 'RECAST' },
                earlySettlement: { allowed: true, feeRate: null, feeFixed: null, rebateMethod: 'ACCRUED' },
                earlyRepaymentCharges: { appliesTo: ['PARTIAL_PREPAYMENT', 'EARLY_SETTLEMENT'], basis: 'AMOUNT_REPAID', tiers: [] },
            },
        },
    ],
    LATE_CHARGES: [
        {
            label: 'Rate on overdue with grace days',
            description: '18% p.a. on overdue amounts after a grace period, capped per instalment.',
            parameters: { graceDays: { type: 'int', default: 3, min: 0, max: 30, label: 'Grace days' } },
            body: {
                penalty: { type: 'RATE_ON_OVERDUE', annualRate: '0.18', flatAmount: null, graceDays: { $param: 'graceDays' }, capPerInstalment: '50.00' },
            },
        },
        {
            label: 'Flat fee per late instalment',
            description: 'A fixed charge per instalment paid late.',
            parameters: {},
            body: { penalty: { type: 'FLAT_PER_INSTALMENT', flatAmount: '5.00', annualRate: null, graceDays: 0, capPerInstalment: null } },
        },
    ],
    ALLOCATION: [
        {
            label: 'Penalty first, excess held as advance',
            description: 'penalty > fee > tax > interest > principal; oldest due first.',
            parameters: {},
            body: { allocation: { order: ['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL'], strategy: 'OLDEST_DUE_FIRST', excessHandling: 'ADVANCE' } },
        },
        {
            label: 'Interest first, excess prepays',
            description: 'interest > principal > fee > tax > penalty; excess reduces principal now.',
            parameters: {},
            body: { allocation: { order: ['INTEREST', 'PRINCIPAL', 'FEE', 'TAX', 'PENALTY'], strategy: 'OLDEST_DUE_FIRST', excessHandling: 'PREPAY' } },
        },
    ],
    NON_ACCRUAL: [
        {
            label: 'Non-accrual from N days past due',
            description: 'Interest to suspense from the threshold; cured at 0 days past due.',
            parameters: { fromDpd: { type: 'int', default: 90, min: 30, max: 360, label: 'Days past due' } },
            body: { nonAccrual: { enabled: true, fromDpd: { $param: 'fromDpd' }, cureAtDpd: 0, reverseAccruedOnEntry: true } },
        },
    ],
};

export function paramsToRows(p: Record<string, PolicyParameter> | null | undefined): ParamRow[] {
    return Object.entries(p ?? {}).map(([name, v]) => ({
        name,
        type: v.type,
        default: String(v.default),
        min: String(v.min),
        max: String(v.max),
        label: v.label ?? '',
    }));
}

/** Convert the parameter table into the API shape, or return the problems found. */
export function rowsToParams(rows: ParamRow[]): { params?: Record<string, PolicyParameter>; problems: string[] } {
    const problems: string[] = [];
    const out: Record<string, PolicyParameter> = {};
    rows.forEach((r, i) => {
        const at = `Parameter ${i + 1}${r.name ? ` (${r.name})` : ''}`;
        if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(r.name)) problems.push(`${at}: name must start with a letter and contain letters/digits only.`);
        if (out[r.name]) problems.push(`${at}: duplicate name.`);
        const nums = [r.default, r.min, r.max].map((s) => Number(s.trim()));
        if ([r.default, r.min, r.max].some((s) => s.trim() === '') || nums.some((n) => !Number.isFinite(n))) {
            problems.push(`${at}: default, min and max must be numbers.`);
            return;
        }
        const [def, min, max] = nums;
        if (r.type === 'int' && nums.some((n) => !Number.isInteger(n))) problems.push(`${at}: an int parameter needs whole numbers.`);
        if (!(min <= def && def <= max)) problems.push(`${at}: the default must lie between min and max.`);
        out[r.name] = { type: r.type, default: def, min, max, ...(r.label.trim() ? { label: r.label.trim() } : {}) };
    });
    if (rows.length > 10) problems.push('At most 10 parameters.');
    return problems.length ? { problems } : { params: out, problems };
}

/** Every `{ "$param": name }` reference used in a body. */
export function paramRefs(value: unknown, acc: Set<string> = new Set()): Set<string> {
    if (Array.isArray(value)) value.forEach((v) => paramRefs(v, acc));
    else if (value && typeof value === 'object') {
        const o = value as Record<string, unknown>;
        if (Object.keys(o).length === 1 && typeof o.$param === 'string') acc.add(o.$param);
        else Object.values(o).forEach((v) => paramRefs(v, acc));
    }
    return acc;
}

/** Structural diff of two JSON values as `[{ path, before, after }]` for <JsonDiff>. */
export function jsonDiff(before: unknown, after: unknown, path = ''): DiffEntry[] {
    const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    if (Array.isArray(before) && Array.isArray(after)) {
        const out: DiffEntry[] = [];
        for (let i = 0; i < Math.max(before.length, after.length); i++) {
            out.push(...jsonDiff(before[i], after[i], `${path}[${i}]`));
        }
        return out;
    }
    if (isObj(before) && isObj(after)) {
        const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
        return keys.flatMap((k) => jsonDiff(before[k], after[k], path ? `${path}.${k}` : k));
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [{ path: path || '(root)', before, after }];
}
