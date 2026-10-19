import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import type { Tx } from '../common/lending-prisma';
import { D, LendingActor, fromLocalDate } from '../common/util';
import { PostingService } from './posting.service';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { originalTermDays } from '../servicing/loan-state';

type Json = Prisma.InputJsonValue;

export type ImpairmentMode = 'REGULATORY' | 'ECL' | 'NONE';

/** One currency's regulatory provision against the allowance held, and the reserve for the gap. */
export interface ReserveRow {
  currency: string;
  /** NBC provision required on the lending loans (bands by term, probation floor, restructured minimum). */
  regulatoryProvision: string;
  /** Loss allowance held on the same loans (the ECL allowance in ECL mode). */
  allowance: string;
  /** Reserve required in equity: the provision above the ECL allowance (ECL mode only; 0 otherwise). */
  target: string;
  /** Reserve on the ledger before this measurement's posting. */
  held: string;
  /** target − held: appropriated (positive) or released (negative). */
  movement: string;
}

/**
 * The regulatory reserve (DECISIONS D-115, assumed — needs compliance
 * sign-off). A lender on CIFRS 9 expected credit loss still owes the NBC its
 * provision; where the NBC provision is higher than the ECL allowance the
 * difference is held in equity as a regulatory reserve, appropriated from
 * retained earnings (Dr retained earnings / Cr regulatory reserve) at each
 * month end and released the same way when it falls. It is not an expense
 * and does not touch the allowance. In REGULATORY mode the allowance already
 * is the NBC provision, so no reserve is held (and the books are not
 * CIFRS 9 compliant — the return says so).
 */
@Injectable()
export class RegulatoryReserveService {
  constructor(
    private readonly posting: PostingService,
    private readonly settings: TenantSettingsService,
  ) {}

  /** The impairment policy mode in force. */
  async mode(tx: Tx, tenantId: string): Promise<ImpairmentMode> {
    const row = await tx.impairmentPolicy.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, settings: true },
    });
    if (!row) return 'NONE';
    return (row.settings as unknown as lending.ImpairmentPolicy).mode;
  }

  /**
   * Per currency: the NBC provision on the active lending loans as they
   * stand, the allowance held on them, and the reserve the ledger should
   * carry at `end` against what it carries.
   */
  async measure(
    tx: Tx,
    tenantId: string,
    end: string,
  ): Promise<{ mode: ImpairmentMode; account: string; rows: ReserveRow[] }> {
    const [mode, s] = await Promise.all([
      this.mode(tx, tenantId),
      this.settings.get(tenantId, tx),
    ]);
    const bands = lending.regulatoryBands(s);
    const account = s.accounting.regulatoryReserve;
    const loans = await tx.loanAccount.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: {
        currency: true,
        principalOutstanding: true,
        allowance: true,
        daysPastDue: true,
        disbursementDate: true,
        maturityDate: true,
        originalMaturityDate: true,
        isRestructured: true,
        probationRemaining: true,
        delinquencyFloorDpd: true,
      },
    });
    const by = new Map<
      string,
      { provision: lending.Dec; allowance: lending.Dec }
    >();
    for (const l of loans) {
      const t = by.get(l.currency) ?? { provision: D(0), allowance: D(0) };
      const p = lending.regulatoryProvision(
        bands,
        {
          daysPastDue: l.daysPastDue,
          originalTermDays: originalTermDays(l),
          restructured: l.isRestructured,
          onProbation: l.probationRemaining > 0,
          floorDpd: l.delinquencyFloorDpd,
        },
        D(l.principalOutstanding).toString(),
        lending.defaultRounding(l.currency),
      );
      t.provision = t.provision.plus(D(p.amount));
      t.allowance = t.allowance.plus(D(l.allowance));
      by.set(l.currency, t);
    }
    // Per currency: the journal line carries no currency, the entry does.
    const heldRows = await tx.lendingJournalEntry.findMany({
      where: {
        tenantId,
        entryDate: { lte: fromLocalDate(end) },
        lines: { some: { accountCode: account } },
      },
      select: {
        currency: true,
        lines: {
          where: { accountCode: account },
          select: { debit: true, credit: true },
        },
      },
    });
    const held = new Map<string, lending.Dec>();
    for (const e of heldRows)
      for (const l of e.lines)
        held.set(
          e.currency,
          (held.get(e.currency) ?? D(0))
            .plus(D(l.credit))
            .minus(D(l.debit)),
        );
    const currencies = [...new Set([...by.keys(), ...held.keys()])].sort();
    const rows = currencies.map((currency) => {
      const t = by.get(currency) ?? { provision: D(0), allowance: D(0) };
      const target =
        mode === 'ECL'
          ? D(
              lending.regulatoryReserveTarget(
                t.provision.toString(),
                t.allowance.toString(),
              ),
            )
          : D(0);
      const h = held.get(currency) ?? D(0);
      return {
        currency,
        regulatoryProvision: t.provision.toString(),
        allowance: t.allowance.toString(),
        target: target.toString(),
        held: h.toString(),
        movement: target.minus(h).toString(),
      };
    });
    return { mode, account, rows };
  }

  /**
   * Bring the reserve to what `measure` requires, dated `end` (the month
   * end): one appropriation or release journal per currency that moved.
   * Measured against the ledger, so running it again posts nothing.
   */
  async appropriate(
    tx: Tx,
    tenantId: string,
    end: string,
    actor: LendingActor,
  ) {
    const m = await this.measure(tx, tenantId, end);
    const retained = (await this.settings.get(tenantId, tx)).accounting
      .retainedEarnings;
    const eventIds: string[] = [];
    for (const r of m.rows) {
      const move = D(r.movement);
      if (move.isZero()) continue;
      const amount = move.abs().toString();
      const up = move.gt(0);
      const event = await tx.financialEvent.create({
        data: {
          tenantId,
          loanAccountId: null,
          type: 'REGULATORY_RESERVE',
          businessDate: fromLocalDate(end),
          valueDate: fromLocalDate(end),
          amount,
          currency: r.currency,
          components: { ...r, mode: m.mode } as unknown as Json,
          idempotencyKey: `sys:regulatory-reserve:${end}:${r.currency}:${randomUUID()}`,
          requestHash: `regulatory-reserve:${end}:${r.currency}`,
          productVersionId: null,
          agreementVersion: null,
          engineVersion: lending.LENDING_ENGINE_VERSION,
          actorId: actor.id,
          actorType: actor.type,
          narrative: up
            ? `Regulatory reserve raised to ${r.target} ${r.currency}: NBC provision ${r.regulatoryProvision} above the allowance ${r.allowance}`
            : `Regulatory reserve released to ${r.target} ${r.currency}`,
        },
      });
      await this.posting.post(tx, {
        tenantId,
        financialEventId: event.id,
        loanAccountId: null,
        entryDate: fromLocalDate(end),
        currency: r.currency,
        description: up
          ? `Regulatory reserve appropriated from retained earnings (${end})`
          : `Regulatory reserve released to retained earnings (${end})`,
        lines: up
          ? [
              { accountCode: retained, debit: amount },
              { accountCode: m.account, credit: amount },
            ]
          : [
              { accountCode: m.account, debit: amount },
              { accountCode: retained, credit: amount },
            ],
      });
      eventIds.push(event.id);
    }
    return { ...m, eventIds };
  }
}
