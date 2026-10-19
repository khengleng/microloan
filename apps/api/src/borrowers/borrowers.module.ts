import { Module } from '@nestjs/common';
import { BorrowersService } from './borrowers.service';
import { BorrowersController } from './borrowers.controller';
import { AuthzModule } from '../authz/authz.module';
import { LendingModule } from '../lending/lending.module';

@Module({
  imports: [AuthzModule, LendingModule],
  providers: [BorrowersService],
  controllers: [BorrowersController],
  exports: [BorrowersService],
})
export class BorrowersModule { }
