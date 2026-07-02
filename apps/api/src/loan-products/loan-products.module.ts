import { Module } from '@nestjs/common';
import { LoanProductsService } from './loan-products.service';
import { LoanProductsController } from './loan-products.controller';
import { AuthzModule } from '../authz/authz.module';

@Module({
    imports: [AuthzModule],
    controllers: [LoanProductsController],
    providers: [LoanProductsService],
    exports: [LoanProductsService],
})
export class LoanProductsModule { }
