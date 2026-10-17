import { NotFoundException } from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Tx } from '../common/lending-prisma';
import { D, decStr, toLocalDate } from '../common/util';
import { facilityResource } from '../policy/resources';
import type { Resource } from '../policy/decision';

export type FacilityRow = NonNullable<
  Awaited<ReturnType<Tx['facility']['findFirst']>>
>;
export type AccountRow = NonNullable<
  Awaited<ReturnType<Tx['loanAccount']['findFirst']>>
>;

export interface FacilityState {
  facility: FacilityRow;
  /** The loan account carrying the drawn balance. */
  account: AccountRow;
  config: lending.ProductConfig;
  configValid: boolean;
  productCode: string;
  productVersionStatus: string;
  /** Engine terms derived from the facility row and the agreement's config. */
  terms: lending.FacilityTerms;
  /** Posted movements, oldest first — the engine's only view of history. */
  movements: lending.FacilityMovement[];
}

/**
 * Financial event types that move a facility's drawn balance.
 *
 * Accrual and penalty events raise receivables, not principal, so they are not
 * movements: including them would charge interest on interest the contract
 * never capitalized.
 */
const MOVEMENT_OF: Record<string, lending.FacilityMovementType> = {
  DISBURSEMENT: 'DRAWDOWN',
  REPAYMENT: 'REPAYMENT',
  SETTLEMENT: 'REPAYMENT',
  CAPITALIZATION: 'CAPITALIZATION',
};

/**
 * Build the engine's terms from the stored facility and its product config.
 *
 * The facility row holds what was negotiated (the limit, the window); the
 * agreement's configuration snapshot holds the product rules that applied when
 * it was booked. Neither is read from the live product, so retiring or editing
 * a product cannot change how an existing facility prices.
 */
export function facilityTerms(
  f: FacilityRow,
  config: lending.ProductConfig,
  annualRate: string,
): lending.FacilityTerms {
  const fc = config.facility;
  const limit = decStr(f.limitAmount);
  return {
    type: f.facilityType as lending.FacilityType,
    currency: f.currency,
    limitAmount: limit,
    availabilityStart: toLocalDate(f.availabilityFrom)!,
    availabilityEnd: toLocalDate(f.availabilityTo)!,
    maturityDate: toLocalDate(f.maturityDate)!,
    annualRate,
    dayCount: config.pricing.dayCount,
    rounding: config.pricing.rounding,
    minimumDrawdown: fc.minimumDrawdown,
    maximumDrawdown: fc.maximumDrawdown,
    commitmentFeeRate: fc.commitmentFeeRate,
    minimumPaymentRate: fc.minimumPaymentRate,
    minimumPaymentFloor: fc.minimumPaymentFloor,
    overlimitRate: fc.overlimitRate,
    overlimitTolerance: fc.overlimitTolerance,
    // Shares of the limit become amounts only here, where the limit is known.
    tranches: fc.tranches.map((t) => ({
      code: t.code,
      amount: D(limit).times(t.shareOfLimit).toString(),
      availableFrom: lending.addMonths(
        toLocalDate(f.availabilityFrom)!,
        t.availableAfterMonths,
      ),
      conditions: t.conditions,
    })),
  };
}

/**
 * How much of an event moved the drawn principal. A facility or card
 * repayment that also cleared interest or fees records its principal share as
 * the PRINCIPAL component; only that share reduces the balance.
 */
export function principalMoved(e: {
  type: string;
  amount: unknown;
  components: unknown;
}): string {
  const principal = (e.components as { PRINCIPAL?: string } | null)
    ?.PRINCIPAL;
  if (e.type === 'REPAYMENT' && principal != null)
    return decStr(principal);
  return decStr(e.amount as string);
}

