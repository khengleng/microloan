/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Group lending and joint liability (Phase 2): forming a solidarity group,
 * lending to it, and what joint liability actually means when a member stops
 * paying or tries to leave.
 *
 * Evidence for: liability.group_joint
 */
import {
  acceptKeyFacts,
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  grant,
  key,
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Group lending (integration)', () => {
  let f: Fixture;
  let productId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'ro', 'RELATIONSHIP_OFFICER', { branchIds: [f.b1] });
    await enableFlag('lending.group.joint_liability');
    await setBusinessDate('2026-01-05');
    ({ productId } = await activeProduct(f, 'MICRO_GROUP', 'GRP-STD'));
  }, 60_000);
  afterAll(async () => f?.app.close());

  async function setBusinessDate(target: string) {
    let current = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 31);
      const next = lending.compareDates(step, target) > 0 ? target : step;
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: next }),
      );
      current = next;
    }
    return current;
  }

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'group lending integration tests',
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

  /** A group of `size` members formed long enough ago to borrow. */
  async function formGroup(code: string, size = 5, joinedOn = '2025-06-01') {
    const group = expectOk(
      await f.as('ro').post('/lending/applications/groups', {
        code,
        name: `${code} solidarity group`,
        branchId: f.b1,
        formedOn: '2025-06-01',
      }),
    );
    const members: string[] = [];
    for (let i = 0; i < size; i++) {
      const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '900' });
      expectOk(
        await f
          .as('ro')
          .post(`/lending/applications/groups/${group.id}/members`, {
            borrowerId: b.id,
            role: i === 0 ? 'LEADER' : 'MEMBER',
            joinedOn,
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

  const group = (id: string) =>
    f.as('ro').get(`/lending/applications/groups/${id}`);

  describe('forming a group', () => {
    let groupId: string;
    let members: string[];

    beforeAll(async () => {
      ({ groupId, members } = await formGroup('GRP-A'));
    }, 60_000);

    it('forms with a leader and the agreed membership', async () => {
      const g = expectOk(await group(groupId));
      expect(g.status).toBe('ACTIVE');
      expect(g.memberCount).toBe(5);
      expect(g.members.filter((m: any) => m.role === 'LEADER')).toHaveLength(1);
    });

    it('refuses a second leader', async () => {
      const b = await borrower(f, f.t1, f.b1);
      const r = await f
        .as('ro')
        .post(`/lending/applications/groups/${groupId}/members`, {
          borrowerId: b.id,
          role: 'LEADER',
          joinedOn: '2025-06-01',
        });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/already has a leader/);
    });

    it('refuses the same borrower twice', async () => {
      const r = await f
        .as('ro')
        .post(`/lending/applications/groups/${groupId}/members`, {
          borrowerId: members[1],
          joinedOn: '2025-06-01',
        });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/already in the group/);
    });

    it('refuses a borrower who is already in another group', async () => {
      const other = await formGroup('GRP-B');
      const r = await f
        .as('ro')
        .post(`/lending/applications/groups/${groupId}/members`, {
          borrowerId: other.members[1],
          joinedOn: '2025-06-01',
        });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(
        /already an active member of another group/,
      );
    });

    it('refuses a join date in the future', async () => {
      const b = await borrower(f, f.t1, f.b1);
      const r = await f
        .as('ro')
        .post(`/lending/applications/groups/${groupId}/members`, {
          borrowerId: b.id,
          joinedOn: '2026-06-01',
        });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/after the business date/);
    });

    it('hands the leadership to another active member', async () => {
      expectOk(
        await f
          .as('ro')
          .post(`/lending/applications/groups/${groupId}/leader`, {
            borrowerId: members[2],
            reason: 'Elected at the group meeting',
          }),
      );
      const g = expectOk(await group(groupId));
      const roleOf = (id: string) =>
        g.members.find((m: any) => m.borrowerId === id && !m.leftOn)?.role;
      expect(roleOf(members[2])).toBe('LEADER');
      expect(roleOf(members[0])).toBe('MEMBER');
      expect(g.members.filter((m: any) => m.role === 'LEADER')).toHaveLength(1);
    });

    it('refuses a leader who is not an active member', async () => {
      const outsider = await borrower(f, f.t1, f.b1);
      const r = await f
        .as('ro')
        .post(`/lending/applications/groups/${groupId}/leader`, {
          borrowerId: outsider.id,
        });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/active member of the group/);
    });

    it('lets a member leave a group with no live loan, with nothing to settle', async () => {
      const r = expectOk(
        await f
          .as('ro')
          .post(
            `/lending/applications/groups/${groupId}/members/${members[4]}/remove`,
            { reason: 'Moved to another village' },
          ),
      );
      expect(r.settlementAmount).toBeNull();
      const g = expectOk(await group(groupId));
      expect(g.memberCount).toBe(4);
      expect(g.loans).toEqual([]);
    });
  });

  describe('lending to a group', () => {
    let groupId: string;
    let members: string[];
    let loanId: string;

    beforeAll(async () => {
      ({ groupId, members } = await formGroup('GRP-LOAN'));
    }, 60_000);

    it('refuses a group product without a group', async () => {
      const r = await f.as('ro').post('/lending/applications', {
        borrowerId: members[0],
        productId,
        terms: {
          principal: '5000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/name the group the loan is for/);
    });

    it('refuses an individual product that names a group', async () => {
      const { productId: individual } = await activeProduct(
        f,
        'PERSONAL_INSTALMENT',
        'IND-STD',
      );
      const r = await f.as('ro').post('/lending/applications', {
        borrowerId: members[0],
        groupId,
        productId: individual,
        terms: {
          principal: '2000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/lends to an individual borrower/);
    });

    it('refuses a borrower who is not a member of the named group', async () => {
      const outsider = await borrower(f, f.t1, f.b1);
      const r = await f.as('ro').post('/lending/applications', {
        borrowerId: outsider.id,
        groupId,
        productId,
        terms: {
          principal: '5000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/must be an active member of that group/);
    });

    it('refuses a group below the product minimum', async () => {
      const small = await formGroup('GRP-SMALL', 3);
      const r = await f.as('ro').post('/lending/applications', {
        borrowerId: small.members[0],
        groupId: small.groupId,
        productId,
        terms: {
          principal: '5000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('GROUP_COMPOSITION_INVALID');
      expect(JSON.stringify(r.body.issues)).toMatch(/requires at least 5/);
    });

    it('refuses members who joined too recently', async () => {
      const fresh = await formGroup('GRP-FRESH', 5, '2026-01-01');
      const r = await f.as('ro').post('/lending/applications', {
        borrowerId: fresh.members[0],
        groupId: fresh.groupId,
        productId,
        terms: {
          principal: '5000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
      });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body.issues)).toMatch(/the product requires 30/);
    });

    it('books a group loan and binds every member to it', async () => {
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: members[0],
          groupId,
          productId,
          terms: {
            principal: '5000',
            numberOfInstalments: 12,
            disbursementDate: '2026-01-05',
          },
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
      expectOk(
        await f
          .as('analyst')
          .post(`/lending/applications/${app.id}/recommend`, {
            recommendation: 'APPROVE',
            rationale: 'Group has met for six months',
          }),
      );
      expectOk(
        await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
          rationale: 'Approved within authority',
        }),
      );
      await acceptKeyFacts(f, app.id);
      const booked = expectOk(
        await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
      );
      loanId = booked.account.id;

      const bound = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/group-members`),
      );
      expect(bound.group).toBe(true);
      expect(bound.liability).toBe('GROUP_JOINT');
      expect(bound.members).toHaveLength(5);
    });

    it('splits the principal equally, with the residual on the leader', async () => {
      const bound = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/group-members`),
      );
      const total = bound.members.reduce(
        (a: any, m: any) => a.plus(m.shareAmount),
        new lending.D(0),
      );
      expect(total.toString()).toBe('5000');
      expect(bound.members.every((m: any) => m.shareAmount === '1000')).toBe(
        true,
      );
    });

    it('makes every member liable for the whole loan, not their share', async () => {
      const bound = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/group-members`),
      );
      // This is the substance of joint liability: a member's share says what
      // they agreed to carry, never what they can be pursued for.
      expect(bound.members.every((m: any) => m.liableFor === '5000')).toBe(
        true,
      );
      expect(
        bound.members.every((m: any) => m.shareAmount !== m.liableFor),
      ).toBe(true);
    });

    it('a later membership change does not alter a loan already booked', async () => {
      const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '900' });
      expectOk(
        await f
          .as('ro')
          .post(`/lending/applications/groups/${groupId}/members`, {
            borrowerId: b.id,
            joinedOn: '2026-01-05',
          }),
      );
      const bound = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/group-members`),
      );
      // Six in the group now, but the contract still binds the original five.
      expect(expectOk(await group(groupId)).memberCount).toBe(6);
      expect(bound.members).toHaveLength(5);
    });

    it('a member cannot leave while the group owes money', async () => {
      const r = await f
        .as('ro')
        .post(
          `/lending/applications/groups/${groupId}/members/${members[1]}/remove`,
          { reason: 'Moved away' },
        );
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('MEMBER_EXIT_REFUSED');
      expect(JSON.stringify(r.body.issues)).toMatch(
        /cannot leave until it is repaid/,
      );
    });

    it('the group view names its loans and applications', async () => {
      const g = expectOk(await group(groupId));
      expect(g.loans).toHaveLength(1);
      expect(g.loans[0]).toMatchObject({
        id: loanId,
        status: expect.any(String),
        currency: expect.any(String),
      });
      expect(g.loans[0].reference).toEqual(expect.any(String));
      expect(g.applications.length).toBeGreaterThanOrEqual(1);
      expect(g.applications[0].status).toBe('BOOKED');
    });

    it('the group cannot be disbanded with a loan running', async () => {
      const r = await f
        .as('ro')
        .post(`/lending/applications/groups/${groupId}/status`, {
          status: 'DISBANDED',
        });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/still running; it cannot be disbanded/);
    });
  });

  describe('isolation and governance', () => {
    let groupId: string;

    beforeAll(async () => {
      ({ groupId } = await formGroup('GRP-ISO'));
    }, 60_000);

    it('is invisible to another tenant', async () => {
      await grant(f, f.t2, 't2ops', 'LOAN_OPS_MAKER');
      const res = await f
        .as('t2ops')
        .get(`/lending/applications/groups/${groupId}`);
      expect([403, 404]).toContain(res.status);
    });

    it('refuses group management to a user without the permission', async () => {
      expect(
        (
          await f.as('nobody').post('/lending/applications/groups', {
            code: 'GRP-NO',
            name: 'Should not exist',
            branchId: f.b1,
          })
        ).status,
      ).toBe(403);
    });

    it('records group changes in the audit trail', async () => {
      const audit = expectOk(
        await f
          .as('admin1')
          .get(
            `/lending/ops/audit?resourceType=BorrowerGroup&resourceId=${groupId}`,
          ),
      );
      const actions = audit.data.map((a: any) => a.details?.action);
      expect(actions).toContain('CREATE');
      expect(actions).toContain('ADD_MEMBER');
    });
  });

  describe('collecting a group repayment by member (UC-22)', () => {
    let loanId: string;
    let members: string[];

    beforeAll(async () => {
      let groupId: string;
      ({ groupId, members } = await formGroup('GRP-C'));
      const today = expectOk(
        await f.as('finance').get('/lending/ops/business-date'),
      ).businessDate as string;
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: members[0],
          groupId,
          productId,
          terms: {
            principal: '5000',
            numberOfInstalments: 12,
            disbursementDate: today,
          },
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
      expectOk(
        await f
          .as('analyst')
          .post(`/lending/applications/${app.id}/recommend`, {
            recommendation: 'APPROVE',
            rationale: 'Group meets weekly',
          }),
      );
      expectOk(
        await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
          rationale: 'Approved within authority',
        }),
      );
      await acceptKeyFacts(f, app.id);
      loanId = expectOk(
        await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
      ).account.id;
      const view = expectOk(
        await f.as('opsMaker').get(`/lending/applications/${app.id}`),
      );
      for (const cp of view.conditions)
        expectOk(
          await f
            .as('opsMaker')
            .post(`/lending/applications/${app.id}/conditions/${cp.code}`, {
              resolution: 'SATISFIED',
              evidence: `Evidence for ${cp.code}`,
            }),
        );
      const task = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loanId}/disbursements`, {}),
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
            { externalReference: 'GRP-C-DISB' },
            key('grpc-disb'),
          ),
      );
    }, 90_000);

    const pay = (amount: string, contributions: unknown[]) =>
      f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/repayments`,
          { amount, applyExcessAs: 'ADVANCE', contributions },
          key('grpc'),
        );

    it('records who paid what within one group repayment', async () => {
      const ev = expectOk(
        await pay('100.00', [
          { borrowerId: members[1], amount: '60.00' },
          { borrowerId: members[2], amount: '40.00' },
        ]),
      );
      const view = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/group-members`),
      );
      const paid = (id: string) =>
        view.members.find((m: any) => m.borrowerId === id).contributed;
      expect(paid(members[1])).toBe('60');
      expect(paid(members[2])).toBe('40');
      expect(paid(members[3])).toBe('0');
      expect(
        view.contributions.filter((c: any) => c.financialEventId === ev.id),
      ).toHaveLength(2);
    });

    it('refuses a split that does not add up, or names a non-member', async () => {
      const short = await pay('100.00', [
        { borrowerId: members[1], amount: '30.00' },
      ]);
      expect(short.status).toBe(400);
      const stranger = await borrower(f, f.t1, f.b1);
      const outsider = await pay('10.00', [
        { borrowerId: stranger.id, amount: '10.00' },
      ]);
      expect(outsider.status).toBe(400);
    });

    it('a reversed repayment no longer counts towards what members paid', async () => {
      const ev = expectOk(
        await pay('20.00', [{ borrowerId: members[4], amount: '20.00' }]),
      );
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/loans/${loanId}/events/${ev.id}/reverse`,
            { reason: 'Cheque bounced' },
            key('grpc-rev'),
          ),
      );
      const view = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/group-members`),
      );
      expect(
        view.members.find((m: any) => m.borrowerId === members[4]).contributed,
      ).toBe('0');
    });
  });
});
