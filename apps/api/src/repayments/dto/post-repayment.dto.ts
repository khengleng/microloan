import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class PostRepaymentDto {
  @IsString()
  @IsNotEmpty()
  loanId: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  // P0 #2: optional client-supplied key so a retried/double submit returns the
  // original repayment instead of posting twice.
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
