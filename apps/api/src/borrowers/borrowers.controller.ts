import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { BorrowersService } from './borrowers.service';
import {
  CreateBorrowerDto,
  UpdateBorrowerDto,
} from './dto/create-borrower.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { QuotaGuard, CheckQuota } from '../common/quota.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, QuotaGuard)
@Controller('borrowers')
export class BorrowersController {
  constructor(private readonly borrowersService: BorrowersService) { }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES', 'CX')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get('cross-check')
  checkCrossTenant(
    @CurrentUser() user: JwtPayload,
    @Query('idNumber') idNumber?: string,
    @Query('phone') phone?: string,
  ) {
    return this.borrowersService.checkCrossTenantCredit(user, { idNumber, phone });
  }

  @Roles('ADMIN', 'OPERATOR', 'SALES')
  @CheckQuota('borrowers')
  @RequirePermissions(Permission.CUSTOMER_CREATE)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBorrowerDto) {
    return this.borrowersService.create(user, dto);
  }

  @Roles('ADMIN', 'OPERATOR', 'FINANCE', 'SALES', 'CX')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.borrowersService.findAll(
      user,
      search,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  @Roles('ADMIN', 'OPERATOR', 'SALES', 'CX')
  @RequirePermissions(Permission.CUSTOMER_VIEW)
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.borrowersService.findOne(user, id);
  }

  @Roles('ADMIN', 'OPERATOR')
  @RequirePermissions(Permission.CUSTOMER_UPDATE)
  @Put(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBorrowerDto,
  ) {
    return this.borrowersService.update(user, id, dto);
  }

  @Roles('ADMIN')
  @RequirePermissions(Permission.CUSTOMER_UPDATE)
  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.borrowersService.remove(user, id);
  }
}
