/**
 * One-off, idempotent backfill: encrypt existing plaintext sensitive fields.
 * Safe to re-run (already-encrypted values are skipped).
 *
 * Run with the SAME FIELD_ENCRYPTION_KEY the app uses, e.g. on Railway:
 *   railway run -- pnpm encrypt:backfill
 */
import { PrismaClient } from '@microloan/db';
import { encryptField, isEncrypted } from '../common/field-crypto';

async function main() {
  const prisma = new PrismaClient();
  let users = 0;
  let tenants = 0;
  let kyc = 0;

  const userRows = await prisma.user.findMany({
    where: { twoFactorSecret: { not: null } },
    select: { id: true, twoFactorSecret: true },
  });
  for (const u of userRows) {
    if (!isEncrypted(u.twoFactorSecret)) {
      await prisma.user.update({ where: { id: u.id }, data: { twoFactorSecret: encryptField(u.twoFactorSecret) } });
      users++;
    }
  }

  const tenantRows = await prisma.tenant.findMany({
    where: { telegramBotToken: { not: null } },
    select: { id: true, telegramBotToken: true },
  });
  for (const t of tenantRows) {
    if (!isEncrypted(t.telegramBotToken)) {
      await prisma.tenant.update({ where: { id: t.id }, data: { telegramBotToken: encryptField(t.telegramBotToken) } });
      tenants++;
    }
  }

  const docRows = await prisma.kycDocument.findMany({ select: { id: true, content: true } });
  for (const d of docRows) {
    if (!isEncrypted(d.content)) {
      await prisma.kycDocument.update({ where: { id: d.id }, data: { content: encryptField(d.content) as string } });
      kyc++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[encrypt-backfill] encrypted users=${users} tenants=${tenants} kycDocuments=${kyc}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
