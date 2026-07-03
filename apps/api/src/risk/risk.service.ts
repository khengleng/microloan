import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  computeScorecard,
  calculateRepaymentSchedule,
  InterestMethod,
  ScorecardInput,
} from '@microloan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RestructureDto } from './dto/restructure.dto';

const GRADE_SYNONYMS: Record<string, string[]> = {
  A: ['A', 'AA', 'EXCELLENT'],
  B: ['B', 'GOOD'],
  C: ['C', 'FAIR'],
  D: ['D', 'POOR'],
  E: ['E', 'BAD'],
};

@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  /** Compute, persist and return the internal scorecard + recommended rate. */
  async score(actor: JwtPayload, loanId: string) {
    this.authz.assertPermission(actor as any, Permission.LOAN_APPLICATION_REVIEW);
    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor as any, { id: loanId }),
      include: {
        borrower: true,
        collaterals: { select: { value: true } },
        guarantors: { select: { id: true } },
        schedules: { orderBy: { installmentNumber: 'asc' }, select: { totalAmount: true } },
        product: { include: { policies: true } },
        tenant: { select: { requireCreditCheckForApproval: true, maxAnnualInterestRatePct: true } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor as any, loan.branchId);

    // Latest completed credit check for this borrower.
    const check = await this.prisma.creditCheck.findFirst({
      where: { borrowerId: loan.borrowerId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { grade: true },
    });

    // Prior repayment behaviour across the borrower's OTHER loans (penalty on a
    // paid installment is used as a proxy for "paid late").
    const priorSchedules = await this.prisma.repaymentSchedule.findMany({
      where: { loan: { borrowerId: loan.borrowerId, id: { not: loan.id } }, isPaid: true },
      select: { penaltyAmount: true, paidPenalty: true },
    });
    const onTime = priorSchedules.filter((s) => Number(s.penaltyAmount) === 0).length;
    const late = priorSchedules.length - onTime;
    const priorDefaults = await this.prisma.loan.count({
      where: { borrowerId: loan.borrowerId, id: { not: loan.id }, status: { in: ['DEFAULTED', 'WRITTEN_OFF'] } },
    });

    const installmentAmount = loan.schedules.length ? Number(loan.schedules[0].totalAmount) : 0;
    const collateralValue = loan.collaterals.reduce((a, c) => a + Number(c.value), 0);

    const input: ScorecardInput = {
      bureauGrade: check?.grade ?? null,
      hasCreditCheck: !!check,
      requireCreditCheck: !!loan.tenant?.requireCreditCheckForApproval,
      monthlyIncome: loan.borrower.monthlyIncome != null ? Number(loan.borrower.monthlyIncome) : null,
      monthlyExpenses: loan.borrower.monthlyExpenses != null ? Number(loan.borrower.monthlyExpenses) : null,
      installmentAmount,
      onTimeInstallments: onTime,
      lateInstallments: late,
      priorDefaults,
      kycStatus: loan.borrower.kycStatus,
      collateralValue,
      principal: Number(loan.principal),
      guarantorCount: loan.guarantors.length,
    };

    const result = computeScorecard(input);

    // Risk-based pricing: recommend the product policy rate for the graded band,
    // capped at the tenant's NBC ceiling.
    let recommendedRate: number | null = null;
    if (loan.product?.policies?.length) {
      const syns = GRADE_SYNONYMS[result.grade] || [result.grade];
      const policy =
        loan.product.policies.find((p) => syns.includes((p.creditRating || '').toUpperCase())) || null;
      if (policy) {
        const cap = Number(loan.tenant?.maxAnnualInterestRatePct ?? 18);
        recommendedRate = Math.min(Number(policy.interestRate), cap);
      }
    }

    const saved = await this.prisma.creditScore.create({
      data: {
        tenantId: loan.tenantId,
        loanId: loan.id,
        borrowerId: loan.borrowerId,
        score: result.score,
        grade: result.grade,
        decision: result.decision,
        dsr: result.dsr != null ? result.dsr : null,
        recommendedRate,
        factors: result.factors as any,
        createdByUserId: actor.sub,
      },
      select: { id: true, createdAt: true },
    });

    await this.audit.logAction(
      loan.tenantId,
      this.authz.actorId(actor as any),
      'CREDIT_SCORE',
      'Loan',
      loan.id,
      { score: result.score, grade: result.grade, decision: result.decision },
    );

    return { id: saved.id, createdAt: saved.createdAt, recommendedRate, ...result };
  }

  async scores(actor: JwtPayload, loanId: string) {
    this.authz.assertPermission(actor as any, Permission.CUSTOMER_VIEW);
    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor as any, { id: loanId }),
      select: { id: true, branchId: true },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor as any, loan.branchId);
    return this.prisma.creditScore.findMany({
      where: { loanId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Reschedule the OUTSTANDING principal of a disbursed loan onto new terms.
   * Unpaid installments are regenerated; paid installments are preserved. The
   * loan is flagged restructured (NBC treats restructured loans as at least
   * Special Mention for provisioning).
   */
  async restructure(actor: JwtPayload, loanId: string, dto: RestructureDto) {
    this.authz.assertPermission(actor as any, Permission.LOAN_APPROVE);
    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor as any, { id: loanId }),
      include: {
        schedules: { orderBy: { installmentNumber: 'asc' } },
        tenant: { select: { maxAnnualInterestRatePct: true } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor as any, loan.branchId);
    if (loan.status !== 'DISBURSED') {
      throw new BadRequestException('Only disbursed loans can be restructured.');
    }

    const paid = loan.schedules.filter((s) => s.isPaid);
    const unpaid = loan.schedules.filter((s) => !s.isPaid);
    // Remaining principal = unpaid principal not yet paid.
    const outstanding = unpaid.reduce(
      (a, s) => a + Math.max(0, Number(s.principalAmount) - Number(s.paidPrincipal)),
      0,
    );
    if (outstanding <= 0) throw new BadRequestException('Loan has no outstanding principal to restructure.');

    const cap = Number(loan.tenant?.maxAnnualInterestRatePct ?? 18);
    const newRate = Math.min(dto.newAnnualInterestRate ?? Number(loan.annualInterestRate), cap);

    const newInstallments = calculateRepaymentSchedule({
      principal: Math.round(outstanding * 100) / 100,
      annualInterestRate: newRate,
      termMonths: dto.newTermMonths,
      startDate: new Date(),
      interestMethod: loan.interestMethod as InterestMethod,
    });
    if (newInstallments.length === 0) {
      throw new BadRequestException('Could not generate a new schedule for these terms.');
    }

    const startNumber = paid.length; // continue numbering after preserved installments

    await this.prisma.$transaction(async (tx) => {
      // Drop the old unpaid installments and lay down the new schedule.
      await tx.repaymentSchedule.deleteMany({
        where: { loanId: loan.id, isPaid: false },
      });
      await tx.repaymentSchedule.createMany({
        data: newInstallments.map((inst, i) => ({
          loanId: loan.id,
          installmentNumber: startNumber + i + 1,
          dueDate: inst.dueDate,
          principalAmount: inst.principalAmount,
          interestAmount: inst.interestAmount,
          penaltyAmount: 0,
          totalAmount: inst.totalAmount,
          outstandingPrincipal: inst.outstandingPrincipal,
        })),
      });
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          annualInterestRate: newRate,
          termMonths: startNumber + dto.newTermMonths,
          isRestructured: true,
          restructuredAt: new Date(),
          restructureCount: { increment: 1 },
        },
      });
      await tx.loanRestructure.create({
        data: {
          tenantId: loan.tenantId,
          loanId: loan.id,
          reason: dto.reason,
          oldTermMonths: loan.termMonths,
          oldAnnualInterestRate: loan.annualInterestRate,
          oldOutstanding: Math.round(outstanding * 100) / 100,
          newTermMonths: dto.newTermMonths,
          newAnnualInterestRate: newRate,
          createdByUserId: actor.sub,
        },
      });
    });

    await this.audit.logAction(
      loan.tenantId,
      this.authz.actorId(actor as any),
      'LOAN_RESTRUCTURE',
      'Loan',
      loan.id,
      { newTermMonths: dto.newTermMonths, newRate, outstanding: Math.round(outstanding * 100) / 100, reason: dto.reason },
    );

    return { success: true, outstanding: Math.round(outstanding * 100) / 100, newRate, newInstallmentCount: newInstallments.length };
  }
}
