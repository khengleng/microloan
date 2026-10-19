import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { SettingsController } from './settings.controller';
import { BotModule } from '../bot/bot.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformApprovalsModule } from '../platform-approvals/platform-approvals.module';
import { TenantPurgeService } from './tenant-purge.service';
import { DocumentStorageService } from '../lending/documents/document-storage';

@Module({
  imports: [BotModule, AuthzModule, PlatformApprovalsModule],
  providers: [TenantsService, TenantPurgeService, DocumentStorageService],
  controllers: [TenantsController, SettingsController],
})
export class TenantsModule { }
