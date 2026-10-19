import { Injectable } from '@nestjs/common';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { BusinessDateService } from '../common/business-date.service';
import { decStr, fromLocalDate, type LendingActor } from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { lending } from '@microloan/shared';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { originalTermDays } from '../servicing/loan-state';
import { ACTION_BY_CODE } from '../policy/actions';
import type { Subject } from '../policy/decision';
import {
  COHORT_SUBJECT,
  SERVICE_ACCOUNT_SUBJECT,
} from '../access/access-admin.service';
import { D } from '../common/util';

/** Who acts on a queue: the person preparing work, the second person approving it, or information only. */
export type QueueKind = 'MAKER' | 'CHECKER' | 'INFO';

export interface WorkItem {
  id: string;
  reference: string;
  label: string;
  amount?: string | null;
  currency?: string | null;
  /** Web route relative to the locale, e.g. `/lending/loans/<id>`. */
  href: string;
  since?: string | null;
  /** Above the user's approval authority for this permission and currency. */
  aboveLimit?: boolean;
}

export interface WorkQueue {
  code: string;
  title: string;
  /** The permission that makes this queue the user's. */
  permission: string;
  /** The action the user takes on it (decides MFA). */
  action: string;
  kind: QueueKind;
  money: boolean;
  /** The action needs MFA and this session signed in without it. */
  needsMfa: boolean;
  count: number;
  href: string;
  items: WorkItem[];
}

const TOP = 5;
/** ApprovalTask subjects shown in the access and flag queues, not the generic ones. */
const GOVERNANCE_SUBJECTS = [SERVICE_ACCOUNT_SUBJECT, COHORT_SUBJECT];
/** Candidate rows examined per queue before maker-checker filtering. */
const SCAN = 500;

type Scope = Record<string, unknown>;

/**
 * Approval tasks by action → the queue they belong to. Anything not listed
 * falls into OTHER_APPROVALS so a new maker-checker step is never invisible.
 */
const TASK_QUEUES: Record<
  string,
  { code: string; title: string; action: string }
> = {
  DISBURSEMENT: {
    code: 'DISBURSEMENTS_TO_APPROVE',
    title: 'Disbursements to approve',
    action: 'loan.disbursement.approve',
  },
  WRITE_OFF: {
    code: 'WRITE_OFFS_TO_APPROVE',
    title: 'Write-offs to approve',
    action: 'loan.writeoff.approve',
  },
  FEE_WAIVER: {
    code: 'FEE_WAIVERS_TO_APPROVE',
    title: 'Fee waivers to approve',
    action: 'loan.fee_waiver.approve',
  },
  ADVANCE_REFUND: {
    code: 'REFUNDS_TO_APPROVE',
    title: 'Refunds to approve',
    action: 'loan.advance_refund.approve',
  },
  SUSPENSE_REFUND: {
    code: 'REFUNDS_TO_APPROVE',
    title: 'Refunds to approve',
    action: 'payment.refund.approve',
  },
  SET_OFF: {
    code: 'SET_OFFS_TO_APPROVE',
    title: 'Set-offs to approve',
    action: 'loan.set_off.approve',
  },
  COLLATERAL_RELEASE: {
    code: 'COLLATERAL_RELEASES_TO_APPROVE',
    title: 'Collateral releases to approve',
    action: 'loan.collateral.release.approve',
  },
  REPOSSESSION_SEIZURE: {
    code: 'RECOVERY_TO_APPROVE',
    title: 'Recovery steps to approve',
    action: 'loan.repossession.approve',
  },
  PAWN_FORFEITURE: {
    code: 'RECOVERY_TO_APPROVE',
    title: 'Recovery steps to approve',
    action: 'loan.pawn.forfeit.approve',
  },
  PREMIUM_REMITTANCE: {
    code: 'RECOVERY_TO_APPROVE',
    title: 'Recovery steps to approve',
    action: 'loan.insurance.remit.approve',
  },
  INSURANCE_CLAIM: {
    code: 'RECOVERY_TO_APPROVE',
    title: 'Recovery steps to approve',
    action: 'loan.insurance.claim.approve',
  },
  DEBT_SALE: {
    code: 'RECOVERY_TO_APPROVE',
    title: 'Recovery steps to approve',
    action: 'loan.debt_sale.approve',
  },
  RECOVERY_REFUND: {
    code: 'RECOVERY_TO_APPROVE',
    title: 'Recovery steps to approve',
    action: 'loan.recovery_refund.approve',
  },
  INVOICE_RESERVE_PAYOUT: {
    code: 'PAYOUTS_TO_APPROVE',
    title: 'Payouts to approve',
    action: 'trade.invoice.reserve.approve',
  },
  PARTICIPANT_PAYOUT: {
    code: 'PAYOUTS_TO_APPROVE',
    title: 'Payouts to approve',
    action: 'syndication.payout.approve',
  },
};

const QUEUE_HREF: Record<string, string> = {
  APPLICATIONS_DRAFT: '/lending/applications',
  APPLICATIONS_TO_RECOMMEND: '/lending/applications',
  APPLICATIONS_TO_APPROVE: '/lending/applications',
  APPLICATIONS_TO_BOOK: '/lending/applications',
  DISBURSEMENTS_TO_PREPARE: '/lending/loans',
  DISBURSEMENTS_TO_APPROVE: '/lending/loans',
  DISBURSEMENTS_TO_EXECUTE: '/lending/loans',
  WRITE_OFFS_TO_APPROVE: '/lending/loans',
  FEE_WAIVERS_TO_APPROVE: '/lending/approvals?action=FEE_WAIVER',
  // Advance refunds are listed there; unidentified-payment refunds link on to Suspense.
  REFUNDS_TO_APPROVE: '/lending/approvals?action=ADVANCE_REFUND',
  SET_OFFS_TO_APPROVE: '/lending/approvals?action=SET_OFF',
  COLLATERAL_RELEASES_TO_APPROVE: '/lending/loans',
  RECOVERY_TO_APPROVE: '/lending/recovery',
  PAYOUTS_TO_APPROVE: '/lending/trade',
  OTHER_APPROVALS: '/lending/loans',
  RESTRUCTURES_TO_ASSESS: '/lending/restructures',
  RESTRUCTURES_TO_PROPOSE: '/lending/restructures',
  RESTRUCTURES_TO_APPROVE: '/lending/restructures',
  RESTRUCTURE_ACCEPTANCES: '/lending/restructures',
  RESTRUCTURES_TO_EXECUTE: '/lending/restructures',
  RESTRUCTURE_MONITORING: '/lending/restructures',
  HOLIDAY_PROGRAMMES_TO_PUBLISH: '/lending/relief',
  PRODUCT_VERSIONS_TO_REVIEW: '/lending/products',
  PRODUCT_VERSIONS_TO_ACTIVATE: '/lending/products',
  PRODUCT_DRAFTS: '/lending/products',
  WORKFLOWS_TO_APPROVE: '/lending/workflows',
  DRAWDOWNS_TO_APPROVE: '/lending/facilities',
  DRAWDOWNS_TO_RELEASE: '/lending/facilities',
  FACILITY_LIMITS_TO_APPROVE: '/lending/facilities',
  COLLECTION_TASKS: '/lending/collections',
  PAST_DUE: '/lending/collections',
  AGED_LOSS: '/lending/recovery',
  DOCUMENTS_TO_REVIEW: '/lending/documents',
  UNIDENTIFIED_PAYMENTS: '/lending/suspense',
  PERIODS_TO_APPROVE: '/lending/close',
  MIGRATIONS_TO_APPROVE: '/lending/migration',
  RETURNS_TO_SUBMIT: '/lending/regulatory',
  COVENANTS_OVERDUE: '/lending/loans',
  PAYOFF_QUOTES_OPEN: '/lending/loans',
  ACCESS_TO_APPROVE: '/lending/access',
  FLAGS_TO_APPROVE: '/lending/access',
  SERVICE_KEYS_TO_COLLECT: '/lending/access?tab=service-accounts',
  IMPAIRMENT_TO_APPROVE: '/lending/operations',
  TRADE_INVOICES_TO_APPROVE: '/lending/trade',
  LETTERS_OF_CREDIT_TO_ISSUE: '/lending/trade',
  SYNDICATES_TO_APPROVE: '/lending/syndication',
  END_OF_DAY: '/lending/operations',
  AUDIT_DENIALS: '/lending/audit',
};

