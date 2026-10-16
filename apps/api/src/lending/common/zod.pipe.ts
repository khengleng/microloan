import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, ZodTypeAny } from 'zod';

/** Strict request-body validation: unknown keys are rejected, never silently dropped. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<
  unknown,
  z.infer<T>
> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        message: 'Invalid request',
        code: 'VALIDATION_FAILED',
        issues: r.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return r.data;
  }
}

const money = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'amount must be a decimal string');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD');
const uuid = z.string().uuid();

export const termsSchema = z
  .object({
    principal: money,
    disbursementDate: date,
    numberOfInstalments: z.number().int().min(1).max(1200).optional(),
    annualRate: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    firstDueDate: date.optional(),
    principalGraceInstalments: z.number().int().min(0).max(600).optional(),
    interestGraceInstalments: z.number().int().min(0).max(600).optional(),
    balloonAmount: money.optional(),
    explicitSchedule: z
      .array(z.object({ dueDate: date, principal: money }).strict())
      .max(60)
      .optional(),
    waivedFeeCodes: z.array(z.string().max(48)).max(20).optional(),
    riskCategory: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  })
  .strict();

export const S = {
  createProduct: z
    .object({
      templateCode: z.string().max(48),
      code: z.string().max(32),
      name: z.string().min(2).max(120),
      config: z.unknown().optional(),
    })
    .strict(),
  updateDraft: z
    .object({
      config: z.unknown(),
      changeSummary: z.string().max(500).optional(),
    })
    .strict(),
  reason: z.object({ reason: z.string().max(500).optional() }).strict(),
  simulate: termsSchema,
  workflow: z
    .object({
      code: z.string().max(40),
      name: z.string().max(80),
      definition: z.unknown(),
    })
    .strict(),
  approve: z
    .object({ approve: z.boolean(), comment: z.string().max(500).optional() })
    .strict(),
  createApplication: z
    .object({
      borrowerId: uuid,
      /** Required by group-liability products; refused by individual ones. */
      groupId: uuid.optional(),
      productId: uuid,
      portfolioId: uuid.optional(),
      legalEntityId: uuid.optional(),
      terms: termsSchema,
      purpose: z.string().max(500).optional(),
      segmentCode: z.string().max(48).optional(),
    })
    .strict(),
  createGroup: z
    .object({
      code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{1,47}$/),
      name: z.string().min(2).max(120),
      branchId: uuid.optional(),
      formedOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .strict(),
  addGroupMember: z
    .object({
      borrowerId: uuid,
      role: z.enum(['LEADER', 'MEMBER']).optional(),
      joinedOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .strict(),
  removeGroupMember: z.object({ reason: z.string().min(1).max(500) }).strict(),
  groupStatus: z
    .object({ status: z.enum(['ACTIVE', 'DORMANT', 'DISBANDED']) })
    .strict(),
  updateTerms: z
    .object({ terms: termsSchema, purpose: z.string().max(500).optional() })
    .strict(),
  document: z
    .object({
      code: z.string().max(40),
      fileName: z.string().max(200),
      mimeType: z.string().max(60),
      contentBase64: z.string().max(5_000_000),
    })
    .strict(),
  collateral: z
    .object({
      type: z.string().max(48),
      description: z.string().max(300),
      marketValue: money,
      valuationDate: date,
      valuer: z.string().max(120),
      method: z.string().max(40),
    })
    .strict(),
  guarantee: z
    .object({
      guarantorName: z.string().min(2).max(120),
      guarantorBorrowerId: uuid.optional(),
      type: z.enum(['PERSONAL', 'CORPORATE']),
      amount: money,
    })
    .strict(),
  condition: z
    .object({
      resolution: z.enum(['SATISFIED', 'WAIVED']),
      evidence: z.string().max(500).optional(),
    })
    .strict(),
  rationale: z.object({ rationale: z.string().min(3).max(2000) }).strict(),
  recommend: z
    .object({
      rationale: z.string().min(3).max(2000),
      recommendation: z.enum(['APPROVE', 'REJECT']),
    })
    .strict(),
  book: z.object({ plannedDisbursementDate: date.optional() }).strict(),
  prepareDisbursement: z.object({ valueDate: date.optional() }).strict(),
  executeDisbursement: z
    .object({ externalReference: z.string().min(2).max(120) })
    .strict(),
  repayment: z
    .object({
      amount: money,
      valueDate: date.optional(),
      externalReference: z.string().max(120).optional(),
      prepaymentStrategy: z.enum(['RECAST', 'SHORTEN']).optional(),
    })
    .strict(),
  settlement: z
    .object({
      amount: money,
      valueDate: date.optional(),
      externalReference: z.string().max(120).optional(),
    })
    .strict(),
  reversal: z.object({ reason: z.string().min(3).max(500) }).strict(),
  writeOff: z.object({ reason: z.string().min(3).max(500) }).strict(),
  role: z
    .object({
      code: z.string().max(40),
      name: z.string().max(80),
      description: z.string().max(300).optional(),
      permissions: z.array(z.string().max(60)).min(1).max(60),
    })
    .strict(),
  assignment: z
    .object({
      userId: uuid,
      roleId: uuid,
      allBranches: z.boolean().optional(),
      branchIds: z.array(uuid).max(100).optional(),
      portfolioIds: z.array(uuid).max(100).optional(),
      legalEntityIds: z.array(uuid).max(20).optional(),
      validTo: z.string().datetime().optional(),
      reason: z.string().max(300).optional(),
    })
    .strict(),
  revoke: z.object({ reason: z.string().min(3).max(300) }).strict(),
  delegation: z
    .object({
      toUserId: uuid,
      permissions: z.array(z.string().max(60)).min(1).max(20),
      validFrom: z.string().datetime(),
      validTo: z.string().datetime(),
      maxAmount: money.optional(),
      currency: z.string().length(3).optional(),
      reason: z.string().min(3).max(300),
    })
    .strict(),
  authority: z
    .object({
      roleId: uuid.optional(),
      userId: uuid.optional(),
      permission: z.string().max(60),
      currency: z.string().length(3),
      maxAmount: money,
      familyCode: z.string().max(40).optional(),
      validTo: z.string().datetime().optional(),
    })
    .strict(),
  policy: z
    .object({
      code: z.string().max(40),
      name: z.string().max(80),
      description: z.string().max(500).optional(),
      rules: z.unknown(),
    })
    .strict(),
  policyDecision: z
    .object({ approve: z.boolean(), reason: z.string().max(300).optional() })
    .strict(),
  flagRule: z
    .object({
      flagKey: z.string().max(80),
      scopeType: z.enum([
        'PLATFORM',
        'TENANT',
        'PRODUCT',
        'BRANCH',
        'CHANNEL',
        'SEGMENT',
        'COHORT',
      ]),
      scopeValue: z.string().max(80).optional(),
      enabled: z.boolean(),
      emergency: z.boolean().optional(),
      priority: z.number().int().min(0).max(1000).optional(),
      effectiveFrom: z.string().datetime().optional(),
      effectiveTo: z.string().datetime().optional(),
      reason: z.string().min(3).max(300),
    })
    .strict(),
  cohort: z
    .object({
      cohortCode: z.string().max(40),
      subjectType: z.enum(['BRANCH', 'USER', 'BORROWER']),
      subjectId: z.string().max(64),
      member: z.boolean(),
    })
    .strict(),
  serviceAccount: z
    .object({
      name: z.string().min(2).max(80),
      scopes: z.array(z.string().max(60)).min(1).max(10),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    })
    .strict(),
  simulatePolicy: z
    .object({
      userId: uuid,
      action: z.string().max(60),
      resourceType: z.enum([
        'APPLICATION',
        'LOAN_ACCOUNT',
        'PRODUCT_VERSION',
        'TENANT',
      ]),
      resourceId: uuid.optional(),
      assurance: z.enum(['MFA', 'SINGLE_FACTOR']).optional(),
      amount: money.optional(),
    })
    .strict(),
  businessDate: z.object({ businessDate: date }).strict(),
  calendar: z
    .object({
      code: z.string().max(20),
      name: z.string().max(80),
      weekendDays: z.array(z.number().int()).max(7),
      holidays: z
        .array(z.object({ date, name: z.string().max(80) }).strict())
        .max(400),
    })
    .strict(),
  rate: z
    .object({
      benchmarkCode: z.string().max(20),
      observationDate: date,
      rate: z.string().regex(/^-?\d+(\.\d+)?$/),
      source: z.string().min(2).max(120),
    })
    .strict(),
};
