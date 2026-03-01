import { Module } from '@nestjs/common';
import { PenaltyCronService } from './penalty-cron.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
    providers: [PenaltyCronService, PrismaService]
})
export class PenaltyCronModule { }
