import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem } from '../prisma/tenant-context';
import { FLAG_DEFINITIONS, PERMISSIONS } from './policy/catalogue';

/**
 * Synchronises the platform catalogue (loan families, product templates,
 * permissions, feature-flag definitions) from code on every boot.
 *
 * The catalogue describes what this build can do, so it must match the code
 * that is running. Flag definitions are upserted without touching their
 * rules; an operator's flag rules and every tenant's data are left alone.
 * Defaults on existing flags are not overwritten, so an operator's choice
 * survives a deploy.
 */
@Injectable()
export class CatalogueSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogueSyncService.name);
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.LENDING_CATALOGUE_SYNC === 'false') return;
    try {
      await this.sync();
    } catch (e) {
      // The API still starts; lending actions then fail closed on the missing catalogue.
      this.logger.error(
        `Lending catalogue sync failed: ${(e as Error).message}`,
      );
    }
  }

  async sync(): Promise<void> {
    await runAsSystem('lending catalogue sync', async () => {
      for (const [i, f] of lending.LOAN_FAMILY_DEFINITIONS.entries()) {
        await this.prisma.loanFamily.upsert({
          where: { code: f.code },
          create: {
            code: f.code,
            name: f.name,
            description: f.description,
            sortOrder: i,
          },
          update: { name: f.name, description: f.description, sortOrder: i },
        });
      }
      for (const t of lending.PRODUCT_TEMPLATES) {
        const data = {
          familyCode: t.familyCode,
          name: t.name,
          description: t.description,
          defaultConfig: t.defaultConfig as unknown as Prisma.InputJsonValue,
          extraCapabilities: t.extraCapabilities,
          phase1Slice: t.phase1Slice,
        };
        await this.prisma.productTemplate.upsert({
          where: { code: t.code },
          create: { code: t.code, ...data },
          update: data,
        });
      }
      for (const p of PERMISSIONS) {
        const data = {
          description: p.description,
          category: p.category,
          financial: !!p.financial,
          platformAllowed: !!p.platformAllowed,
        };
        await this.prisma.accessPermission.upsert({
          where: { code: p.code },
          create: { code: p.code, ...data },
          update: data,
        });
      }
      for (const f of FLAG_DEFINITIONS) {
        await this.prisma.featureFlag.upsert({
          where: { key: f.key },
          create: {
            key: f.key,
            description: f.description,
            category: f.category,
            sensitive: f.sensitive,
            defaultEnabled: f.defaultEnabled,
          },
          update: {
            description: f.description,
            category: f.category,
            sensitive: f.sensitive,
          },
        });
      }
    });
    this.logger.log(
      `Lending catalogue synchronised (${lending.PRODUCT_TEMPLATES.length} templates, ${PERMISSIONS.length} permissions, ${FLAG_DEFINITIONS.length} flags).`,
    );
  }
}
