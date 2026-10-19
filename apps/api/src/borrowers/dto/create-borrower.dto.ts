import { IsDateString, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';

export class CreateBorrowerDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  idNumber?: string;

  @IsString()
  @IsOptional()
  telegramChatId?: string;

  // P0 #4: basic KYC capture
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  idType?: string;

  // AML/CFT risk factor (D-120): ISO 3166 alpha-2 nationality.
  @Matches(/^[A-Z]{2}$/, { message: 'nationality must be a two-letter ISO country code (e.g. KH)' })
  @IsOptional()
  nationality?: string;

  @IsString()
  @IsOptional()
  occupation?: string;

  // Risk Batch #7: affordability inputs
  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyIncome?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyExpenses?: number;

  // The branch the customer belongs to; applications need one. A
  // branch-confined user may only name their own branch.
  @IsUUID()
  @IsOptional()
  branchId?: string;
}

export class UpdateBorrowerDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  idNumber?: string;

  @IsString()
  @IsOptional()
  telegramChatId?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  idType?: string;

  // AML/CFT risk factor (D-120): ISO 3166 alpha-2 nationality.
  @Matches(/^[A-Z]{2}$/, { message: 'nationality must be a two-letter ISO country code (e.g. KH)' })
  @IsOptional()
  nationality?: string;

  @IsString()
  @IsOptional()
  occupation?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyIncome?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyExpenses?: number;

  // The branch the customer belongs to; applications need one. A
  // branch-confined user may only name their own branch.
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
