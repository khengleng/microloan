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

export class CollateralDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @IsNotEmpty()
  value: number;

  @IsString()
  @IsOptional()
  idNumber?: string;
}

export class GuarantorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  idNumber?: string;

  @IsString()
  @IsOptional()
  relation?: string;
}

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

  @IsOptional()
  collaterals?: CollateralDto[];

  @IsOptional()
  guarantors?: GuarantorDto[];
}

export class ChangeLoanStatusDto {
  @IsString()
  @IsNotEmpty()
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISBURSED' | 'CLOSED' | 'DEFAULTED';

  @IsString()
  @IsOptional()
  reason?: string;
}

export class CreateInteractionDto {
  @IsString()
  @IsNotEmpty()
  notes: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  type?: string;
}
