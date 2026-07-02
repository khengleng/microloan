import { Module } from '@nestjs/common';
import { PaymentInstrumentsService } from './payment-instruments.service';
import { PaymentInstrumentsController } from './payment-instruments.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [AuthzModule],
  providers: [PaymentInstrumentsService],
  controllers: [PaymentInstrumentsController],
  exports: [PaymentInstrumentsService],
})
export class PaymentInstrumentsModule {}
