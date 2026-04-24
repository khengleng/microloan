import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { SettingsController } from './settings.controller';
import { BotModule } from '../bot/bot.module';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [BotModule, AuthzModule],
  providers: [TenantsService],
  controllers: [TenantsController, SettingsController],
})
export class TenantsModule { }
