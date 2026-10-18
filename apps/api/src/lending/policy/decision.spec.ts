import { ACTION_BY_CODE } from './actions';
import { decide, DecisionInput, Grant, Resource, Subject } from './decision';
import { evaluateFlag, FlagSnapshot, TenantRule, PlatformRule } from './flags';
import { FLAG_DEFINITIONS } from './catalogue';
import { CompiledPolicy, policyRulesSchema } from './abac';

const NOW = new Date('2026-10-16T09:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');

const grant = (permission: string, over: Partial<Grant> = {}): Grant => ({
  permission,
  source: 'ROLE',
  roleCode: 'TEST_ROLE',
  allBranches: false,
  branchIds: ['B1'],
  portfolioIds: [],
  legalEntityIds: [],
  ...over,
});

const subject = (over: Partial<Subject> = {}): Subject => ({
  id: 'u-approver',
  type: 'USER',
  tenantId: 'T1',
  active: true,
  branchId: 'B1',
  roles: ['CREDIT_APPROVER'],
  grants: [
    grant('credit_decision.approve'),
    grant('loan.repayment.post'),
    grant('loan.disbursement.prepare'),
    grant('loan.read'),
  ],
  authorities: [
    {
      permission: 'credit_decision.approve',
      currency: 'USD',
      maxAmount: '50000',
      source: 'role CREDIT_APPROVER',
    },
  ],
  assurance: 'MFA',
  cohorts: [],
  ...over,
});

const application = (over: Partial<Resource> = {}): Resource => ({
  type: 'APPLICATION',
  id: 'app-1',
  tenantId: 'T1',
  branchId: 'B1',
  productCode: 'PL01',
  familyCode: 'PERSONAL',
  productStatus: 'ACTIVE',
  productConfigValid: true,
  amount: '10000',
  currency: 'USD',
  workflowState: 'RECOMMENDED',
  makerIds: ['u-officer', 'u-analyst'],
  ...over,
});

const loanAccount = (over: Partial<Resource> = {}): Resource => ({
  type: 'LOAN_ACCOUNT',
  id: 'loan-1',
  tenantId: 'T1',
  branchId: 'B1',
  productCode: 'PL01',
  familyCode: 'PERSONAL',
  productStatus: 'ACTIVE',
  productConfigValid: true,
  amount: '10000',
  currency: 'USD',
  workflowState: 'ACTIVE',
  makerIds: [],
  ...over,
});

const catalogue = new Map(FLAG_DEFINITIONS.map((f) => [f.key, f]));
const snapshot = (
  tenantRules: Partial<TenantRule>[] = [],
  platformRules: Partial<PlatformRule>[] = [],
): FlagSnapshot => ({
  catalogue,
  tenantRules: tenantRules.map((r, i) => ({
    id: `tr${i}`,
    flagKey: '',
    scopeType: 'TENANT',
    scopeValue: null,
    enabled: true,
    emergency: false,
    priority: 100,
    status: 'ACTIVE',
    effectiveFrom: PAST,
    effectiveTo: null,
    ...r,
  })),
  platformRules: platformRules.map((r, i) => ({
    id: `pr${i}`,
    flagKey: '',
    enabled: true,
    emergency: false,
    status: 'ACTIVE',
    effectiveFrom: PAST,
    effectiveTo: null,
    ...r,
  })),
});

const input = (
  action: string,
  over: Partial<DecisionInput> = {},
): DecisionInput => ({
  action: ACTION_BY_CODE[action],
  subject: subject(),
  resource: application(),
  environment: {
    now: NOW,
    channel: 'STAFF_PORTAL',
    assurance: 'MFA',
    emergencyAccess: false,
  },
  flags: snapshot(),
  policies: [],
  fx: () => null,
  ...over,
});

const failed = (d: ReturnType<typeof decide>) =>
  d.checks.filter((c) => !c.passed).map((c) => c.code);

