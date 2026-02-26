import { PrismaClient, Role, LoanStatus, InterestMethod } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { calculateRepaymentSchedule } from '@microloan/shared';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Seeding Database MVP ---');

    // 1. Tenant
    let tenant = await prisma.tenant.findFirst({ where: { name: 'Acme Lending' } });
    if (!tenant) {
        tenant = await prisma.tenant.create({ data: { name: 'Acme Lending' } });
        console.log('Created Tenant: Acme Lending');
    }

    // 2. Admin User
    let admin = await prisma.user.findFirst({ where: { email: 'admin@acme.com' } });
    if (!admin) {
        const passwordHash = await bcrypt.hash('password123', 10);
        admin = await prisma.user.create({
            data: {
                tenantId: tenant.id,
                email: 'admin@acme.com',
                passwordHash,
                role: Role.ADMIN,
            },
        });
        console.log('Created Admin: admin@acme.com / password123');
    }

    // 3. Borrower
    let borrower = await prisma.borrower.findFirst({ where: { idNumber: 'C123456789' } });
    if (!borrower) {
        borrower = await prisma.borrower.create({
            data: {
                tenantId: tenant.id,
                firstName: 'Sok',
                lastName: 'Samnang',
                phone: '012345678',
                address: 'Phnom Penh',
                idNumber: 'C123456789',
            },
        });
        console.log('Created Borrower: Sok Samnang');
    }

    // 4. Loan + Schedule
    let loan = await prisma.loan.findFirst({ where: { borrowerId: borrower.id } });
    if (!loan) {
        const termMonths = 6;
        const principal = 1000;
        const annualInterestRate = 18; // 18% per year flat

        loan = await prisma.loan.create({
            data: {
                tenantId: tenant.id,
                borrowerId: borrower.id,
                principal,
                annualInterestRate,
                termMonths,
                interestMethod: InterestMethod.FLAT,
                startDate: new Date(),
                status: LoanStatus.DISBURSED,
            },
        });

        // Gen Schedule
        const scheduleItems = calculateRepaymentSchedule({
            principal,
            annualInterestRate,
            termMonths,
            startDate: new Date(),
            interestMethod: InterestMethod.FLAT, // matching string from @microloan/shared with @prisma/client enum
        });

        if (scheduleItems.length > 0) {
            await prisma.repaymentSchedule.createMany({
                data: scheduleItems.map(item => ({
                    loanId: loan!.id, // we know it's not null here
                    installmentNumber: item.installmentNumber,
                    dueDate: item.dueDate,
                    principalAmount: item.principalAmount,
                    interestAmount: item.interestAmount,
                    totalAmount: item.totalAmount,
                    outstandingPrincipal: item.outstandingPrincipal,
                })),
            });
        }

        console.log('Created Loan & Repayment Schedule');
    }

    console.log('--- Seed Complete ---');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
