"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const XLSX = __importStar(require("xlsx"));
let ExportsService = class ExportsService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async exportLoansToExcel(tenantId, actorId) {
        const loans = await this.prisma.loan.findMany({
            where: { tenantId },
            include: { borrower: true, product: true },
        });
        const data = loans.map((l) => ({
            'Loan ID': l.id,
            'Borrower First Name': l.borrower.firstName,
            'Borrower Last Name': l.borrower.lastName,
            'Borrower Phone': l.borrower.phone,
            'Product': l.product?.name || 'N/A',
            'Status': l.status,
            'Principal': Number(l.principal),
            'Interest Rate': Number(l.annualInterestRate),
            'Term (Months)': l.termMonths,
            'Start Date': l.startDate,
            'Interest Method': l.interestMethod,
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Loans');
        await this.audit.logAction(tenantId, actorId, 'READ', 'Export', 'Excel', { event: 'LOANS_EXPORTED' });
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }
    async exportRepaymentsToExcel(tenantId, actorId) {
        const repayments = await this.prisma.repayment.findMany({
            where: { tenantId },
            include: { loan: { include: { borrower: true } } },
        });
        const data = repayments.map((r) => ({
            'Repayment ID': r.id,
            'Loan ID': r.loanId,
            'Borrower Name': `${r.loan?.borrower?.firstName || ''} ${r.loan?.borrower?.lastName || ''}`,
            'Amount': Number(r.amount),
            'Principal Paid': Number(r.principalPaid),
            'Interest Paid': Number(r.interestPaid),
            'Penalty Paid': Number(r.penaltyPaid),
            'Date': r.date,
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Repayments');
        await this.audit.logAction(tenantId, actorId, 'READ', 'Export', 'Excel', { event: 'REPAYMENTS_EXPORTED' });
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }
};
exports.ExportsService = ExportsService;
exports.ExportsService = ExportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], ExportsService);
//# sourceMappingURL=exports.service.js.map