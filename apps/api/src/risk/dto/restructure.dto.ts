import { IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class RestructureDto {
  @IsInt()
  @Min(1)
  @Max(600)
  newTermMonths!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  newAnnualInterestRate?: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}
