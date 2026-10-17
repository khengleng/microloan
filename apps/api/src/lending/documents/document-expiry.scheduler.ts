import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { CustomerDocumentsService } from './customer-documents.service';

/** Arbitrary, fixed key for the cross-instance advisory lock. */
const EXPIRY_LOCK_KEY = 7_264_190_412;

/**
 * Daily document expiry pass (DOC-6): flags expired documents and raises
 * reminder notices (outbox `document.expiry_reminder`) ahead of expiry, for
 * every tenant as of its own business date.
 *
 * - Schedule: DOCUMENT_EXPIRY_CRON (default 00:45, after end of day) in
 *   LENDING_EOD_TZ. DOCUMENT_EXPIRY_DISABLED=true turns it off.
 * - Reminder lead time: DOCUMENT_EXPIRY_REMINDER_DAYS (default 30).
 * - One instance runs it (advisory lock). Staff can also run it for their
 *   tenant: POST /lending/document-expiries/run.
 */
@Injectable()
export class DocumentExpiryScheduler {
  private readonly logger = new Logger(DocumentExpiryScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docs: CustomerDocumentsService,
  ) {}

  @Cron(process.env.DOCUMENT_EXPIRY_CRON || '45 0 * * *', {
    name: 'document-expiry',
    timeZone: process.env.LENDING_EOD_TZ || 'Asia/Phnom_Penh',
  })
  async scheduled(): Promise<void> {
    if (process.env.DOCUMENT_EXPIRY_DISABLED === 'true') return;
    if (process.env.NODE_ENV === 'test') return;
    try {
      await runAsSystem('document expiry', () =>
        this.prisma.$transaction(
          async (tx) => {
            const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
              SELECT pg_try_advisory_xact_lock(${EXPIRY_LOCK_KEY}::bigint) AS locked`;
            if (!locked) return;
            const results = await this.docs.runExpiryAllTenants();
            const flagged = results.reduce((n, r) => n + r.expired, 0);
            const reminded = results.reduce((n, r) => n + r.reminded, 0);
            if (flagged || reminded)
              this.logger.log(
                `Document expiry: ${flagged} expired, ${reminded} reminders across ${results.length} tenant(s)`,
              );
          },
          { timeout: 60 * 60_000, maxWait: 30_000 },
        ),
      );
    } catch (e) {
      this.logger.error(`Document expiry run failed: ${(e as Error).message}`);
    }
  }
}
