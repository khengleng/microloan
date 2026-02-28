import { IsEmail, IsNotEmpty, MinLength, IsString } from 'class-validator';

export class RegisterTenantDto {
    @IsNotEmpty()
    @IsString()
    organizationName: string;

    @IsEmail()
    adminEmail: string;

    @IsNotEmpty()
    @MinLength(6)
    adminPassword: string;
}
