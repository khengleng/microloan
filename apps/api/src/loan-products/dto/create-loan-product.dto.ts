import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, ValidateNested, IsArray, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { InterestMethod } from '@microloan/shared';

class CreateLoanPolicyDto {
    @IsString()
    @IsNotEmpty()
    creditRating: string;

    @IsNumber()
    interestRate: number;

    @IsOptional()
    @IsNumber()
    minTermMonths?: number;

    @IsOptional()
    @IsNumber()
    maxTermMonths?: number;

    @IsOptional()
    @IsNumber()
    minPrincipal?: number;

    @IsOptional()
    @IsNumber()
    maxPrincipal?: number;
}

export class CreateLoanProductDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsEnum(InterestMethod)
    interestMethod: InterestMethod;

    @IsOptional()
    @IsString()
    @IsIn(['USD', 'KHR'])
    currency?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    // P1 #11: origination fees applied at disbursement.
    @IsOptional()
    @IsNumber()
    processingFeePct?: number;

    @IsOptional()
    @IsNumber()
    adminFee?: number;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateLoanPolicyDto)
    policies?: CreateLoanPolicyDto[];
}
