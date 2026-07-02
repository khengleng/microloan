import { Module } from '@nestjs/common';
import { ProvisioningService } from './provisioning.service';
import { ProvisioningController } from './provisioning.controller';
import { AuthzModule } from '../authz/authz.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
    imports: [AuthzModule, LedgerModule],
    providers: [ProvisioningService],
    controllers: [ProvisioningController],
    exports: [ProvisioningService],
})
export class ProvisioningModule { }