export async function loadFacilityState(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  opts: { lock?: boolean } = {},
): Promise<FacilityState> {
  const facility = await tx.facility.findFirst({
    where: { id: facilityId, tenantId },
  });
  if (!facility) throw new NotFoundException('Facility not found');

  if (opts.lock !== false) {
    // Serialize money operations per facility on the same row the servicing
    // path locks, so a drawdown and a repayment cannot interleave on one
    // balance. Raw SQL bypasses the Prisma tenant guard, so scope explicitly.
    await tx.$queryRaw`SELECT id FROM "LoanAccount" WHERE "agreementId" = ${facility.agreementId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  }

  const [account, latest, product, version, events] = await Promise.all([
    tx.loanAccount.findFirst({
      where: { tenantId, agreementId: facility.agreementId },
    }),
    tx.agreementVersion.findFirst({
      where: { tenantId, agreementId: facility.agreementId },
      orderBy: { version: 'desc' },
    }),
    tx.lendingProduct.findFirst({
      where: { id: facility.productId, tenantId },
      select: { code: true },
    }),
    tx.productVersion.findFirst({
      where: { id: facility.productVersionId, tenantId },
      select: { status: true },
    }),
    tx.financialEvent.findMany({
      where: {
        tenantId,
        loanAccount: { agreementId: facility.agreementId },
        status: 'POSTED',
        type: { in: Object.keys(MOVEMENT_OF) },
      },
      orderBy: [{ valueDate: 'asc' }, { createdAt: 'asc' }],
      include: { journal: { include: { lines: true } } },
    }),
  ]);
  if (!account) throw new NotFoundException('Facility loan account not found');
  if (!latest) throw new NotFoundException('Facility agreement not found');

  const parsed = lending.validateProductConfig(latest.productConfig);
  const config = (
    parsed.ok ? parsed.config : latest.productConfig
  ) as lending.ProductConfig;
  const terms = latest.terms as unknown as { annualRate?: string };

  const drawdownTranche = new Map<string, string>();
  for (const d of await tx.drawdown.findMany({
    where: { tenantId, facilityId, status: 'RELEASED' },
    select: { eventId: true, trancheCode: true },
  })) {
    if (d.eventId && d.trancheCode)
      drawdownTranche.set(d.eventId, d.trancheCode);
  }

  return {
    facility,
    account,
    config,
    configValid: parsed.ok,
    productCode: product?.code ?? '',
    productVersionStatus: version?.status ?? 'UNKNOWN',
    terms: facilityTerms(facility, config, terms.annualRate ?? '0'),
    movements: events.map((e) => ({
      date: toLocalDate(e.valueDate)!,
      type: MOVEMENT_OF[e.type],
      amount:
        MOVEMENT_OF[e.type] === 'REPAYMENT'
          ? principalRepaid(e, config.accounting.loansReceivable)
          : decStr(e.amount),
      ...(drawdownTranche.has(e.id)
        ? { trancheCode: drawdownTranche.get(e.id) }
        : {}),
    })),
  };
}

/**
 * The principal a repayment or settlement took off the drawn balance: what it
 * credited to loans receivable. The rest of the payment settled stated
 * interest, fees or penalties, which never consumed the limit, so counting
 * the whole payment overstated the headroom and broke reconciliation.
 */
export function principalRepaid(
  event: {
    amount: unknown;
    journal?: {
      lines: { accountCode: string; debit: unknown; credit: unknown }[];
    } | null;
  },
  loansReceivable: string,
): string {
  if (!event.journal) return decStr(event.amount as string);
  return event.journal.lines
    .filter((l) => l.accountCode === loansReceivable)
    .reduce(
      (t, l) => t.plus(D(l.credit as string)).minus(D(l.debit as string)),
      D('0'),
    )
    .toString();
}

export function resourceOf(
  state: FacilityState,
  makerIds: string[] = [],
  opts: { workflowState?: string; amount?: string } = {},
): Resource {
  return facilityResource(
    state.facility,
    state.productCode,
    state.productVersionStatus,
    state.configValid ? state.config : null,
    state.configValid,
    makerIds,
    opts,
  );
}
