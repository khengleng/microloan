import { Module } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { KpiController } from './kpi.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [AuthzModule],
  providers: [KpiService],
  controllers: [KpiController],
})
export class KpiModule {}