describe('lending decision engine', () => {
  it('allows an in-scope approver within authority on a recommended application', () => {
    const d = decide(input('credit_decision.approve'));
    expect(failed(d)).toEqual([]);
    expect(d.allowed).toBe(true);
  });

  it('denies cross-tenant access even with every permission', () => {
    const d = decide(
      input('credit_decision.approve', {
        resource: application({ tenantId: 'T2' }),
      }),
    );
    expect(d.allowed).toBe(false);
    expect(failed(d)).toContain('SAME_TENANT');
  });

  it('denies when the resource tenant is missing (missing attribute never allows)', () => {
    const d = decide(
      input('loan.read', { resource: loanAccount({ tenantId: null }) }),
    );
    expect(d.allowed).toBe(false);
  });

  it('a role alone cannot bypass ABAC: branch scope', () => {
    const d = decide(
      input('credit_decision.approve', {
        resource: application({ branchId: 'B9' }),
      }),
    );
    expect(failed(d)).toEqual(['SCOPE']);
  });

  it('portfolio scope grants access to a portfolio outside the home branch', () => {
    const s = subject({
      grants: [
        grant('credit_decision.approve', {
          branchIds: [],
          portfolioIds: ['P7'],
        }),
      ],
    });
    expect(
      decide(
        input('credit_decision.approve', {
          subject: s,
          resource: application({ branchId: 'B9', portfolioId: 'P7' }),
        }),
      ).allowed,
    ).toBe(true);
  });

  it('legal-entity restriction on a grant is enforced', () => {
    const s = subject({
      grants: [
        grant('credit_decision.approve', {
          allBranches: true,
          legalEntityIds: ['LE1'],
        }),
      ],
    });
    expect(
      decide(
        input('credit_decision.approve', {
          subject: s,
          resource: application({ legalEntityId: 'LE2' }),
        }),
      ).allowed,
    ).toBe(false);
    expect(
      decide(
        input('credit_decision.approve', {
          subject: s,
          resource: application({ legalEntityId: 'LE1' }),
        }),
      ).allowed,
    ).toBe(true);
  });

  it('maker cannot approve their own application', () => {
    const d = decide(
      input('credit_decision.approve', {
        subject: subject({ id: 'u-analyst' }),
      }),
    );
    expect(failed(d)).toEqual(['MAKER_CHECKER']);
  });

  it('enabled flags cannot grant a missing permission', () => {
    const s = subject({ grants: [grant('loan.read')] });
    const d = decide(
      input('credit_decision.approve', {
        subject: s,
        flags: snapshot([{ flagKey: 'lending.origination', enabled: true }]),
      }),
    );
    expect(d.allowed).toBe(false);
    expect(failed(d)).toContain('PERMISSION');
  });

  it('approval threshold is enforced in the same currency', () => {
    const d = decide(
      input('credit_decision.approve', {
        resource: application({ amount: '50000.01' }),
      }),
    );
    expect(failed(d)).toEqual(['APPROVAL_AUTHORITY']);
    expect(
      decide(
        input('credit_decision.approve', {
          resource: application({ amount: '50000' }),
        }),
      ).allowed,
    ).toBe(true);
  });

  it('cross-currency approval needs a recorded, fresh FX rate — otherwise deny', () => {
    const khr = application({ amount: '40000000', currency: 'KHR' });
    expect(
      decide(input('credit_decision.approve', { resource: khr })).allowed,
    ).toBe(false);
    const fresh = () => ({
      rate: '0.000245',
      asOf: new Date('2026-10-15T00:00:00Z'),
      source: 'NBC',
    });
    // 40,000,000 KHR × 0.000245 = 9,800 USD ≤ 50,000
    expect(
      decide(input('credit_decision.approve', { resource: khr, fx: fresh }))
        .allowed,
    ).toBe(true);
    const stale = () => ({
      rate: '0.000245',
      asOf: new Date('2026-09-01T00:00:00Z'),
      source: 'NBC',
    });
    const d = decide(
      input('credit_decision.approve', { resource: khr, fx: stale }),
    );
    expect(failed(d)).toEqual(['APPROVAL_AUTHORITY']);
    expect(d.denial?.detail).toMatch(/stale/);
    // The denial names the stale rate, not a generic "exceeds" message.
    expect(d.denial?.message).toMatch(/older than 3 days/);
    expect(d.denial?.message).toMatch(/KHR→USD \(2026-09-01\)/);
    expect(d.denial?.message).not.toMatch(/exceeds/);
    const none = decide(input('credit_decision.approve', { resource: khr }));
    expect(none.denial?.message).toMatch(
      /no exchange rate is recorded for KHR→USD/,
    );
    // When a fresh rate converts the amount above the limit, it still says "exceeds".
    const big = application({ amount: '400000000', currency: 'KHR' });
    expect(
      decide(input('credit_decision.approve', { resource: big, fx: fresh }))
        .denial?.message,
    ).toBe('The amount exceeds your approval authority');
  });

  it('family-restricted authority does not cover other families', () => {
    const s = subject({
      authorities: [
        {
          permission: 'credit_decision.approve',
          currency: 'USD',
          maxAmount: '1000000',
          familyCode: 'PROPERTY',
          source: 'x',
        },
      ],
    });
    expect(
      decide(input('credit_decision.approve', { subject: s })).allowed,
    ).toBe(false);
  });

  it('approval requires multi-factor sign-in', () => {
    const d = decide(
      input('credit_decision.approve', {
        environment: {
          now: NOW,
          channel: 'STAFF_PORTAL',
          assurance: 'SINGLE_FACTOR',
          emergencyAccess: false,
        },
      }),
    );
    expect(failed(d)).toEqual(['ASSURANCE']);
  });

  it('platform administrators cannot read tenant borrower data or approve transactions', () => {
    const platform = subject({
      id: 'root',
      type: 'PLATFORM',
      tenantId: null,
      grants: [
        grant('credit_decision.approve', { allBranches: true }),
        grant('loan.read', { allBranches: true }),
      ],
    });
    expect(
      decide(input('credit_decision.approve', { subject: platform })).allowed,
    ).toBe(false);
    expect(
      failed(
        decide(
          input('loan.read', { subject: platform, resource: loanAccount() }),
        ),
      ),
    ).toContain('PLATFORM_SCOPE');
  });

  it('workflow state is enforced (cannot approve before recommendation)', () => {
    const d = decide(
      input('credit_decision.approve', {
        resource: application({ workflowState: 'SUBMITTED' }),
      }),
    );
    expect(failed(d)).toEqual(['STATE']);
  });

  it('retired product blocks new business but not servicing of booked loans', () => {
    const retired = { productStatus: 'RETIRED' };
    expect(
      failed(
        decide(
          input('credit_decision.approve', { resource: application(retired) }),
        ),
      ),
    ).toEqual(['ACTIVE_PRODUCT']);
    expect(
      decide(input('loan.repayment.post', { resource: loanAccount(retired) }))
        .allowed,
    ).toBe(true);
  });

  it('origination-off preserves authorized servicing; disbursement is blocked', () => {
    const off = snapshot([{ flagKey: 'lending.origination', enabled: false }]);
    expect(
      decide(
        input('loan.repayment.post', { resource: loanAccount(), flags: off }),
      ).allowed,
    ).toBe(true);
    const d = decide(
      input('loan.disbursement.prepare', {
        resource: loanAccount({ workflowState: 'BOOKED' }),
        flags: off,
      }),
    );
    expect(failed(d)).toEqual(['FLAG:lending.origination']);
  });

  it('accounting posting off fails every money movement closed', () => {
    const off = snapshot([
      { flagKey: 'lending.accounting.posting', enabled: false },
    ]);
    expect(
      failed(
        decide(
          input('loan.repayment.post', { resource: loanAccount(), flags: off }),
        ),
      ),
    ).toEqual(['FLAG:lending.accounting.posting']);
  });

  it('a family flag off blocks origination in that family only', () => {
    const off = snapshot([
      { flagKey: 'lending.family.agriculture.enabled', enabled: false },
    ]);
    expect(
      decide(input('credit_decision.approve', { flags: off })).allowed,
    ).toBe(true);
    expect(
      decide(
        input('credit_decision.approve', {
          flags: off,
          resource: application({ familyCode: 'AGRICULTURE' }),
        }),
      ).allowed,
    ).toBe(false);
  });

  it('product configuration flags apply (balloon schedules)', () => {
    const off = snapshot([
      { flagKey: 'lending.repayment.balloon', enabled: false },
    ]);
    expect(
      failed(
        decide(
          input('credit_decision.approve', {
            flags: off,
            resource: application({
              requiredFlags: ['lending.repayment.balloon'],
            }),
          }),
        ),
      ),
    ).toEqual(['FLAG:lending.repayment.balloon']);
  });

  describe('tenant ABAC policies', () => {
    const policy = (rules: unknown): CompiledPolicy[] => [
      { code: 'P1', version: 1, rules: policyRulesSchema.parse(rules) },
    ];

    it('DENY rule restricts an otherwise permitted action', () => {
      const p = policy([
        {
          id: 'big-loans-hq',
          effect: 'DENY',
          actions: ['credit_decision.approve'],
          condition: {
            all: [
              { attr: 'resource.amount', op: 'gt', value: 20000 },
              { attr: 'subject.branchId', op: 'neq', value: 'HQ' },
            ],
          },
          message: 'Large approvals are made at head office',
        },
      ]);
      expect(
        decide(input('credit_decision.approve', { policies: p })).allowed,
      ).toBe(true);
      const d = decide(
        input('credit_decision.approve', {
          policies: p,
          resource: application({ amount: '30000' }),
        }),
      );
      expect(d.allowed).toBe(false);
      expect(d.denial?.message).toBe('Large approvals are made at head office');
    });

    it('REQUIRE rule fails closed when its attribute is missing', () => {
      const p = policy([
        {
          id: 'risk-rated',
          effect: 'REQUIRE',
          actions: ['credit_decision.*'],
          condition: {
            attr: 'resource.riskCategory',
            op: 'in',
            value: ['LOW', 'MEDIUM'],
          },
          message: 'A risk category is required',
        },
      ]);
      expect(
        decide(input('credit_decision.approve', { policies: p })).allowed,
      ).toBe(false);
      expect(
        decide(
          input('credit_decision.approve', {
            policies: p,
            resource: application({ riskCategory: 'LOW' }),
          }),
        ).allowed,
      ).toBe(true);
    });

    it('DENY rule over a missing attribute denies (unknown never allows)', () => {
      const p = policy([
        {
          id: 'no-high',
          effect: 'DENY',
          actions: ['credit_decision.approve'],
          condition: { attr: 'resource.riskCategory', op: 'eq', value: 'HIGH' },
          message: 'High risk cannot be approved here',
        },
      ]);
      expect(
        decide(input('credit_decision.approve', { policies: p })).allowed,
      ).toBe(false);
    });

    it('the constrained schema rejects unknown attributes and code', () => {
      expect(() =>
        policyRulesSchema.parse([
          {
            id: 'x1',
            effect: 'DENY',
            actions: ['loan.read'],
            condition: { attr: 'resource.__proto__', op: 'eq', value: 1 },
            message: 'nope',
          },
        ]),
      ).toThrow();
      expect(() =>
        policyRulesSchema.parse([
          {
            id: 'x2',
            effect: 'ALLOW',
            actions: ['loan.read'],
            condition: { attr: 'resource.amount', op: 'gt', value: 1 },
            message: 'grant',
          },
        ]),
      ).toThrow();
      expect(() =>
        policyRulesSchema.parse([
          {
            id: 'x3',
            effect: 'DENY',
            actions: ['loan.read'],
            condition: { attr: 'resource.amount', op: 'gt', value: 1 },
            message: 'm',
            script: 'x',
          },
        ]),
      ).toThrow();
    });
  });

  it('explanations list every blocking layer', () => {
    const d = decide(
      input('credit_decision.approve', {
        subject: subject({ id: 'u-officer', grants: [] }),
        resource: application({ workflowState: 'DRAFT' }),
      }),
    );
    expect(d.checks.filter((c) => !c.passed).map((c) => c.layer)).toEqual(
      expect.arrayContaining(['RBAC', 'ABAC', 'WORKFLOW']),
    );
  });
});

