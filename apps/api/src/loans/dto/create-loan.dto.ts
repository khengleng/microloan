import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsDateString,
  IsOptional,
} from 'class-validator';
import { InterestMethod } from '@microloan/shared';

export class CreateLoanDto {
  @IsString()
  @IsNotEmpty()
  borrowerId: string;

  @IsNumber()
  @IsNotEmpty()
  principal: number;

  @IsNumber()
  @IsNotEmpty()
  annualInterestRate: number;

  @IsInt()
  @IsNotEmpty()
  termMonths: number;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsEnum(InterestMethod)
  @IsNotEmpty()
  interestMethod: InterestMethod;

  @IsString()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsOptional()
  creditRatingApplied?: string;
}

export class ChangeLoanStatusDto {
  @IsString()
  @IsNotEmpty()
  status: 'DRAFT' | 'DISBURSED' | 'CLOSED' | 'DEFAULTED';
}
