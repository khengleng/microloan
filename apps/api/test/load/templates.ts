/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- load fixtures: modules are required after the environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Builds the template book for the load test through the real HTTP API:
 * products approved by a checker, loans originated, approved, booked and
 * disbursed, repaid (or not) on their due dates while end of day runs every
 * day, and some restructured. Every row these loans own is therefore exactly
 * what the API writes; clone.ts then copies them to reach the target size.
 */
import { lending } from '@microloan/shared';
import type { Fixture } from '../lending/harness';

type Behaviour = 'GOOD' | 'LATE' | 'PARTIAL' | 'DEFAULT';

export interface TemplateUnit {
  key: string;
  family: 'INSTALMENT' | 'FLAT' | 'MICRO' | 'GROUP' | 'FACILITY';
  behaviour: Behaviour | 'RESTRUCTURED' | 'DRAWN';
  cohort: string;
  loanId: string;
  /** Rows this unit owns besides the loan's own (borrowers, group, facility). */
  roots: string[];
  /** Share of the cloned book this unit stands for. */
  weight: number;
}

/** Disbursement cohorts, oldest first; the book is cloned on CLONE_DATE. */
export const COHORTS = ['2026-01-05', '2026-02-02', '2026-03-02', '2026-03-30'];
export const CLONE_DATE = '2026-04-28';

const FAMILY_WEIGHT = {
  INSTALMENT: 0.32,
  FLAT: 0.18,
  MICRO: 0.25,
  GROUP: 0.13,
  FACILITY: 0.12,
} as const;
const BEHAVIOUR_WEIGHT: Record<string, number> = {
  GOOD: 0.72,
  LATE: 0.12,
  PARTIAL: 0.08,
  DEFAULT: 0.08,
  RESTRUCTURED: 0.04,
  DRAWN: 1,
};

