import {
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CreditCheckStatus } from '@microloan/db';
import {
    CbcProvider,
    HttpCbcProvider,
    isCbcConfigured,
    CBC_NOT_READY_MESSAGE,
} from './cbc.provider';

@Injectable()
export class CreditBureauService {
    private readonly logger = new Logger(CreditBureauService.name);
    // Null until real CBC member credentials are configured. We deliberately do
    // NOT fall back to a sandbox provider: fabricated scores must never look
    // like a real bureau result on a live lending platform.
    private readonly provider: CbcProvider | null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly authz: AuthzService,
        private readonly audit: AuditService,
    ) {
        if (isCbcConfigured()) {
            this.provider = new HttpCbcProvider(
                process.env.CBC_API_URL!.trim(),
                process.env.CBC_API_KEY!.trim(),
            );
        } else {
            this.provider = null;
            this.logger.warn(`${CBC_NOT_READY_MESSAGE} Set CBC_API_URL and CBC_API_KEY to enable it.`);
        }
    }

    /** Whether the bureau integration is provisioned (real credentials present). */
    get ready(): boolean {
        return this.provider !== null;
    }

    /**
     * Feature #3: run a Credit Bureau Cambodia enquiry for a borrower and persist
     * the result. The raw bureau payload is never stored — only a score, grade,
     * reference, and a PII-free summary.
     */
    async runCheck(actor: JwtPayload, borrowerId: string) {
        this.authz.assertPermission(actor, Permission.CREDIT_CHECK_RUN);
        const borrower = await this.prisma.borrower.findFirst({
            where: this.authz.scopeWhere(actor, { id: borrowerId }),
        });
        if (!borrower) throw new NotFoundException('Borrower not found');
        this.authz.assertBranchAccess(actor, borrower.branchId);

        // Integration not provisioned yet — surface a clear message, never a fake score.
        if (!this.provider) {
            throw new ServiceUnavailableException(CBC_NOT_READY_MESSAGE);
        }

        const actorId = this.authz.actorId(actor);

        // Record the attempt first so failures are auditable.
        const check = await this.prisma.creditCheck.create({
            data: {
                tenantId: borrower.tenantId,
                borrowerId: borrower.id,
                provider: this.provider.name,
                status: CreditCheckStatus.PENDING,
                requestedByUserId: actorId,
            },
        });

        try {
            const report = await this.provider.checkCredit({
                firstName: borrower.firstName,
                lastName: borrower.lastName,
                idNumber: borrower.idNumber,
                phone: borrower.phone,
            });
            const updated = await this.prisma.creditCheck.update({
                where: { id: check.id },
                data: {
                    status: CreditCheckStatus.COMPLETED,
                    score: report.score,
                    grade: report.grade,
                    reportRef: report.reportRef,
                    summary: report.summary,
                    completedAt: new Date(),
                },
            });
            await this.audit.logAction(borrower.tenantId, actorId, 'CREATE', 'CreditCheck', updated.id, {
                borrowerId: borrower.id,
                provider: this.provider.name,
                grade: report.grade,
            });
            return updated;
        } catch (err) {
            this.logger.error(
                `CBC check failed for borrower ${borrower.id}`,
                err instanceof Error ? err.stack : String(err),
            );
            const failed = await this.prisma.creditCheck.update({
                where: { id: check.id },
                data: { status: CreditCheckStatus.FAILED, completedAt: new Date() },
            });
            return failed;
        }
    }

    async listForBorrower(actor: JwtPayload, borrowerId: string) {
        this.authz.assertPermission(actor, Permission.CREDIT_CHECK_VIEW);
        const borrower = await this.prisma.borrower.findFirst({
            where: this.authz.scopeWhere(actor, { id: borrowerId }),
        });
        if (!borrower) throw new NotFoundException('Borrower not found');
        this.authz.assertBranchAccess(actor, borrower.branchId);
        return this.prisma.creditCheck.findMany({
            where: { tenantId: borrower.tenantId, borrowerId: borrower.id },
            orderBy: { createdAt: 'desc' },
        });
    }
}
