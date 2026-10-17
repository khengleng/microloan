-- Platform events (SUPERADMIN actions, logins that match no account) have no
-- tenant. They were written with tenantId='system', which violates the foreign
-- key, so the insert failed and the event was silently dropped.
ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" DROP NOT NULL;
