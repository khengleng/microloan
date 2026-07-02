import { Module } from '@nestjs/common';
import { CreditBureauService } from './credit-bureau.service';
import { CreditBureauController } from './credit-bureau.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
    imports: [AuthzModule],
    providers: [CreditBureauService],
    controllers: [CreditBureauController],
    exports: [CreditBureauService],
})
export class CreditBureauModule { }
