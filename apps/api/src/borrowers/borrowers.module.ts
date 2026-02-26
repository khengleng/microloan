import { Module } from '@nestjs/common';
import { BorrowersService } from './borrowers.service';
import { BorrowersController } from './borrowers.controller';

@Module({
  providers: [BorrowersService],
  controllers: [BorrowersController],
  exports: [BorrowersService],
})
export class BorrowersModule { }
