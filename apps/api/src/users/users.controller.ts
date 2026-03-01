import { Controller, Get, Post, Body, Param, Delete, Put, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { QuotaGuard, CheckQuota } from '../common/quota.guard';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard, RolesGuard, QuotaGuard)
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Roles('ADMIN', 'SUPERADMIN')
    @Get()
    findAll(@CurrentUser() user: JwtPayload) {
        return this.usersService.findAll(user.tenantId);
    }

    @Roles('ADMIN', 'SUPERADMIN')
    @CheckQuota('users')
    @Post()
    create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
        return this.usersService.create(user.tenantId, {
            email: dto.email,
            passwordHash: dto.password,
            role: dto.role,
        }, user.sub);
    }

    @Roles('ADMIN', 'SUPERADMIN')
    @Delete(':id')
    remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
        return this.usersService.remove(user.tenantId, id, user.sub);
    }

    @Roles('ADMIN', 'SUPERADMIN')
    @Put(':id/role')
    updateRole(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: { role: string }) {
        return this.usersService.updateRole(user.tenantId, id, body.role, user.sub);
    }
}