export async function buildTemplates(
  f: Fixture,
  log: (m: string) => void,
): Promise<{ units: TemplateUnit[]; tenantId: string }> {
  const { harness, setup } = modules();
  const { expectOk, grant, authority, borrower, key } = harness;
  const { standardRoles, activeProduct, originateAndDisburse, docs } = setup;
  const {
    EodSchedulerService,
  } = require('../../src/lending/servicing/eod-scheduler.service');
  const scheduler = f.app.get(EodSchedulerService);
  const t = f.t1;

  await standardRoles(f);
  await grant(f, t, 'approver2', 'RESTRUCTURE_COMMITTEE');
  await grant(f, t, 'nobody', 'RISK_COMPLIANCE');
  for (const [user, perm, max] of [
    ['approver2', 'restructure.approve', '1000000'],
    ['approver2', 'restructure.waive_charges', '100000'],
    ['opsChecker', 'facility.drawdown.approve', '10000000'],
    ['approver', 'facility.limit.approve', '10000000'],
  ] as const)
    await authority(f, t, user, perm, 'USD', max);
  for (const flagKey of [
    'lending.group.joint_liability',
    'lending.revolving.drawdown',
  ])
    await enableFlag(flagKey);

  // Impairment policy in force, so end of day provisions every loan (OPS-5).
  const imp = expectOk(
    await f.as('finance').get('/lending/ops/impairment-policy'),
  );
  const proposed = expectOk(
    await f
      .as('finance')
      .post('/lending/ops/impairment-policy', { settings: imp.template }),
  );
  expectOk(
    await f
      .as('nobody')
      .post(`/lending/ops/impairment-policy/${proposed.id}/decision`, {
        approve: true,
      }),
  );

  log('products');
  const products = {
    INSTALMENT: (await activeProduct(f, 'PERSONAL_INSTALMENT', 'LT-PL'))
      .productId,
    FLAT: (
      await activeProduct(f, 'PERSONAL_INSTALMENT', 'LT-FLAT', (c: any) => {
        c.pricing.interestMethod = 'FLAT';
        c.repayment.prepayment.allowed = false;
        c.repayment.earlySettlement.rebateMethod = 'RULE_OF_78';
      })
    ).productId,
    MICRO: (await activeProduct(f, 'MICRO_INDIVIDUAL', 'LT-MF')).productId,
    GROUP: (await activeProduct(f, 'MICRO_GROUP', 'LT-GRP')).productId,
    FACILITY: (await activeProduct(f, 'REVOLVING_CREDIT', 'LT-RC')).productId,
  };

  const units: TemplateUnit[] = [];
  /** Payment plan: loan → behaviour, consulted on every day of the timeline. */
  const plans: { unit: TemplateUnit; behaviour: Behaviour }[] = [];
  let seq = 0;

  async function originate(
    family: TemplateUnit['family'],
    behaviour: Behaviour,
    cohort: string,
  ) {
    const tag = `${family}-${behaviour}-${cohort}-${++seq}`;
    if (family === 'GROUP') {
      const g = await formGroup(`LT-G${seq}`);
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: g.members[0],
          groupId: g.groupId,
          productId: products.GROUP,
          terms: {
            principal: '5000',
            numberOfInstalments: 12,
            disbursementDate: cohort,
          },
        }),
      );
      const loanId = await approveBookDisburse(app.id as string);
      return push(family, behaviour, cohort, loanId, [g.groupId, ...g.members]);
    }
    const terms: Record<string, Record<string, unknown>> = {
      INSTALMENT: {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: cohort,
      },
      FLAT: {
        principal: '3000',
        numberOfInstalments: 12,
        annualRate: '0.12',
        disbursementDate: cohort,
      },
      MICRO: {
        principal: '1500',
        numberOfInstalments: 26,
        disbursementDate: cohort,
      },
    };
    const r = await originateAndDisburse(f, products[family], terms[family], {
      guarantee: family === 'MICRO',
    });
    void tag;
    return push(family, behaviour, cohort, r.loanId, [r.borrowerId]);
  }

  function push(
    family: TemplateUnit['family'],
    behaviour: Behaviour,
    cohort: string,
    loanId: string,
    roots: string[],
  ) {
    const unit: TemplateUnit = {
      key: `${family}:${behaviour}:${cohort}`,
      family,
      behaviour,
      cohort,
      loanId,
      roots,
      weight: 0,
    };
    units.push(unit);
    plans.push({ unit, behaviour });
    return unit;
  }

  async function facility(cohort: string) {
    const b = await borrower(f, t, f.b1, { monthlyIncome: '40000' });
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId: products.FACILITY,
        terms: {
          principal: '50000',
          numberOfInstalments: 36,
          disbursementDate: cohort,
          annualRate: '0.12',
        },
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Within policy',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
    const facilityId = booked.facility.id as string;
    const dd = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount: '20000',
        }),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/facilities/${facilityId}/drawdowns/${dd.id}/release`,
          { externalReference: `BANK-DD-${dd.id.slice(0, 8)}` },
          key('lt-dd'),
        ),
    );
    const unit: TemplateUnit = {
      key: `FACILITY:DRAWN:${cohort}`,
      family: 'FACILITY',
      behaviour: 'DRAWN',
      cohort,
      loanId: booked.account.id as string,
      roots: [b.id as string, facilityId],
      weight: 0,
    };
    units.push(unit);
    return { unit, facilityId };
  }

  async function approveBookDisburse(appId: string) {
    await docs(f, appId, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${appId}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${appId}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Group has met for six months',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${appId}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${appId}/book`, {}),
    );
    const view = expectOk(
      await f.as('opsMaker').get(`/lending/applications/${appId}`),
    );
    for (const cp of view.conditions)
      expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/applications/${appId}/conditions/${cp.code}`, {
            resolution: 'SATISFIED',
            evidence: `Evidence for ${cp.code}`,
          }),
      );
    const loanId = booked.account.id as string;
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/disbursements`, {}),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${loanId}/disbursements/${task.id}/decision`, {
          approve: true,
        }),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${loanId}/disbursements/execute`,
          { externalReference: `BANK-${loanId.slice(0, 8)}` },
          `disb-${loanId}`,
        ),
    );
    return loanId;
  }

  async function formGroup(code: string) {
    const group = expectOk(
      await f.as('ro').post('/lending/applications/groups', {
        code,
        name: `${code} solidarity group`,
        branchId: f.b1,
        formedOn: '2025-06-01',
      }),
    );
    const members: string[] = [];
    for (let i = 0; i < 5; i++) {
      const b = await borrower(f, t, f.b1, { monthlyIncome: '900' });
      expectOk(
        await f
          .as('ro')
          .post(`/lending/applications/groups/${group.id}/members`, {
            borrowerId: b.id,
            role: i === 0 ? 'LEADER' : 'MEMBER',
            joinedOn: '2025-06-01',
          }),
      );
      members.push(b.id as string);
    }
    expectOk(
      await f.as('ro').post(`/lending/applications/groups/${group.id}/status`, {
        status: 'ACTIVE',
      }),
    );
    return { groupId: group.id as string, members };
  }

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'load test book',
      }),
    );
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/access/flags/changes/${r.approval.id}/decision`, {
          approve: true,
        }),
    );
  }

  /** Pay what each loan's behaviour says is paid on `day`. */
  async function collect(day: string) {
    // Nothing is paid on the last day of a month: its close is prepared by
    // that day's end of day, so those payments arrive the next morning.
    if (lending.addDays(day, 1).endsWith('-01')) return;
    const payDays = [day];
    if (day.endsWith('-01')) payDays.push(lending.addDays(day, -1));
    for (const { unit, behaviour } of plans) {
      if (behaviour === 'DEFAULT' || unit.behaviour === 'RESTRUCTURED')
        continue;
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${unit.loanId}`),
      );
      if (loan.account.status !== 'ACTIVE') continue;
      const lagDays = behaviour === 'LATE' ? 12 : 0;
      let owed = new lending.D(0);
      for (const l of loan.schedule) {
        if (l.status !== 'DUE') continue;
        if (lending.compareDates(lending.addDays(l.dueDate, lagDays), day) > 0)
          continue;
        for (const [due, paid] of [
          ['principalDue', 'principalPaid'],
          ['interestDue', 'interestPaid'],
          ['feeDue', 'feePaid'],
          ['taxDue', 'taxPaid'],
          ['penaltyDue', 'penaltyPaid'],
          ['deferredInterestDue', null],
        ] as const)
          owed = owed
            .plus(new lending.D(l[due] ?? 0))
            .minus(paid ? new lending.D(l[paid] ?? 0) : 0);
      }
      if (behaviour === 'PARTIAL') owed = owed.div(2).toDecimalPlaces(2);
      if (owed.lte(0)) continue;
      // Only pay on the day it falls due (or LATE days after), not every day.
      const dueToday = loan.schedule.some(
        (l: any) =>
          l.status === 'DUE' &&
          payDays.includes(lending.addDays(l.dueDate, lagDays)) &&
          l.number > 0,
      );
      if (!dueToday) continue;
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${unit.loanId}/repayments`,
            { amount: owed.toFixed(2) },
            key('lt-pay'),
          ),
      );
    }
  }

  async function restructure(unit: TemplateUnit, day: string) {
    const opened = await f
      .as('ro')
      .post(`/lending/restructures/loans/${unit.loanId}`, {
        hardshipCategory: 'ILLNESS',
        difficultyType: 'TEMPORARY',
        requestedRelief: { paymentBreakMonths: 1 },
        consentRecorded: true,
        consentReference: `FORM-${seq}`,
        expectedRecoveryDate: '2026-09-30',
      });
    let caseId: string = opened.body?.id;
    if (opened.status >= 300) {
      const existing = await f.system(() =>
        f.prisma.restructureCase.findFirst({
          where: { tenantId: t, loanAccountId: unit.loanId },
          orderBy: { createdAt: 'desc' },
        }),
      );
      if (!existing)
        throw new Error(
          `Restructure case refused: ${JSON.stringify(opened.body)}`,
        );
      caseId = existing.id;
    }
    expectOk(
      await f.as('analyst').post(`/lending/restructures/${caseId}/evidence`, {
        type: 'INCOME',
        description: 'Payslips and employer letter',
        quality: 'VERIFIED',
        documentRef: `DOC-${seq}`,
      }),
    );
    expectOk(
      await f
        .as('analyst')
        .post(`/lending/restructures/${caseId}/assessments`, {
          inputs: {
            template: 'INDIVIDUAL',
            verifiedNetIncome: '2500',
            essentialLivingExpenses: '700',
            debts: [],
          },
          evidenceQuality: 'VERIFIED',
          assumptions: 'Back at work next month',
          verificationDate: day,
        }),
    );
    const p = expectOk(
      await f.as('analyst').post(`/lending/restructures/${caseId}/proposals`, {
        options: {
          effectiveDate: day,
          numberOfInstalments: 14,
          arrearsTreatment: 'SPREAD_OVER_TERM',
        },
      }),
    );
    expectOk(
      await f
        .as('approver2')
        .post(`/lending/restructures/${caseId}/proposals/${p.id}/approve`, {
          note: 'Temporary illness',
        }),
    );
    expectOk(
      await f
        .as('ro')
        .post(`/lending/restructures/${caseId}/proposals/${p.id}/acceptance`, {
          proposalHash: p.proposalHash,
          method: 'SIGNED_FORM',
          evidence: 'Signed amendment form',
        }),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/restructures/${caseId}/execute`, {}, key('lt-exec')),
    );
  }

  // ── Timeline: originate each cohort on its date, run end of day daily ─────
  const restructureOn = new Map<string, TemplateUnit>();
  const facilities: { unit: TemplateUnit; facilityId: string }[] = [];
  let day = expectOk(await f.as('finance').get('/lending/ops/business-date'))
    .businessDate as string;
  for (const cohort of COHORTS) {
    if (lending.compareDates(day, cohort) < 0) {
      await runTo(cohort);
      day = cohort;
    }
    log(`cohort ${cohort}`);
    for (const family of ['INSTALMENT', 'FLAT', 'MICRO', 'GROUP'] as const)
      for (const behaviour of ['GOOD', 'LATE', 'PARTIAL', 'DEFAULT'] as const)
        await originate(family, behaviour, cohort);
    // A loan that stops paying and is restructured once it is in arrears.
    if (lending.compareDates(lending.addDays(cohort, 75), CLONE_DATE) < 0) {
      const u = await originate('INSTALMENT', 'DEFAULT', cohort);
      u.behaviour = 'RESTRUCTURED';
      u.key = `INSTALMENT:RESTRUCTURED:${cohort}`;
      restructureOn.set(lending.addDays(cohort, 75), u);
    }
    facilities.push(await facility(cohort));
  }

  async function runTo(target: string) {
    let d = expectOk(await f.as('finance').get('/lending/ops/business-date'))
      .businessDate as string;
    while (lending.compareDates(d, target) < 0) {
      d = lending.addDays(d, 1);
      const r = await scheduler.runTenant(t, d, 1);
      const failed = r.runs.reduce((s: number, x: any) => s + x.failed, 0);
      if (failed)
        throw new Error(`End of day failed on ${d} for ${failed} loan(s)`);
      // End of day prepared the month's close; a second person locks it, so
      // the load run's month end has a closed previous month like a live book.
      if (lending.addDays(d, 1).endsWith('-01')) {
        const [y, m] = d.split('-').map(Number);
        const res = await f
          .as('nobody')
          .post(`/lending/ops/periods/${y}/${m}/decision`, { approve: true });
        if (res.status >= 300)
          throw new Error(
            `Month-end ${y}-${m} could not be closed: ${JSON.stringify(res.body)}`,
          );
        log(`  closed ${y}-${m}`);
      }
      await collect(d);
      const u = restructureOn.get(d);
      if (u) await restructure(u, d);
      // Facilities repay a little every month.
      if (d.endsWith('-25'))
        for (const fa of facilities)
          expectOk(
            await f
              .as('opsMaker')
              .post(
                `/lending/facilities/${fa.facilityId}/repayments`,
                { amount: '750' },
                key('lt-fac'),
              ),
          );
      if (d.endsWith('-01') || d.endsWith('-15')) log(`  end of day ${d}`);
    }
  }
  await runTo(CLONE_DATE);

  // Weights: the family share, split across its behaviours and cohorts.
  for (const family of Object.keys(FAMILY_WEIGHT) as TemplateUnit['family'][]) {
    const us = units.filter((u) => u.family === family);
    const total = us.reduce((s, u) => s + BEHAVIOUR_WEIGHT[u.behaviour], 0);
    for (const u of us)
      u.weight =
        (FAMILY_WEIGHT[family] * BEHAVIOUR_WEIGHT[u.behaviour]) / total;
  }
  return { units, tenantId: t };
}

function modules() {
  return {
    harness: require('../lending/harness'),
    setup: require('../lending/setup'),
  };
}
