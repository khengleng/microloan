import { IsEnum } from 'class-validator';
import { Role } from '@microloan/db';

export class UpdateUserRoleDto {
  @IsEnum(Role)
  role: Role;
}
