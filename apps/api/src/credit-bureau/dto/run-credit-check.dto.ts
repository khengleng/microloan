import { IsNotEmpty, IsString } from 'class-validator';

export class RunCreditCheckDto {
    @IsString()
    @IsNotEmpty()
    borrowerId: string;
}
