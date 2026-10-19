import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { AmlScreeningService } from './aml-screening.service';

/**
 * Works queued AML re-screens (DECISIONS D-119): after a watch-list version
 * is activated every customer is screened again, in batches, by whichever
 * instance holds the job's lease (ScheduledJobClaim "aml.rescreen"). The
 * queue and progress live in AmlRescreenJob, never in the process.
 *
 * - Schedule: AML_RESCREEN_CRON (default every five minutes) in
 *   LENDING_EOD_TZ. AML_RESCREEN_DISABLED=true turns it off.
 * - Staff can run a tenant's queue at once: POST /lending/aml/rescreen-jobs/run.
 */
@Injectable()
export class AmlRescreenScheduler {
  private readonly logger = new Logger(AmlRescreenScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly screening: AmlScreeningService,
  ) {}

  @Cron(process.env.AML_RESCREEN_CRON || '*/5 * * * *', {
    name: 'aml-rescreen',
    timeZone: process.env.LENDING_EOD_TZ || 'Asia/Phnom_Penh',
  })
  async scheduled(): Promise<void> {
    if (process.env.AML_RESCREEN_DISABLED === 'true') return;
    if (process.env.NODE_ENV === 'test') return;
    try {
      const tenants = await runAsSystem('aml re-screen queue', () =>
        this.prisma.amlRescreenJob.findMany({
          where: { status: { in: ['PENDING', 'RUNNING'] } },
          distinct: ['tenantId'],
          select: { tenantId: true },
        }),
      );
      for (const { tenantId } of tenants) {
        const result = await this.screening.processPending(tenantId);
        for (const j of result.jobs)
          this.logger.log(
            `AML re-screen ${j.id}: ${j.status}, ${j.screened} screened, ${j.casesOpened} case(s) opened`,
          );
      }
    } catch (e) {
      this.logger.error(`AML re-screen run failed: ${(e as Error).message}`);
    }
  }
}
