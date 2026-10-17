/**
 * Early-settlement payoff of a legacy loan (UC-31): outstanding principal +
 * interest on instalments already due + outstanding penalties; interest on
 * instalments not yet due is waived. Computed in whole cents so the quote and
 * the settlement that pays it always agree.
 */
export interface PayoffSchedule {
  id: string;
  dueDate: Date;
  isPaid: boolean;
  principalAmount: unknown;
  interestAmount: unknown;
  penaltyAmount: unknown;
  paidPrincipal: unknown;
  paidInterest: unknown;
  paidPenalty: unknown;
}

const cents = (v: unknown) => Math.round(Number(v) * 100);

export function computePayoff(schedules: PayoffSchedule[], asOf: Date) {
  let principal = 0;
  let interestDue = 0;
  let interestWaived = 0;
  let penalty = 0;
  const lines: {
    id: string;
    principal: number;
    interest: number;
    penalty: number;
    waivedInterest: number;
  }[] = [];
  for (const s of schedules) {
    if (s.isPaid) continue;
    const p = Math.max(0, cents(s.principalAmount) - cents(s.paidPrincipal));
    const i = Math.max(0, cents(s.interestAmount) - cents(s.paidInterest));
    const pen = Math.max(0, cents(s.penaltyAmount) - cents(s.paidPenalty));
    const due = new Date(s.dueDate) <= asOf;
    principal += p;
    penalty += pen;
    if (due) interestDue += i;
    else interestWaived += i;
    lines.push({
      id: s.id,
      principal: p / 100,
      interest: due ? i / 100 : 0,
      penalty: pen / 100,
      waivedInterest: due ? 0 : i / 100,
    });
  }
  return {
    outstandingPrincipal: principal / 100,
    accruedInterestDue: interestDue / 100,
    outstandingPenalty: penalty / 100,
    futureInterestWaived: interestWaived / 100,
    payoffAmount: (principal + interestDue + penalty) / 100,
    lines,
  };
}
