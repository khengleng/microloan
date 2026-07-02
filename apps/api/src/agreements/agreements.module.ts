import { Module } from '@nestjs/common';
import { AgreementsService } from './agreements.service';
import { AgreementsController } from './agreements.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [AuthzModule],
  providers: [AgreementsService],
  controllers: [AgreementsController],
  exports: [AgreementsService],
})
export class AgreementsModule {}
