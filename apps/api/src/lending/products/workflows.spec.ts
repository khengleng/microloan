import {
  BUILT_IN_WORKFLOWS,
  WorkflowDefinition,
  WorkflowsService,
  draftIssues,
} from './workflows.service';

const steps = BUILT_IN_WORKFLOWS.STANDARD_RETAIL.definition.steps;
const def = (
  approvalLevels: WorkflowDefinition['approvalLevels'],
  s: WorkflowDefinition['steps'] = steps,
): WorkflowDefinition => ({ steps: s, approvalLevels });

describe('workflow definitions', () => {
  it('the built-in workflows meet the rules for new versions', () => {
    for (const b of Object.values(BUILT_IN_WORKFLOWS))
      expect(draftIssues(b.definition)).toEqual([]);
  });

  it('a level for every currency above zero is refused instead of silently ignored', () => {
    const d = def([
      { currency: '*', minAmount: '0', approvalsRequired: 1 },
      { currency: '*', minAmount: '50000', approvalsRequired: 2 },
    ]);
    expect(draftIssues(d)).toEqual([
      expect.stringMatching(/approvalLevels\.1: a level for every currency/),
    ]);
  });

  it('a currency threshold is honoured', () => {
    const d = def([
      { currency: '*', minAmount: '0', approvalsRequired: 1 },
      { currency: 'USD', minAmount: '50000', approvalsRequired: 2 },
    ]);
    expect(draftIssues(d)).toEqual([]);
    expect(WorkflowsService.approvalsRequired(d, '49999.99', 'USD')).toBe(1);
    expect(WorkflowsService.approvalsRequired(d, '50000', 'USD')).toBe(2);
    expect(WorkflowsService.approvalsRequired(d, '50000', 'KHR')).toBe(1);
  });

  it('unknown currencies are refused', () => {
    expect(
      draftIssues(
        def([
          { currency: '*', minAmount: '0', approvalsRequired: 1 },
          { currency: 'XYZ', minAmount: '10', approvalsRequired: 2 },
        ]),
      ),
    ).toEqual([expect.stringMatching(/unknown currency XYZ/)]);
  });

  it('conditions precedent cannot be switched off', () => {
    expect(
      draftIssues(
        def(
          [{ currency: '*', minAmount: '0', approvalsRequired: 1 }],
          steps.filter((s) => s !== 'CONDITIONS_PRECEDENT'),
        ),
      ),
    ).toEqual([
      expect.stringMatching(/CONDITIONS_PRECEDENT cannot be removed/),
    ]);
  });
});
