import { auditLogWhere } from './audit.controller';

describe('auditLogWhere', () => {
  it('scopes to the tenant, matches action on any part and entity exactly, ignoring case', () => {
    const w = auditLogWhere({ tenantId: 't1' }, { action: 'login', entity: 'loan' });
    expect(w.tenantId).toBe('t1');
    expect(w.action).toEqual({ contains: 'login', mode: 'insensitive' });
    expect(w.entity).toEqual({ equals: 'loan', mode: 'insensitive' });
  });

  it('a date-only "to" includes the whole of that day', () => {
    const w = auditLogWhere({ tenantId: 't1' }, { from: '2026-10-01', to: '2026-10-18' });
    expect(w.createdAt.gte).toEqual(new Date('2026-10-01'));
    expect(w.createdAt.lt).toEqual(new Date('2026-10-19'));
    expect(w.createdAt.lte).toBeUndefined();
  });

  it('a full timestamp "to" is used as given', () => {
    const w = auditLogWhere({ tenantId: 't1' }, { to: '2026-10-18T12:00:00.000Z' });
    expect(w.createdAt.lte).toEqual(new Date('2026-10-18T12:00:00.000Z'));
  });

  it('search runs on the server across action, entity, record id and user email', () => {
    const w = auditLogWhere({ tenantId: 't1' }, { search: ' abc ' });
    expect(w.OR).toHaveLength(4);
    expect(w.OR[3]).toEqual({ user: { email: { contains: 'abc', mode: 'insensitive' } } });
  });

  it('ignores blank and invalid filters', () => {
    const w = auditLogWhere({ tenantId: null as any }, { action: '  ', from: 'nonsense' });
    expect(w).toEqual({});
  });
});
