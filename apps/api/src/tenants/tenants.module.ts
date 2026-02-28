import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { SettingsController } from './settings.controller';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [BotModule],
  providers: [TenantsService],
  controllers: [TenantsController, SettingsController],
})
export class TenantsModule { }