describe('feature flag precedence', () => {
  const ctx = {
    productCode: 'MORTGAGE01',
    branchId: 'B1',
    channel: 'STAFF_PORTAL',
    segment: 'SALARIED',
    cohorts: ['PILOT_A'],
  };

  it('unknown flags fail closed', () => {
    expect(evaluateFlag('lending.nonexistent', ctx, snapshot()).enabled).toBe(
      false,
    );
  });

  it('the most specific tenant rule wins', () => {
    const s = snapshot([
      { flagKey: 'lending.origination', scopeType: 'TENANT', enabled: false },
      {
        flagKey: 'lending.origination',
        scopeType: 'COHORT',
        scopeValue: 'PILOT_A',
        enabled: true,
      },
    ]);
    expect(evaluateFlag('lending.origination', ctx, s)).toMatchObject({
      enabled: true,
      source: 'TENANT_RULE',
      scope: 'COHORT:PILOT_A',
    });
    expect(
      evaluateFlag('lending.origination', { ...ctx, cohorts: [] }, s).enabled,
    ).toBe(false);
  });

  it('platform emergency-off overrides every tenant rule', () => {
    const s = snapshot(
      [
        {
          flagKey: 'lending.origination',
          scopeType: 'COHORT',
          scopeValue: 'PILOT_A',
          enabled: true,
        },
      ],
      [{ flagKey: 'lending.origination', enabled: false, emergency: true }],
    );
    expect(evaluateFlag('lending.origination', ctx, s)).toMatchObject({
      enabled: false,
      source: 'PLATFORM_EMERGENCY',
    });
  });

  it('tenant emergency-off cannot be overridden by a narrower tenant rule', () => {
    const s = snapshot([
      {
        flagKey: 'lending.origination',
        scopeType: 'TENANT',
        enabled: false,
        emergency: true,
      },
      {
        flagKey: 'lending.origination',
        scopeType: 'PRODUCT',
        scopeValue: 'MORTGAGE01',
        enabled: true,
      },
    ]);
    expect(evaluateFlag('lending.origination', ctx, s).source).toBe(
      'TENANT_EMERGENCY',
    );
  });

  it('pending and expired rules are ignored; evaluation is deterministic', () => {
    const s = snapshot([
      {
        flagKey: 'lending.restructure.principal_forgiveness',
        enabled: true,
        status: 'PENDING_APPROVAL',
      },
      {
        flagKey: 'lending.restructure.principal_forgiveness',
        enabled: true,
        effectiveTo: new Date('2026-02-01T00:00:00Z'),
      },
    ]);
    const a = evaluateFlag(
      'lending.restructure.principal_forgiveness',
      ctx,
      s,
      NOW,
    );
    expect(a).toMatchObject({ enabled: false, source: 'DEFAULT' });
    for (let i = 0; i < 20; i++)
      expect(
        evaluateFlag('lending.restructure.principal_forgiveness', ctx, s, NOW),
      ).toEqual(a);
  });

  it('same-scope ties break by priority', () => {
    const s = snapshot([
      {
        id: 'a',
        flagKey: 'lending.origination',
        scopeType: 'BRANCH',
        scopeValue: 'B1',
        enabled: false,
        priority: 50,
      },
      {
        id: 'b',
        flagKey: 'lending.origination',
        scopeType: 'BRANCH',
        scopeValue: 'B1',
        enabled: true,
        priority: 10,
      },
    ]);
    expect(evaluateFlag('lending.origination', ctx, s)).toMatchObject({
      enabled: true,
      ruleId: 'b',
    });
  });
});