const loanHref = (id: string) => `/lending/loans/${id}`;
const appHref = (id: string) => `/lending/applications/${id}`;
const caseHref = (id: string) => `/lending/restructures/${id}`;
const facilityHref = (id: string) => `/lending/facilities/${id}`;
const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;

/**
 * "What is waiting for me": counts and the oldest items of every queue the
 * signed-in user holds the permission for, confined to their scope, and —
 * where a second person must act — never counting work the user made
 * themselves. The same rules the decision engine applies to the action
 * (`makerIds`), so a queue never offers an item the API would refuse on
 * maker-checker grounds. Authority, MFA and flags still decide at the click:
 * items above the user's limit are marked, MFA-gated queues are flagged.
 */
@Injectable()
export class WorkspaceWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly businessDate: BusinessDateService,
    private readonly settings: TenantSettingsService,
  ) {}

  async work(actor: LendingActor) {
    if (actor.type === 'PLATFORM') return this.platformWork();
    if (actor.type !== 'USER')
      return { businessDate: null, total: 0, queues: [] as WorkQueue[] };
    const tenantId = actor.tenantId!;
    const subject = await this.policy.subject(actor);
    const held = new Set(subject.grants.map((g) => g.permission));
    if (!subject.active || !held.size)
      return { businessDate: null, total: 0, queues: [] as WorkQueue[] };
    // Scope filters per permission, resolved once.
    const scopes = new Map<string, Scope | null>();
    for (const p of held)
      scopes.set(p, await this.policy.scopeFilter(actor, p));
    const me = actor.id;
    const queues: WorkQueue[] = [];
    const add = (
      code: string,
      title: string,
      actionCode: string,
      kind: QueueKind,
      count: number,
      items: WorkItem[],
    ) => {
      const action = ACTION_BY_CODE[actionCode];
      queues.push({
        code,
        title,
        permission: action.permission,
        action: actionCode,
        kind,
        money:
          action.kind === 'SERVICING_MONEY' ||
          action.kind === 'DISBURSEMENT' ||
          action.kind === 'DRAWDOWN',
        needsMfa: action.minAssurance === 'MFA' && actor.assurance !== 'MFA',
        count,
        href: QUEUE_HREF[code] ?? '/home',
        items: items.slice(0, TOP),
      });
    };
    const has = (actionCode: string) =>
      held.has(ACTION_BY_CODE[actionCode].permission);
    const scopeOf = (actionCode: string) =>
      scopes.get(ACTION_BY_CODE[actionCode].permission) ?? null;

    return this.lp.tenantTx(
      tenantId,
      async (tx) => {
        const businessDate = await this.businessDate.get(tenantId, tx);
        const bd = fromLocalDate(businessDate);

        // ── Origination ───────────────────────────────────────────────────
        if (has('loan_application.create')) {
          const s = scopes.get('loan_application.read') ?? {};
          const where: Prisma.ApplicationWhereInput = {
            tenantId,
            status: 'DRAFT',
            createdBy: me,
            ...(s as Prisma.ApplicationWhereInput),
          };
          const [count, rows] = await Promise.all([
            tx.application.count({ where }),
            tx.application.findMany({
              where,
              orderBy: { createdAt: 'asc' },
              take: TOP,
              include: {
                borrower: { select: { firstName: true, lastName: true } },
              },
            }),
          ]);
          add(
            'APPLICATIONS_DRAFT',
            'Applications in progress',
            'loan_application.create',
            'MAKER',
            count,
            rows.map((a) => this.appItem(a, a.createdAt)),
          );
        }
        if (has('credit_decision.recommend')) {
          const s = scopeOf('credit_decision.recommend');
          if (s) {
            const where: Prisma.ApplicationWhereInput = {
              tenantId,
              status: 'SUBMITTED',
              createdBy: { not: me },
              ...(s as Prisma.ApplicationWhereInput),
            };
            const [count, rows] = await Promise.all([
              tx.application.count({ where }),
              tx.application.findMany({
                where,
                orderBy: { submittedAt: 'asc' },
                take: TOP,
                include: {
                  borrower: { select: { firstName: true, lastName: true } },
                },
              }),
            ]);
            add(
              'APPLICATIONS_TO_RECOMMEND',
              'Applications to assess',
              'credit_decision.recommend',
              'CHECKER',
              count,
              rows.map((a) => this.appItem(a, a.submittedAt)),
            );
          }
        }
        if (has('credit_decision.approve')) {
          const s = scopeOf('credit_decision.approve');
          if (s) {
            const rows = await tx.application.findMany({
              where: {
                tenantId,
                status: 'RECOMMENDED',
                createdBy: { not: me },
                ...(s as Prisma.ApplicationWhereInput),
              },
              orderBy: { submittedAt: 'asc' },
              take: SCAN,
              include: {
                borrower: { select: { firstName: true, lastName: true } },
                decisions: {
                  select: { type: true, decidedBy: true, createdAt: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
            });
            // Everyone who created, recommended or already approved since the
            // last recommendation is a maker for this approval.
            const mine = rows.filter((a) => {
              const lastRec = [...a.decisions]
                .reverse()
                .find((d) => d.type === 'RECOMMEND');
              const makers = new Set([
                a.createdBy,
                ...a.decisions
                  .filter((d) => d.type === 'RECOMMEND')
                  .map((d) => d.decidedBy),
                ...a.decisions
                  .filter(
                    (d) =>
                      d.type === 'APPROVE' &&
                      (!lastRec || d.createdAt >= lastRec.createdAt),
                  )
                  .map((d) => d.decidedBy),
              ]);
              return !makers.has(me);
            });
            add(
              'APPLICATIONS_TO_APPROVE',
              'Waiting for your credit decision',
              'credit_decision.approve',
              'CHECKER',
              mine.length,
              mine.map((a) => ({
                ...this.appItem(a, a.submittedAt),
                aboveLimit: aboveAuthority(
                  subject,
                  'credit_decision.approve',
                  decStr(a.requestedAmount),
                  a.currency,
                ),
              })),
            );
          }
        }
        if (has('loan.agreement.book')) {
          const s = scopeOf('loan.agreement.book');
          if (s) {
            const where: Prisma.ApplicationWhereInput = {
              tenantId,
              status: 'APPROVED',
              ...(s as Prisma.ApplicationWhereInput),
            };
            const [count, rows] = await Promise.all([
              tx.application.count({ where }),
              tx.application.findMany({
                where,
                orderBy: { decidedAt: 'asc' },
                take: TOP,
                include: {
                  borrower: { select: { firstName: true, lastName: true } },
                },
              }),
            ]);
            add(
              'APPLICATIONS_TO_BOOK',
              'Approved applications to book',
              'loan.agreement.book',
              'MAKER',
              count,
              rows.map((a) => this.appItem(a, a.decidedAt)),
            );
          }
        }

        // ── Disbursements and other maker-checker tasks ───────────────────
        if (has('loan.disbursement.prepare')) {
          const s = scopeOf('loan.disbursement.prepare');
          if (s) {
            const open = await tx.approvalTask.findMany({
              where: {
                tenantId,
                action: 'DISBURSEMENT',
                status: { in: ['PENDING', 'APPROVED'] },
              },
              select: { subjectId: true },
            });
            const where: Prisma.LoanAccountWhereInput = {
              tenantId,
              status: 'BOOKED',
              id: { notIn: open.map((o) => o.subjectId) },
              ...(s as Prisma.LoanAccountWhereInput),
            };
            const [count, rows] = await Promise.all([
              tx.loanAccount.count({ where }),
              tx.loanAccount.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                take: TOP,
              }),
            ]);
            const names = await this.borrowerNames(
              tx,
              tenantId,
              rows.map((r) => r.borrowerId),
            );
            add(
              'DISBURSEMENTS_TO_PREPARE',
              'Disbursements to prepare',
              'loan.disbursement.prepare',
              'MAKER',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.reference,
                label: names.get(r.borrowerId) ?? '',
                amount: decStr(r.bookedPrincipal),
                currency: r.currency,
                href: loanHref(r.id),
                since: r.createdAt.toISOString(),
              })),
            );
          }
        }
        await this.approvalTasks(tx, tenantId, me, subject, held, scopes, add);

        // ── Restructuring ─────────────────────────────────────────────────
        const caseQueue = async (
          code: string,
          title: string,
          actionCode: string,
          kind: QueueKind,
          statuses: string[],
          makersOf?: (c: {
            initiatorType: string;
            initiatorId: string;
            proposals: {
              status: string;
              proposedBy: string;
              approvals: { approverId: string }[];
            }[];
          }) => string[],
        ) => {
          if (!has(actionCode)) return;
          const s = scopeOf(actionCode);
          if (!s) return;
          const rows = await tx.restructureCase.findMany({
            where: {
              tenantId,
              status: { in: statuses },
              loanAccount: s as Prisma.LoanAccountWhereInput,
            },
            orderBy: { updatedAt: 'asc' },
            take: SCAN,
            include: {
              loanAccount: { select: { reference: true, currency: true } },
              proposals: {
                select: {
                  status: true,
                  proposedBy: true,
                  approvals: { select: { approverId: true } },
                },
              },
            },
          });
          const mine = makersOf
            ? rows.filter((c) => !makersOf(c).includes(me))
            : rows;
          const names = await this.borrowerNames(
            tx,
            tenantId,
            mine.slice(0, TOP).map((c) => c.borrowerId),
          );
          add(
            code,
            title,
            actionCode,
            kind,
            mine.length,
            mine.map((c) => ({
              id: c.id,
              reference: c.reference,
              label: `${names.get(c.borrowerId) ?? ''} · ${c.loanAccount.reference}`,
              href: caseHref(c.id),
              since: c.updatedAt.toISOString(),
            })),
          );
        };
        await caseQueue(
          'RESTRUCTURES_TO_ASSESS',
          'Hardship cases to assess',
          'restructure.assess',
          'MAKER',
          ['REQUESTED', 'MORE_INFO_REQUIRED'],
        );
        await caseQueue(
          'RESTRUCTURES_TO_PROPOSE',
          'Hardship cases to propose options for',
          'restructure.propose',
          'MAKER',
          ['AFFORDABILITY_ASSESSED', 'SPECIALIST_REVIEW'],
        );
        await caseQueue(
          'RESTRUCTURES_TO_APPROVE',
          'Restructure proposals to decide',
          'restructure.approve',
          'CHECKER',
          ['OPTIONS_PROPOSED'],
          (c) => [
            ...(c.initiatorType === 'USER' ? [c.initiatorId] : []),
            ...c.proposals
              .filter((p) => p.status === 'PROPOSED')
              .flatMap((p) => [
                p.proposedBy,
                ...p.approvals.map((a) => a.approverId),
              ]),
          ],
        );
        await caseQueue(
          'RESTRUCTURE_ACCEPTANCES',
          'Approved proposals awaiting the customer',
          'restructure.record_acceptance',
          'MAKER',
          ['APPROVED'],
        );
        await caseQueue(
          'RESTRUCTURES_TO_EXECUTE',
          'Accepted restructures to execute',
          'restructure.execute',
          'CHECKER',
          ['CUSTOMER_ACCEPTED', 'CONDITIONS_SATISFIED'],
          (c) =>
            c.proposals
              .filter((p) => p.status === 'ACCEPTED')
              .map((p) => p.proposedBy),
        );
        if (has('restructure.monitor')) {
          const s = scopeOf('restructure.monitor');
          if (s) {
            const where: Prisma.RestructureReviewTaskWhereInput = {
              tenantId,
              status: 'OPEN',
              case: { loanAccount: s as Prisma.LoanAccountWhereInput },
            };
            const [count, rows] = await Promise.all([
              tx.restructureReviewTask.count({ where }),
              tx.restructureReviewTask.findMany({
                where,
                orderBy: { dueDate: 'asc' },
                take: TOP,
                include: { case: { select: { id: true, reference: true } } },
              }),
            ]);
            add(
              'RESTRUCTURE_MONITORING',
              'Restructured loans to review',
              'restructure.monitor',
              'MAKER',
              count,
              rows.map((t) => ({
                id: t.id,
                reference: t.case.reference,
                label: humanize(t.type),
                href: caseHref(t.case.id),
                since: day(t.dueDate),
              })),
            );
          }
        }
        if (has('payment_holiday.approve')) {
          const where: Prisma.PaymentHolidayProgrammeWhereInput = {
            tenantId,
            status: 'DRAFT',
            createdBy: { not: me },
          };
          const [count, rows] = await Promise.all([
            tx.paymentHolidayProgramme.count({ where }),
            tx.paymentHolidayProgramme.findMany({
              where,
              orderBy: { createdAt: 'asc' },
              take: TOP,
            }),
          ]);
          add(
            'HOLIDAY_PROGRAMMES_TO_PUBLISH',
            'Holiday programmes to publish',
            'payment_holiday.approve',
            'CHECKER',
            count,
            rows.map((p) => ({
              id: p.id,
              reference: p.code,
              label: p.name,
              href: '/lending/relief',
              since: p.createdAt.toISOString(),
            })),
          );
        }

        // ── Products, policies and workflows ──────────────────────────────
        if (has('loan_product.approve')) {
          const [versions, policies] = await Promise.all([
            tx.productVersion.findMany({
              where: { tenantId, status: 'SUBMITTED', makerId: { not: me } },
              orderBy: { submittedAt: 'asc' },
              take: SCAN,
              include: { product: { select: { code: true, name: true } } },
            }),
            tx.lendingPolicyVersion.findMany({
              where: { tenantId, status: 'SUBMITTED', makerId: { not: me } },
              orderBy: { submittedAt: 'asc' },
              take: SCAN,
              include: { policy: { select: { code: true, name: true } } },
            }),
          ]);
          add(
            'PRODUCT_VERSIONS_TO_REVIEW',
            'Product and policy versions to review',
            'loan_product.approve',
            'CHECKER',
            versions.length + policies.length,
            [
              ...versions.map((v) => ({
                id: v.id,
                reference: `${v.product.code} v${v.version}`,
                label: v.product.name,
                href: `/lending/products/versions/${v.id}`,
                since: v.submittedAt?.toISOString() ?? null,
              })),
              ...policies.map((v) => ({
                id: v.id,
                reference: `${v.policy.code} v${v.version}`,
                label: v.policy.name,
                href: `/lending/policies/${v.policyId}`,
                since: v.submittedAt?.toISOString() ?? null,
              })),
            ],
          );
        }
        if (has('loan_product.activate')) {
          const where: Prisma.ProductVersionWhereInput = {
            tenantId,
            status: 'APPROVED',
            makerId: { not: me },
          };
          const [count, rows] = await Promise.all([
            tx.productVersion.count({ where }),
            tx.productVersion.findMany({
              where,
              orderBy: { approvedAt: 'asc' },
              take: TOP,
              include: { product: { select: { code: true, name: true } } },
            }),
          ]);
          add(
            'PRODUCT_VERSIONS_TO_ACTIVATE',
            'Approved versions to activate',
            'loan_product.activate',
            'CHECKER',
            count,
            rows.map((v) => ({
              id: v.id,
              reference: `${v.product.code} v${v.version}`,
              label: v.product.name,
              href: `/lending/products/versions/${v.id}`,
              since: v.approvedAt?.toISOString() ?? null,
            })),
          );
        }
        if (has('loan_product.update')) {
          const where: Prisma.ProductVersionWhereInput = {
            tenantId,
            status: 'DRAFT',
            makerId: me,
          };
          const [count, rows] = await Promise.all([
            tx.productVersion.count({ where }),
            tx.productVersion.findMany({
              where,
              orderBy: { createdAt: 'asc' },
              take: TOP,
              include: { product: { select: { code: true, name: true } } },
            }),
          ]);
          add(
            'PRODUCT_DRAFTS',
            'Your product drafts',
            'loan_product.update',
            'MAKER',
            count,
            rows.map((v) => ({
              id: v.id,
              reference: `${v.product.code} v${v.version}`,
              label: v.product.name,
              href: `/lending/products/versions/${v.id}`,
              since: v.createdAt.toISOString(),
            })),
          );
        }
        if (has('workflow.approve')) {
          const where: Prisma.WorkflowVersionWhereInput = {
            tenantId,
            status: 'SUBMITTED',
            makerId: { not: me },
          };
          const [count, rows] = await Promise.all([
            tx.workflowVersion.count({ where }),
            tx.workflowVersion.findMany({
              where,
              orderBy: { createdAt: 'asc' },
              take: TOP,
            }),
          ]);
          add(
            'WORKFLOWS_TO_APPROVE',
            'Workflow versions to approve',
            'workflow.approve',
            'CHECKER',
            count,
            rows.map((w) => ({
              id: w.id,
              reference: `${w.code} v${w.version}`,
              label: w.name,
              href: '/lending/workflows',
              since: w.createdAt.toISOString(),
            })),
          );
        }

        // ── Facilities ────────────────────────────────────────────────────
        const drawdownQueue = async (
          code: string,
          title: string,
          actionCode: string,
          status: string,
        ) => {
          if (!has(actionCode)) return;
          const s = scopeOf(actionCode);
          if (!s) return;
          const where: Prisma.DrawdownWhereInput = {
            tenantId,
            status,
            requestedBy: { not: me },
            facility: s as Prisma.FacilityWhereInput,
          };
          const [count, rows] = await Promise.all([
            tx.drawdown.count({ where }),
            tx.drawdown.findMany({
              where,
              orderBy: { createdAt: 'asc' },
              take: TOP,
              include: {
                facility: {
                  select: { id: true, reference: true, borrowerId: true },
                },
              },
            }),
          ]);
          const names = await this.borrowerNames(
            tx,
            tenantId,
            rows.map((r) => r.facility.borrowerId),
          );
          add(
            code,
            title,
            actionCode,
            'CHECKER',
            count,
            rows.map((r) => ({
              id: r.id,
              reference: `${r.facility.reference} #${r.sequence}`,
              label: names.get(r.facility.borrowerId) ?? '',
              amount: decStr(r.amount),
              currency: r.currency,
              href: facilityHref(r.facility.id),
              since: r.createdAt.toISOString(),
              aboveLimit:
                status === 'REQUESTED'
                  ? aboveAuthority(
                      subject,
                      'facility.drawdown.approve',
                      decStr(r.amount),
                      r.currency,
                    )
                  : undefined,
            })),
          );
        };
        await drawdownQueue(
          'DRAWDOWNS_TO_APPROVE',
          'Drawdowns to approve',
          'facility.drawdown.approve',
          'REQUESTED',
        );
        await drawdownQueue(
          'DRAWDOWNS_TO_RELEASE',
          'Approved drawdowns to release',
          'facility.drawdown.release',
          'APPROVED',
        );
        if (has('facility.limit.approve')) {
          const s = scopeOf('facility.limit.approve');
          if (s) {
            const where: Prisma.FacilityLimitChangeWhereInput = {
              tenantId,
              status: 'REQUESTED',
              requestedBy: { not: me },
              facility: s as Prisma.FacilityWhereInput,
            };
            const [count, rows] = await Promise.all([
              tx.facilityLimitChange.count({ where }),
              tx.facilityLimitChange.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                take: TOP,
                include: {
                  facility: {
                    select: { id: true, reference: true, currency: true },
                  },
                },
              }),
            ]);
            add(
              'FACILITY_LIMITS_TO_APPROVE',
              'Facility limit changes to approve',
              'facility.limit.approve',
              'CHECKER',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.facility.reference,
                label: humanize(r.changeType),
                amount: decStr(r.newLimit),
                currency: r.facility.currency,
                href: facilityHref(r.facility.id),
                since: r.createdAt.toISOString(),
              })),
            );
          }
        }

        // ── Collections and servicing ─────────────────────────────────────
        if (has('collection.task.work')) {
          const s = scopeOf('collection.task.work');
          if (s) {
            const where: Prisma.CollectionTaskWhereInput = {
              tenantId,
              status: 'OPEN',
              OR: [{ assignedTo: null }, { assignedTo: me }],
              loanAccount: s as Prisma.LoanAccountWhereInput,
            };
            const [count, rows] = await Promise.all([
              tx.collectionTask.count({ where }),
              tx.collectionTask.findMany({
                where,
                orderBy: [{ dueOn: 'asc' }, { daysPastDue: 'desc' }],
                take: TOP,
                include: {
                  loanAccount: {
                    select: {
                      id: true,
                      reference: true,
                      currency: true,
                      borrowerId: true,
                    },
                  },
                },
              }),
            ]);
            const names = await this.borrowerNames(
              tx,
              tenantId,
              rows.map((r) => r.loanAccount.borrowerId),
            );
            add(
              'COLLECTION_TASKS',
              'Collection tasks in your queues',
              'collection.task.work',
              'MAKER',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.loanAccount.reference,
                label: `${names.get(r.loanAccount.borrowerId) ?? ''} · ${humanize(r.action)} · ${r.daysPastDue} days`,
                amount: decStr(r.amountOverdue),
                currency: r.loanAccount.currency,
                href: loanHref(r.loanAccount.id),
                since: day(r.dueOn),
              })),
            );
          }
          const sp = scopeOf('loan.repayment.post');
          if (sp) {
            const where: Prisma.LoanAccountWhereInput = {
              tenantId,
              status: 'ACTIVE',
              daysPastDue: { gt: 0 },
              ...(sp as Prisma.LoanAccountWhereInput),
            };
            const [count, rows] = await Promise.all([
              tx.loanAccount.count({ where }),
              tx.loanAccount.findMany({
                where,
                orderBy: { daysPastDue: 'desc' },
                take: TOP,
              }),
            ]);
            const names = await this.borrowerNames(
              tx,
              tenantId,
              rows.map((r) => r.borrowerId),
            );
            add(
              'PAST_DUE',
              'Past due in your scope',
              'loan.repayment.post',
              'INFO',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.reference,
                label: `${names.get(r.borrowerId) ?? ''} · ${r.daysPastDue} days`,
                amount: decStr(r.principalOutstanding),
                currency: r.currency,
                href: loanHref(r.id),
              })),
            );
          }
        }
        // D-117: loans graded Loss at the write-off floor, not yet written off.
        if (has('loan.writeoff.propose')) {
          const sw = scopeOf('loan.writeoff.propose');
          if (sw) {
            const s = await this.settings.get(tenantId, tx);
            const bands = lending.regulatoryBands(s);
            const floors = [
              lending.writeOffFloorDpd(bands, null, s.regulatory.writeOffMinDpd),
              lending.writeOffFloorDpd(
                bands,
                s.regulatory.shortTermMaxDays + 1,
                s.regulatory.writeOffMinDpd,
              ),
            ];
            const candidates = await tx.loanAccount.findMany({
              where: {
                tenantId,
                status: 'ACTIVE',
                daysPastDue: { gte: Math.min(...floors) },
                ...(sw as Prisma.LoanAccountWhereInput),
              },
              orderBy: { daysPastDue: 'desc' },
              select: {
                id: true,
                reference: true,
                borrowerId: true,
                currency: true,
                principalOutstanding: true,
                daysPastDue: true,
                disbursementDate: true,
                maturityDate: true,
                originalMaturityDate: true,
                isRestructured: true,
                probationRemaining: true,
                delinquencyFloorDpd: true,
              },
            });
            const pending = new Set(
              (
                await tx.approvalTask.findMany({
                  where: {
                    tenantId,
                    action: 'WRITE_OFF',
                    status: 'PENDING',
                    subjectId: { in: candidates.map((c) => c.id) },
                  },
                  select: { subjectId: true },
                })
              ).map((t) => t.subjectId),
            );
            const aged = candidates.filter((l) => {
              if (pending.has(l.id)) return false;
              const term = originalTermDays(l);
              const grade = lending.classifyRegulatory(bands, {
                daysPastDue: l.daysPastDue,
                originalTermDays: term,
                restructured: l.isRestructured,
                onProbation: l.probationRemaining > 0,
                floorDpd: l.delinquencyFloorDpd,
              });
              return (
                grade.cls.code === 'LOSS' &&
                l.daysPastDue >=
                  lending.writeOffFloorDpd(
                    bands,
                    term,
                    s.regulatory.writeOffMinDpd,
                  )
              );
            });
            const names = await this.borrowerNames(
              tx,
              tenantId,
              aged.slice(0, TOP).map((r) => r.borrowerId),
            );
            add(
              'AGED_LOSS',
              'Loss loans due for write-off',
              'loan.writeoff.propose',
              'MAKER',
              aged.length,
              aged.map((r) => ({
                id: r.id,
                reference: r.reference,
                label: `${names.get(r.borrowerId) ?? ''} · Loss · ${r.daysPastDue} days`,
                amount: decStr(r.principalOutstanding),
                currency: r.currency,
                href: loanHref(r.id),
              })),
            );
          }
        }
        if (has('payment.suspense.receive')) {
          const where: Prisma.UnidentifiedPaymentWhereInput = {
            tenantId,
            status: 'OPEN',
          };
          const [count, rows] = await Promise.all([
            tx.unidentifiedPayment.count({ where }),
            tx.unidentifiedPayment.findMany({
              where,
              orderBy: { valueDate: 'asc' },
              take: TOP,
            }),
          ]);
          add(
            'UNIDENTIFIED_PAYMENTS',
            'Unidentified payments to match',
            'payment.suspense.receive',
            'MAKER',
            count,
            rows.map((r) => ({
              id: r.id,
              reference: r.reference,
              label: `${humanize(r.channel)}${r.payerName ? ` · ${r.payerName}` : ''}`,
              amount: decStr(r.remaining),
              currency: r.currency,
              href: '/lending/suspense',
              since: day(r.valueDate),
            })),
          );
        }
        if (has('loan.covenant.manage')) {
          const s = scopeOf('loan.covenant.manage');
          if (s) {
            const where: Prisma.LoanCovenantWhereInput = {
              tenantId,
              status: 'ACTIVE',
              nextTestOn: { lt: bd },
              loanAccount: s as Prisma.LoanAccountWhereInput,
            };
            const [count, rows] = await Promise.all([
              tx.loanCovenant.count({ where }),
              tx.loanCovenant.findMany({
                where,
                orderBy: { nextTestOn: 'asc' },
                take: TOP,
                include: {
                  loanAccount: { select: { id: true, reference: true } },
                },
              }),
            ]);
            add(
              'COVENANTS_OVERDUE',
              'Covenant tests overdue',
              'loan.covenant.manage',
              'MAKER',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.loanAccount.reference,
                label: humanize(r.type),
                href: loanHref(r.loanAccount.id),
                since: day(r.nextTestOn),
              })),
            );
          }
        }
        if (has('loan.payoff_quote.issue')) {
          const s = scopeOf('loan.payoff_quote.issue');
          if (s) {
            const where: Prisma.PayoffQuoteWhereInput = {
              tenantId,
              status: 'ISSUED',
              expiresOn: { gte: bd },
              loanAccount: s as Prisma.LoanAccountWhereInput,
            };
            const [count, rows] = await Promise.all([
              tx.payoffQuote.count({ where }),
              tx.payoffQuote.findMany({
                where,
                orderBy: { expiresOn: 'asc' },
                take: TOP,
                include: {
                  loanAccount: { select: { id: true, reference: true } },
                },
              }),
            ]);
            add(
              'PAYOFF_QUOTES_OPEN',
              'Payoff letters outstanding',
              'loan.payoff_quote.issue',
              'INFO',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.reference,
                label: `${r.loanAccount.reference} · ${r.recipientName || humanize(r.purpose)}`,
                currency: r.currency,
                href: loanHref(r.loanAccount.id),
                since: day(r.expiresOn),
              })),
            );
          }
        }

        // ── Documents ─────────────────────────────────────────────────────
        if (has('document.review')) {
          const branches = branchScope(scopeOf('document.review'));
          if (branches) {
            const rows = await tx.customerDocument.findMany({
              where: {
                tenantId,
                status: 'ACTIVE',
                reviewStatus: 'PENDING_REVIEW',
                ...(branches === 'ALL'
                  ? {}
                  : { borrower: { branchId: { in: branches } } }),
              },
              orderBy: { updatedAt: 'asc' },
              take: SCAN,
              include: {
                versions: { select: { version: true, uploadedBy: true } },
                borrower: { select: { firstName: true, lastName: true } },
              },
            });
            const mine = rows.filter(
              (d) =>
                d.versions.find((v) => v.version === d.currentVersion)
                  ?.uploadedBy !== me,
            );
            add(
              'DOCUMENTS_TO_REVIEW',
              'Documents to review',
              'document.review',
              'CHECKER',
              mine.length,
              mine.map((d) => ({
                id: d.id,
                reference: d.typeCode,
                label: `${fullName(d.borrower)} · ${d.title}`,
                href: `/lending/customers/${d.borrowerId}/documents`,
                since: d.updatedAt.toISOString(),
              })),
            );
          }
        }

        // ── Finance ───────────────────────────────────────────────────────
        if (has('accounting.period.approve')) {
          const rows = await tx.accountingPeriod.findMany({
            where: {
              tenantId,
              OR: [
                { status: 'PENDING', NOT: { preparedBy: me } },
                { status: 'PENDING', preparedBy: null },
                { status: 'REOPEN_PENDING', NOT: { reopenRequestedBy: me } },
                { status: 'REOPEN_PENDING', reopenRequestedBy: null },
              ],
            },
            orderBy: [{ year: 'asc' }, { month: 'asc' }],
          });
          add(
            'PERIODS_TO_APPROVE',
            'Period closes and reopenings to approve',
            'accounting.period.approve',
            'CHECKER',
            rows.length,
            rows.map((p) => ({
              id: p.id,
              reference:
                p.month === 0
                  ? `${p.year}`
                  : `${p.year}-${String(p.month).padStart(2, '0')}`,
              label:
                p.status === 'REOPEN_PENDING'
                  ? 'Reopening requested'
                  : p.month === 0
                    ? 'Year-end close'
                    : 'Month-end close',
              href: '/lending/close',
              since: (p.status === 'REOPEN_PENDING'
                ? p.updatedAt
                : (p.preparedAt ?? p.updatedAt)
              ).toISOString(),
            })),
          );
        }
        if (has('loan.migration.approve')) {
          const rows = await tx.migrationBatch.findMany({
            where: {
              tenantId,
              status: { in: ['VALIDATED', 'PARTIALLY_POSTED'] },
              errorCount: 0,
              createdBy: { not: me },
            },
            orderBy: { createdAt: 'asc' },
            take: TOP,
          });
          add(
            'MIGRATIONS_TO_APPROVE',
            'Migration files to approve',
            'loan.migration.approve',
            'CHECKER',
            rows.length,
            rows.map((b) => ({
              id: b.id,
              reference: b.reference,
              label: `${b.validCount} loan(s) · cut-over ${b.cutOverDate.toISOString().slice(0, 10)}`,
              href: '/lending/migration',
              since: b.createdAt.toISOString(),
            })),
          );
        }
        if (has('regulatory.submit')) {
          const rows = await tx.regulatoryReturn.findMany({
            where: {
              tenantId,
              status: 'PENDING_SUBMISSION',
              generatedBy: { not: me },
              OR: [
                { submissionRequestedBy: null },
                { submissionRequestedBy: { not: me } },
              ],
            },
            orderBy: [{ year: 'asc' }, { month: 'asc' }],
            take: TOP,
          });
          add(
            'RETURNS_TO_SUBMIT',
            'Regulatory returns to submit',
            'regulatory.submit',
            'CHECKER',
            rows.length,
            rows.map((r) => ({
              id: r.id,
              reference: `${r.year}-${String(r.month).padStart(2, '0')}`,
              label: 'NBC return awaiting submission',
              href: '/lending/regulatory',
              since: r.createdAt.toISOString(),
            })),
          );
        }
        if (has('impairment.approve')) {
          const where: Prisma.ImpairmentPolicyWhereInput = {
            tenantId,
            status: 'PENDING',
            makerId: { not: me },
          };
          const rows = await tx.impairmentPolicy.findMany({
            where,
            orderBy: { createdAt: 'asc' },
            take: TOP,
          });
          add(
            'IMPAIRMENT_TO_APPROVE',
            'Impairment policies to approve',
            'impairment.approve',
            'CHECKER',
            await tx.impairmentPolicy.count({ where }),
            rows.map((r) => ({
              id: r.id,
              reference: `v${r.version}`,
              label: 'Impairment policy',
              href: '/lending/operations',
              since: r.createdAt.toISOString(),
            })),
          );
        }
        if (has('servicing.batch.run')) {
          const row = await tx.tenantBusinessDate.findUnique({
            where: { tenantId },
          });
          const failures = row?.lastBatchFailures ?? 0;
          add(
            'END_OF_DAY',
            'End of day',
            'servicing.batch.run',
            'INFO',
            failures,
            [
              {
                id: tenantId,
                reference: day(row?.lastBatchDate) ?? '—',
                label: failures
                  ? `${failures} accounts failed in the last run`
                  : row?.lastBatchDate
                    ? 'Last run completed'
                    : 'Not run yet',
                href: '/lending/operations',
              },
            ],
          );
        }

        // ── Trade finance and syndication ─────────────────────────────────
        if (has('trade.invoice.approve')) {
          const s = scopeOf('trade.invoice.approve');
          if (s) {
            const where: Prisma.TradeInvoiceWhereInput = {
              tenantId,
              status: 'SUBMITTED',
              registeredBy: { not: me },
              facility: s as Prisma.FacilityWhereInput,
            };
            const [count, rows] = await Promise.all([
              tx.tradeInvoice.count({ where }),
              tx.tradeInvoice.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                take: TOP,
              }),
            ]);
            add(
              'TRADE_INVOICES_TO_APPROVE',
              'Invoices to approve',
              'trade.invoice.approve',
              'CHECKER',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.reference,
                label: `${r.debtorName} · ${r.invoiceNumber}`,
                amount: decStr(r.amount),
                currency: r.currency,
                href: `/lending/trade/invoices/${r.facilityId}`,
                since: r.createdAt.toISOString(),
              })),
            );
          }
        }
        if (has('trade.lc.issue')) {
          const s = scopeOf('trade.lc.issue');
          if (s) {
            const where: Prisma.LetterOfCreditWhereInput = {
              tenantId,
              status: 'REQUESTED',
              requestedBy: { not: me },
              ...(s as Prisma.LetterOfCreditWhereInput),
            };
            const [count, rows] = await Promise.all([
              tx.letterOfCredit.count({ where }),
              tx.letterOfCredit.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                take: TOP,
              }),
            ]);
            add(
              'LETTERS_OF_CREDIT_TO_ISSUE',
              'Letters of credit to issue',
              'trade.lc.issue',
              'CHECKER',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.reference,
                label: r.beneficiaryName,
                amount: decStr(r.amount),
                currency: r.currency,
                href: `/lending/trade/letters-of-credit/${r.id}`,
                since: r.createdAt.toISOString(),
                aboveLimit: aboveAuthority(
                  subject,
                  'trade.lc.issue',
                  decStr(r.amount),
                  r.currency,
                ),
              })),
            );
          }
        }
        if (has('syndication.approve')) {
          const s = scopeOf('syndication.approve');
          if (s) {
            const where: Prisma.SyndicateWhereInput = {
              tenantId,
              status: 'DRAFT',
              makerId: { not: me },
              loanAccount: s as Prisma.LoanAccountWhereInput,
            };
            const [count, rows] = await Promise.all([
              tx.syndicate.count({ where }),
              tx.syndicate.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                take: TOP,
                include: {
                  loanAccount: { select: { reference: true } },
                },
              }),
            ]);
            add(
              'SYNDICATES_TO_APPROVE',
              'Syndicates to approve',
              'syndication.approve',
              'CHECKER',
              count,
              rows.map((r) => ({
                id: r.id,
                reference: r.loanAccount.reference,
                label: 'Syndicate',
                amount: decStr(r.principal),
                currency: r.currency,
                href: `/lending/syndication/${r.loanAccountId}`,
                since: r.createdAt.toISOString(),
              })),
            );
          }
        }

        // ── Access governance ─────────────────────────────────────────────
        if (has('access_policy.approve')) {
          const [assignments, authorities, delegations, policies] =
            await Promise.all([
              tx.roleAssignment.findMany({
                where: {
                  tenantId,
                  status: 'PENDING',
                  requestedBy: { not: me },
                  userId: { not: me },
                },
                include: {
                  role: { select: { code: true } },
                  user: { select: { email: true } },
                },
                orderBy: { createdAt: 'asc' },
                take: SCAN,
              }),
              tx.approvalAuthority.findMany({
                where: {
                  tenantId,
                  status: 'PENDING',
                  requestedBy: { not: me },
                  OR: [{ userId: null }, { userId: { not: me } }],
                },
                orderBy: { createdAt: 'asc' },
                take: SCAN,
              }),
              tx.delegation.findMany({
                where: {
                  tenantId,
                  status: 'PENDING',
                  createdBy: { not: me },
                  toUserId: { not: me },
                },
                orderBy: { createdAt: 'asc' },
                take: SCAN,
              }),
              tx.policyVersion.findMany({
                where: { tenantId, status: 'SUBMITTED', makerId: { not: me } },
                include: { policy: { select: { code: true } } },
                orderBy: { createdAt: 'asc' },
                take: SCAN,
              }),
            ]);
          const serviceAccounts = await tx.approvalTask.findMany({
            where: {
              tenantId,
              subjectType: SERVICE_ACCOUNT_SUBJECT,
              status: 'PENDING',
              makerId: { not: me },
            },
            orderBy: { createdAt: 'asc' },
            take: SCAN,
          });
          add(
            'ACCESS_TO_APPROVE',
            'Access changes to approve',
            'access_policy.approve',
            'CHECKER',
            assignments.length +
              authorities.length +
              delegations.length +
              policies.length +
              serviceAccounts.length,
            [
              ...assignments.map((a) => ({
                id: a.id,
                reference: a.role.code,
                label: `Role for ${a.user.email}`,
                href: '/lending/access',
                since: a.createdAt.toISOString(),
              })),
              ...authorities.map((a) => ({
                id: a.id,
                reference: a.permission,
                label: 'Approval authority',
                amount: decStr(a.maxAmount),
                currency: a.currency,
                href: '/lending/access',
                since: a.createdAt.toISOString(),
              })),
              ...delegations.map((d) => ({
                id: d.id,
                reference: 'DELEGATION',
                label: d.permissions.join(', '),
                href: '/lending/access',
                since: d.createdAt.toISOString(),
              })),
              ...policies.map((p) => ({
                id: p.id,
                reference: `${p.policy.code} v${p.version}`,
                label: 'Access policy',
                href: '/lending/access',
                since: p.createdAt.toISOString(),
              })),
              ...serviceAccounts.map((t) => ({
                id: t.id,
                reference: (t.payload as { name?: string }).name ?? 'SERVICE',
                label: 'Service account',
                href: '/lending/access?tab=service-accounts',
                since: t.createdAt.toISOString(),
              })),
            ],
          );
        }
        if (has('access_policy.manage')) {
          // Approved service accounts whose key the requester has not collected yet.
          const where: Prisma.ApprovalTaskWhereInput = {
            tenantId,
            subjectType: SERVICE_ACCOUNT_SUBJECT,
            status: 'APPROVED',
            makerId: me,
          };
          const [count, rows] = await Promise.all([
            tx.approvalTask.count({ where }),
            tx.approvalTask.findMany({
              where,
              orderBy: { createdAt: 'asc' },
              take: TOP,
            }),
          ]);
          if (count)
            add(
              'SERVICE_KEYS_TO_COLLECT',
              'Service account keys to collect',
              'access_policy.manage',
              'MAKER',
              count,
              rows.map((t) => ({
                id: t.id,
                reference: (t.payload as { name?: string }).name ?? 'SERVICE',
                label: 'Approved; collect the key once',
                href: '/lending/access?tab=service-accounts',
                since: t.createdAt.toISOString(),
              })),
            );
        }
        if (has('feature_flag.approve')) {
          const where: Prisma.FlagChangeApprovalWhereInput = {
            tenantId,
            status: 'PENDING',
            makerId: { not: me },
          };
          const [count, rows, cohortRows] = await Promise.all([
            tx.flagChangeApproval.count({ where }),
            tx.flagChangeApproval.findMany({
              where,
              orderBy: { createdAt: 'asc' },
              take: TOP,
              include: { rule: { select: { flagKey: true } } },
            }),
            tx.approvalTask.findMany({
              where: {
                tenantId,
                subjectType: COHORT_SUBJECT,
                status: 'PENDING',
                makerId: { not: me },
              },
              orderBy: { createdAt: 'asc' },
              take: SCAN,
            }),
          ]);
          // A person being placed in a cohort may not approve it either.
          const cohorts = cohortRows.filter((t) => {
            const p = t.payload as { subjectType?: string; subjectId?: string };
            return !(p.subjectType === 'USER' && p.subjectId === me);
          });
          add(
            'FLAGS_TO_APPROVE',
            'Flag changes to approve',
            'feature_flag.approve',
            'CHECKER',
            count + cohorts.length,
            [
              ...rows.map((r) => ({
                id: r.id,
                reference: r.rule.flagKey,
                label: humanize(r.action),
                href: '/lending/access?tab=flags',
                since: r.createdAt.toISOString(),
              })),
              ...cohorts.map((t) => {
                const p = t.payload as { member?: boolean };
                return {
                  id: t.id,
                  reference: t.subjectId,
                  label: p.member
                    ? 'Cohort: add member'
                    : 'Cohort: remove member',
                  href: '/lending/access?tab=flags',
                  since: t.createdAt.toISOString(),
                };
              }),
            ],
          );
        }
        if (has('audit.read')) {
          const since = new Date(Date.now() - 7 * 86_400_000);
          const count = await tx.auditEvent.count({
            where: { tenantId, outcome: 'DENY', eventTime: { gte: since } },
          });
          add(
            'AUDIT_DENIALS',
            'Refused actions this week',
            'audit.read',
            'INFO',
            count,
            [],
          );
        }

        const total = queues
          .filter((q) => q.kind !== 'INFO')
          .reduce((a, q) => a + q.count, 0);
        return { businessDate, total, queues };
      },
      { timeoutMs: 30_000 },
    );
  }

  /**
   * Pending maker-checker tasks, plus approved disbursements waiting to be
   * paid out. The task's own `requiredPermission` names who may act; the maker
   * never sees their own task; loan tasks honour the loan's scope.
   */
  private async approvalTasks(
    tx: Tx,
    tenantId: string,
    me: string,
    subject: Subject,
    held: Set<string>,
    scopes: Map<string, Scope | null>,
    add: (
      code: string,
      title: string,
      action: string,
      kind: QueueKind,
      count: number,
      items: WorkItem[],
    ) => void,
  ) {
    const execute = held.has('loan.disbursement.execute');
    const tasks = await tx.approvalTask.findMany({
      where: {
        tenantId,
        makerId: { not: me },
        // Access governance requests have their own queues below.
        subjectType: { notIn: GOVERNANCE_SUBJECTS },
        OR: [
          { status: 'PENDING', requiredPermission: { in: [...held] } },
          ...(execute ? [{ status: 'APPROVED', action: 'DISBURSEMENT' }] : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    // Which loan accounts each permission's scope reaches, among the tasks' subjects.
    const loanIds = [
      ...new Set(
        tasks
          .filter((t) => t.subjectType === 'LOAN_ACCOUNT')
          .map((t) => t.subjectId),
      ),
    ];
    const reach = new Map<string, Set<string>>();
    const loans = new Map<
      string,
      { reference: string; borrowerId: string; currency: string }
    >();
    const permsNeeded = new Set(
      tasks.map((t) =>
        t.status === 'APPROVED'
          ? 'loan.disbursement.execute'
          : t.requiredPermission,
      ),
    );
    for (const p of permsNeeded) {
      const s = scopes.get(p);
      if (!s || !loanIds.length) {
        reach.set(p, new Set());
        continue;
      }
      const rows = await tx.loanAccount.findMany({
        where: {
          tenantId,
          id: { in: loanIds },
          ...(s as Prisma.LoanAccountWhereInput),
        },
        select: { id: true, reference: true, borrowerId: true, currency: true },
      });
      reach.set(p, new Set(rows.map((r) => r.id)));
      for (const r of rows) loans.set(r.id, r);
    }
    // Other subjects: an unidentified payment is tenant-level; the rest are
    // visible only to someone whose scope for the permission is unrestricted.
    const unrestricted = (p: string) => {
      const s = scopes.get(p);
      return !!s && Object.keys(s).length === 0;
    };
    const visible = tasks.filter((t) => {
      const p =
        t.status === 'APPROVED'
          ? 'loan.disbursement.execute'
          : t.requiredPermission;
      if (!held.has(p)) return false;
      if (t.subjectType === 'LOAN_ACCOUNT')
        return reach.get(p)?.has(t.subjectId) ?? false;
      if (t.subjectType === 'UNIDENTIFIED_PAYMENT') return true;
      return unrestricted(p);
    });
    const names = await this.borrowerNames(
      tx,
      tenantId,
      [...loans.values()].map((l) => l.borrowerId),
    );
    const groups = new Map<
      string,
      { title: string; action: string; items: WorkItem[] }
    >();
    const push = (
      code: string,
      title: string,
      action: string,
      item: WorkItem,
    ) => {
      if (!groups.has(code)) groups.set(code, { title, action, items: [] });
      groups.get(code)!.items.push(item);
    };
    for (const t of visible) {
      const loan = loans.get(t.subjectId);
      const amount = t.amount ? decStr(t.amount) : null;
      const item: WorkItem = {
        id: t.id,
        reference: loan?.reference ?? humanize(t.action),
        label: loan
          ? `${names.get(loan.borrowerId) ?? ''} · ${humanize(t.action)}`
          : humanize(t.action),
        amount,
        currency: t.currency,
        href:
          t.subjectType === 'LOAN_ACCOUNT'
            ? loanHref(t.subjectId)
            : t.subjectType === 'UNIDENTIFIED_PAYMENT'
              ? '/lending/suspense'
              : '/lending/trade',
        since: t.createdAt.toISOString(),
      };
      if (t.status === 'APPROVED') {
        push(
          'DISBURSEMENTS_TO_EXECUTE',
          'Approved disbursements to pay out',
          'loan.disbursement.execute',
          item,
        );
        continue;
      }
      const q = TASK_QUEUES[t.action];
      const action = q?.action ?? 'loan.repayment.reverse';
      if (amount && t.currency && ACTION_BY_CODE[action]?.approvalAuthority)
        item.aboveLimit = aboveAuthority(
          subject,
          ACTION_BY_CODE[action].permission,
          amount,
          t.currency,
        );
      if (q) push(q.code, q.title, q.action, item);
      else push('OTHER_APPROVALS', 'Other approvals', action, item);
    }
    // Every task queue the user could act on is listed, even when empty.
    const seen = new Set<string>();
    for (const q of Object.values(TASK_QUEUES)) {
      if (seen.has(q.code)) continue;
      const perms = Object.values(TASK_QUEUES)
        .filter((x) => x.code === q.code)
        .map((x) => x.action);
      if (!perms.some((a) => held.has(ACTION_BY_CODE[a].permission))) continue;
      seen.add(q.code);
      const g = groups.get(q.code);
      const action =
        perms.find((a) => held.has(ACTION_BY_CODE[a].permission)) ?? q.action;
      add(
        q.code,
        q.title,
        g?.action ?? action,
        'CHECKER',
        g?.items.length ?? 0,
        g?.items ?? [],
      );
    }
    if (execute) {
      const g = groups.get('DISBURSEMENTS_TO_EXECUTE');
      add(
        'DISBURSEMENTS_TO_EXECUTE',
        'Approved disbursements to pay out',
        'loan.disbursement.execute',
        'CHECKER',
        g?.items.length ?? 0,
        g?.items ?? [],
      );
    }
    const other = groups.get('OTHER_APPROVALS');
    if (other)
      add(
        'OTHER_APPROVALS',
        other.title,
        other.action,
        'CHECKER',
        other.items.length,
        other.items,
      );
  }

  private appItem(
    a: {
      id: string;
      reference: string;
      requestedAmount: unknown;
      currency: string;
      borrower: { firstName: string; lastName: string };
    },
    since: Date | null,
  ): WorkItem {
    return {
      id: a.id,
      reference: a.reference,
      label: fullName(a.borrower),
      amount: decStr(a.requestedAmount as string),
      currency: a.currency,
      href: appHref(a.id),
      since: since?.toISOString() ?? null,
    };
  }

  private async borrowerNames(
    tx: Tx,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await tx.borrower.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(rows.map((r) => [r.id, fullName(r)]));
  }

  /** The platform operator's queue: plan payments to confirm, organisations waiting. */
  private async platformWork() {
    const [payments, pending, suspended] = await Promise.all([
      this.prisma.planPayment.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: TOP,
        include: { tenant: { select: { name: true } } },
      }),
      this.prisma.tenant.count({ where: { status: 'PENDING_PAYMENT' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
    ]);
    const paymentCount = await this.prisma.planPayment.count({
      where: { status: 'PENDING' },
    });
    const queues: WorkQueue[] = [
      {
        code: 'PLAN_PAYMENTS_TO_CONFIRM',
        title: 'Plan payments to confirm',
        permission: 'platform',
        action: 'platform',
        kind: 'CHECKER',
        money: true,
        needsMfa: false,
        count: paymentCount,
        href: '/platform-payments',
        items: payments.map((p) => ({
          id: p.id,
          reference: p.reference,
          label: `${p.tenant.name} · ${p.plan}`,
          amount: decStr(p.amount),
          currency: p.currency,
          href: '/platform-payments',
          since: p.createdAt.toISOString(),
        })),
      },
      {
        code: 'ORGANISATIONS_PENDING',
        title: 'Organisations pending activation',
        permission: 'platform',
        action: 'platform',
        kind: 'INFO',
        money: false,
        needsMfa: false,
        count: pending,
        href: '/tenants',
        items: [],
      },
      {
        code: 'ORGANISATIONS_SUSPENDED',
        title: 'Suspended organisations',
        permission: 'platform',
        action: 'platform',
        kind: 'INFO',
        money: false,
        needsMfa: false,
        count: suspended,
        href: '/tenants',
        items: [],
      },
    ];
    return { businessDate: null, total: paymentCount, queues };
  }
}

/** Branches a permission's scope reaches for customer-level records: 'ALL', a list, or null. */
export function branchScope(s: Scope | null): 'ALL' | string[] | null {
  if (!s) return null;
  const or = (s as { OR?: Record<string, unknown>[] }).OR;
  if (!or) return 'ALL';
  const ids = new Set<string>();
  for (const c of or) {
    const b = c.branchId as { in?: string[] } | undefined;
    if (b?.in && !c.legalEntityId) b.in.forEach((x) => ids.add(x));
  }
  return ids.size ? [...ids] : null;
}

/**
 * True when the user holds an authority for the permission in this currency
 * and the amount is above every such limit. Other currencies are converted by
 * the decision engine at the click; here they are left unmarked.
 */
export function aboveAuthority(
  subject: Subject,
  permission: string,
  amount: string,
  currency: string,
): boolean {
  const same = subject.authorities.filter(
    (a) => a.permission === permission && a.currency === currency,
  );
  if (!same.length)
    return subject.authorities.every((a) => a.permission !== permission);
  return same.every((a) => D(amount).gt(a.maxAmount));
}

function fullName(b: { firstName: string; lastName: string }): string {
  return `${b.firstName} ${b.lastName}`.trim();
}

function humanize(code: string): string {
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
