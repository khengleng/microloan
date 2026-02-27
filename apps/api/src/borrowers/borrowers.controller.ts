import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { BorrowersService } from './borrowers.service';
import {
  CreateBorrowerDto,
  UpdateBorrowerDto,
} from './dto/create-borrower.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard)
@Controller('borrowers')
export class BorrowersController {
  constructor(private readonly borrowersService: BorrowersService) { }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBorrowerDto) {
    return this.borrowersService.create(user.tenantId, user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.borrowersService.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.borrowersService.findOne(user.tenantId, id);
  }

  @Put(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBorrowerDto,
  ) {
    return this.borrowersService.update(user.tenantId, user.sub, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.borrowersService.remove(user.tenantId, user.sub, id);
  }
}
