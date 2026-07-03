/**
 * One-off, idempotent backfill: encrypt existing plaintext sensitive fields.
 * Safe to re-run (already-encrypted values are skipped).
 *
 * Run with the SAME FIELD_ENCRYPTION_KEY the app uses, e.g. on Railway:
 *   railway run -- pnpm encrypt:backfill
 */
import { PrismaClient } from '@microloan/db';
import { encryptField, isEncrypted, blindIndex } from '../common/field-crypto';

async function main() {
  // Bare client (no PrismaService middleware) so we read/write raw values.
  const prisma = new PrismaClient();
  let users = 0;
  let tenants = 0;
  let kyc = 0;
  let borrowers = 0;
  let conflicts = 0;

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

  // Borrower PII: encrypt idNumber/phone/email/address and populate the blind
  // index hash columns used for lookup / uniqueness.
  const borrowerRows = await prisma.borrower.findMany({
    select: { id: true, idNumber: true, phone: true, email: true, address: true },
  });
  for (const b of borrowerRows) {
    const data: Record<string, any> = {};
    if (b.idNumber && !isEncrypted(b.idNumber)) {
      data.idNumberHash = blindIndex(b.idNumber, 'id');
      data.idNumber = encryptField(b.idNumber);
    }
    if (b.phone && !isEncrypted(b.phone)) {
      data.phoneHash = blindIndex(b.phone, 'phone');
      data.phone = encryptField(b.phone);
    }
    if (b.email && !isEncrypted(b.email)) data.email = encryptField(b.email);
    if (b.address && !isEncrypted(b.address)) data.address = encryptField(b.address);
    if (Object.keys(data).length === 0) continue;
    try {
      await prisma.borrower.update({ where: { id: b.id }, data });
      borrowers++;
    } catch (err: any) {
      // Duplicate national ID within a tenant now violates the per-tenant unique.
      conflicts++;
      // eslint-disable-next-line no-console
      console.warn(`[encrypt-backfill] borrower ${b.id} skipped: ${err?.message || err}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[encrypt-backfill] encrypted users=${users} tenants=${tenants} kycDocuments=${kyc} borrowers=${borrowers} conflicts=${conflicts}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
