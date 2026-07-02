import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class UpsertExchangeRateDto {
    @IsString()
    @IsIn(['USD', 'KHR'])
    fromCurrency: string;

    @IsString()
    @IsIn(['USD', 'KHR'])
    toCurrency: string;

    @IsNumber()
    @IsPositive()
    rate: number;

    @IsOptional()
    @IsDateString()
    effectiveDate?: string;
}
