import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
    imports: [AuthzModule],
    providers: [LedgerService],
    controllers: [LedgerController],
    exports: [LedgerService],
})
export class LedgerModule { }
