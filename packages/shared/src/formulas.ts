export enum InterestMethod {
    FLAT = 'FLAT',
    REDUCING_BALANCE = 'REDUCING_BALANCE',
}

export interface LoanParams {
    principal: number;
    annualInterestRate: number; // in percentage, e.g., 12 for 12%
    termMonths: number;
    startDate: Date;
    interestMethod: InterestMethod;
}

export interface Installment {
    installmentNumber: number;
    dueDate: Date;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    outstandingPrincipal: number;
}

function roundTo2(num: number): number {
    return Math.round(num * 100) / 100;
}

function addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

export function calculateRepaymentSchedule(params: LoanParams): Installment[] {
    const { principal, annualInterestRate, termMonths, startDate, interestMethod } = params;
    const schedule: Installment[] = [];

    if (termMonths <= 0 || principal <= 0) {
        return schedule;
    }

    if (interestMethod === InterestMethod.FLAT) {
        // Flat Rate
        // Total Interest = P * r * t (where t is in years)
        const annualRateDec = annualInterestRate / 100;
        const totalInterest = principal * annualRateDec * (termMonths / 12);

        // Monthly amounts
        const monthlyPrincipalRaw = principal / termMonths;
        const monthlyInterestRaw = totalInterest / termMonths;

        let outstandingPrincipal = principal;

        for (let i = 1; i <= termMonths; i++) {
            let principalAmount = roundTo2(monthlyPrincipalRaw);
            let interestAmount = roundTo2(monthlyInterestRaw);

            // Last month adjustment for rounding differences
            if (i === termMonths) {
                const sumPrincipalSoFar = schedule.reduce((sum, inst) => sum + inst.principalAmount, 0);
                const sumInterestSoFar = schedule.reduce((sum, inst) => sum + inst.interestAmount, 0);

                principalAmount = roundTo2(principal - sumPrincipalSoFar);
                interestAmount = roundTo2(totalInterest - sumInterestSoFar);
            }

            outstandingPrincipal = roundTo2(outstandingPrincipal - principalAmount);
            // to avoid -0.00
            if (Math.abs(outstandingPrincipal) < 0.01) outstandingPrincipal = 0;

            schedule.push({
                installmentNumber: i,
                dueDate: addMonths(startDate, i),
                principalAmount,
                interestAmount,
                totalAmount: roundTo2(principalAmount + interestAmount),
                outstandingPrincipal,
            });
        }

    } else if (interestMethod === InterestMethod.REDUCING_BALANCE) {
        // Amortized Loan (Equated Monthly Installment - EMI)
        const monthlyRateDec = (annualInterestRate / 100) / 12;

        // If interest rate is 0, it's just principal / months
        let emi = principal / termMonths;
        if (monthlyRateDec > 0) {
            emi = (principal * monthlyRateDec * Math.pow(1 + monthlyRateDec, termMonths)) /
                (Math.pow(1 + monthlyRateDec, termMonths) - 1);
        }

        let outstandingPrincipal = principal;

        for (let i = 1; i <= termMonths; i++) {
            let interestAmount = roundTo2(outstandingPrincipal * monthlyRateDec);
            let principalAmount = roundTo2(emi - interestAmount);

            // Last month adjustment
            if (i === termMonths) {
                principalAmount = outstandingPrincipal;
            }

            outstandingPrincipal = roundTo2(outstandingPrincipal - principalAmount);
            if (Math.abs(outstandingPrincipal) < 0.01) outstandingPrincipal = 0;

            schedule.push({
                installmentNumber: i,
                dueDate: addMonths(startDate, i),
                principalAmount,
                interestAmount,
                totalAmount: roundTo2(principalAmount + interestAmount),
                outstandingPrincipal,
            });
        }
    }

    return schedule;
}
