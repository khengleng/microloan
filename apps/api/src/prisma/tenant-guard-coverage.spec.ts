import { Prisma } from '@microloan/db';
import { isClassifiedModel } from './tenant-guard';

/**
 * A model the tenant guard does not know about is waved straight through it.
 * This fails the build the moment a tenant-owned model is added without being
 * classified, instead of leaking silently.
 */
describe('tenant guard coverage', () => {
  const models = Prisma.dmmf.datamodel.models;

  it('classifies every model that carries a tenantId', () => {
    const unclassified = models
      .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
      .map((m) => m.name)
      .filter((name) => !isClassifiedModel(name));
    expect(unclassified).toEqual([]);
  });

  it('classifies every lending model', () => {
    const lending = ['LoanAccount', 'FinancialEvent', 'LendingJournalLine', 'RestructureCase', 'RolePermission', 'Holiday', 'FeatureFlag', 'PlatformFlagRule', 'LoanFamily', 'ProductTemplate', 'AccessPermission'];
    expect(lending.filter((m) => !isClassifiedModel(m))).toEqual([]);
  });
});
