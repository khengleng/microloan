import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyMfaDto {
    @IsString()
    @IsNotEmpty()
    code: string;

    @IsString()
    @IsNotEmpty()
    userId: string;
}

export class EnableMfaDto {
    @IsString()
    @IsNotEmpty()
    code: string;
}
