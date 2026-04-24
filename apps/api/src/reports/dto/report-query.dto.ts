import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  loanOfficerId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  borrowerId?: string;

  @IsOptional()
  @IsString()
  riskGrade?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  sortOrder?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class ReportExportQueryDto extends ReportQueryDto {
  @IsIn(['csv', 'xlsx'])
  format: 'csv' | 'xlsx';
}
