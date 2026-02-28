import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, ValidateNested, IsArray, IsNumber } from 'class-validator';
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
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateLoanPolicyDto)
    policies?: CreateLoanPolicyDto[];
}
