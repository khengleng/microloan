import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

/** Early settlement of a legacy loan at its payoff quote (UC-31). */
export class SettleLoanDto {
  @IsString()
  @IsNotEmpty()
  loanId: string;

  /** Must equal the payoff quote's `payoffAmount` today. */
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
