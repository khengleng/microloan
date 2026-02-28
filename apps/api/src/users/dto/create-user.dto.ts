import { IsEmail, IsNotEmpty, MinLength, IsEnum } from 'class-validator';
import { Role } from '@microloan/db';

export class CreateUserDto {
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @MinLength(6)
    password: string;

    @IsEnum(Role)
    role: Role;
}
