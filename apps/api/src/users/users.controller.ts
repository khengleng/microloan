import { Controller, Get, Post, Body, Param, Delete, Put, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { QuotaGuard, CheckQuota } from '../common/quota.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@UseGuards(JwtAuthGuard, RolesGuard, QuotaGuard)
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    // SUPERADMIN manages their platform operations team (finOps, CX, Sales etc.)
    // ADMIN manages their tenant's team — both scoped to their own tenantId via JWT
    @Roles('ADMIN', 'SUPERADMIN')
    @Get()
    findAll(@CurrentUser() user: JwtPayload) {
        return this.usersService.findAll(user);
    }

    @Roles('ADMIN', 'SUPERADMIN')
    @CheckQuota('users')
    @Post()
    create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
        return this.usersService.create(user, {
            email: dto.email,
            plainPassword: dto.password,
            role: dto.role,
        });
    }

    @Roles('ADMIN', 'SUPERADMIN')
    @Delete(':id')
    remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.usersService.remove(user, id);
    }

    @Roles('ADMIN', 'SUPERADMIN')
    @Put(':id/role')
    updateRole(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: UpdateUserRoleDto) {
        return this.usersService.updateRole(user, id, body.role);
    }
}
