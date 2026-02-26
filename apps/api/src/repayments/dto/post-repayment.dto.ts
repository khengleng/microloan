import { IsDateString, IsNotEmpty, IsNumber, IsString } from 'class-validator';

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
}
