import type { Comparison, CondOp, Condition, PolicyRule } from '../types';
import { isDecimalString } from '../format';

export const POLICY_ATTRIBUTES = [
    'resource.amount', 'resource.currency', 'resource.familyCode', 'resource.productCode', 'resource.branchId',
    'resource.legalEntityId', 'resource.portfolioId', 'resource.riskCategory', 'resource.dataClassification',
    'resource.workflowState', 'resource.segment', 'subject.branchId', 'subject.roles', 'subject.assurance',
    'environment.channel', 'environment.assurance', 'environment.hourUtc', 'environment.dayOfWeek',
] as const;

export const POLICY_OPERATORS: { value: CondOp; label: string }[] = [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'in', label: 'in list' },
    { value: 'nin', label: 'not in list' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
    { value: 'exists', label: 'exists' },
    { value: 'contains', label: 'contains' },
];

const NUMERIC_ATTRS = new Set(['environment.hourUtc', 'environment.dayOfWeek']);

/** One editable comparison row. `value` is always the raw text the user typed. */
export interface CompDraft { key: string; not: boolean; attr: string; op: CondOp; value: string }

export interface RuleDraft {
    key: string;
    id: string;
    effect: 'DENY' | 'REQUIRE';
    actions: string[];
    combinator: 'all' | 'any';
    comparisons: CompDraft[];
    /** Set when a loaded condition is too deep for the builder; kept verbatim. */
    raw?: Condition;
    message: string;
}

let seq = 0;
export function nextKey(): string {
    seq += 1;
    return `k${seq}`;
}

export function newComparison(): CompDraft {
    return { key: nextKey(), not: false, attr: 'resource.amount', op: 'gt', value: '' };
}

export function newRule(): RuleDraft {
    return { key: nextKey(), id: '', effect: 'DENY', actions: [], combinator: 'all', comparisons: [newComparison()], message: '' };
}

export const RULE_ID_RE = /^[a-z0-9_-]{2,40}$/;
export const ACTION_RE = /^[a-z_.]+(\.\*)?$/;

/* ── Draft → API ─────────────────────────────────────────────────────────── */

function convertScalar(attr: string, op: CondOp, text: string): { value?: unknown; error?: string } {
    const t = text.trim();
    if (op === 'exists') return { value: t !== 'false' };
    if (op === 'in' || op === 'nin') {
        const parts = t.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0) return { error: 'enter at least one value' };
        if (NUMERIC_ATTRS.has(attr)) {
            if (parts.some((p) => !/^\d+$/.test(p))) return { error: 'values must be whole numbers' };
            return { value: parts.map((p) => Number(p)) };
        }
        if (attr === 'resource.amount' && parts.some((p) => !isDecimalString(p))) return { error: 'amounts must be decimals' };
        return { value: parts };
    }
    if (!t) return { error: 'value required' };
    if (NUMERIC_ATTRS.has(attr)) {
        if (!/^\d+$/.test(t)) return { error: 'must be a whole number' };
        return { value: Number(t) };
    }
    if (attr === 'resource.amount') {
        if (!isDecimalString(t)) return { error: 'must be a decimal, e.g. 10000.00' };
        return { value: t }; // money stays a decimal string
    }
    return { value: t };
}

export function compToCondition(c: CompDraft): { cond?: Condition; error?: string } {
    const { value, error } = convertScalar(c.attr, c.op, c.value);
    if (error) return { error: `${c.attr}: ${error}` };
    const comp: Comparison = { attr: c.attr, op: c.op, value };
    return { cond: c.not ? { not: comp } : comp };
}

export function draftToRule(d: RuleDraft): { rule?: PolicyRule; errors: string[] } {
    const errors: string[] = [];
    const label = d.id || '(unnamed rule)';
    if (!RULE_ID_RE.test(d.id)) errors.push(`${label}: id must be 2–40 chars of a-z, 0-9, _ or -`);
    if (d.actions.length === 0) errors.push(`${label}: choose at least one action`);
    if (d.message.trim().length < 3) errors.push(`${label}: message must be at least 3 characters`);
    let condition: Condition | undefined = d.raw;
    if (!condition) {
        if (d.comparisons.length === 0) errors.push(`${label}: add at least one condition`);
        const parts: Condition[] = [];
        for (const c of d.comparisons) {
            const r = compToCondition(c);
            if (r.error) errors.push(`${label}: ${r.error}`);
            else if (r.cond) parts.push(r.cond);
        }
        condition = d.combinator === 'any' ? { any: parts } : { all: parts };
    }
    if (errors.length) return { errors };
    return { rule: { id: d.id, effect: d.effect, actions: d.actions, condition, message: d.message.trim() }, errors };
}

/** Best-effort preview (includes invalid rows so the JSON reflects what's on screen). */
export function draftPreview(d: RuleDraft): unknown {
    const parts = d.comparisons.map((c) => compToCondition(c).cond ?? { attr: c.attr, op: c.op, value: c.value });
    return {
        id: d.id, effect: d.effect, actions: d.actions,
        condition: d.raw ?? (d.combinator === 'any' ? { any: parts } : { all: parts }),
        message: d.message,
    };
}

/* ── API → Draft ─────────────────────────────────────────────────────────── */

function isComparison(c: Condition): c is Comparison {
    return typeof c === 'object' && c !== null && 'attr' in c && 'op' in c;
}

function valueToText(v: unknown): string {
    if (Array.isArray(v)) return v.map(String).join(', ');
    if (v === undefined || v === null) return '';
    return String(v);
}

function leafToDraft(c: Condition): CompDraft | null {
    if (isComparison(c)) return { key: nextKey(), not: false, attr: c.attr, op: c.op, value: c.op === 'exists' ? String(c.value !== false) : valueToText(c.value) };
    if ('not' in c && isComparison(c.not)) {
        const n = c.not;
        return { key: nextKey(), not: true, attr: n.attr, op: n.op, value: n.op === 'exists' ? String(n.value !== false) : valueToText(n.value) };
    }
    return null;
}

export function ruleToDraft(r: PolicyRule): RuleDraft {
    const base = { key: nextKey(), id: r.id, effect: r.effect, actions: [...r.actions], message: r.message };
    const c = r.condition;
    const leaf = leafToDraft(c);
    if (leaf) return { ...base, combinator: 'all', comparisons: [leaf] };
    if ('all' in c || 'any' in c) {
        const list = 'all' in c ? c.all : c.any;
        const leaves = list.map(leafToDraft);
        if (leaves.every((l): l is CompDraft => l !== null)) {
            return { ...base, combinator: 'all' in c ? 'all' : 'any', comparisons: leaves };
        }
    }
    return { ...base, combinator: 'all', comparisons: [], raw: c };
}

/* ── Readable rendering ──────────────────────────────────────────────────── */

function fmtValue(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(fmtValue).join(', ')}]`;
    if (typeof v === 'string') return `'${v}'`;
    return String(v);
}

export function describeCondition(c: Condition, top = true): string {
    if (isComparison(c)) return c.op === 'exists' ? `${c.attr} ${c.value === false ? 'does not exist' : 'exists'}` : `${c.attr} ${c.op} ${fmtValue(c.value)}`;
    if ('not' in c) return `NOT (${describeCondition(c.not, true)})`;
    const list = 'all' in c ? c.all : c.any;
    const joined = list.map((x) => describeCondition(x, false)).join('all' in c ? ' AND ' : ' OR ');
    return top || list.length < 2 ? joined : `(${joined})`;
}

export function describeRule(r: PolicyRule): string {
    return `${r.effect} ${r.actions.join(', ')} when ${describeCondition(r.condition)}`;
}
