import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class KycReviewDto {
  @IsIn(['VERIFIED', 'REJECTED', 'PENDING'])
  status!: 'VERIFIED' | 'REJECTED' | 'PENDING';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
