-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "telegramBotTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_telegramBotTokenHash_key" ON "Tenant"("telegramBotTokenHash");
