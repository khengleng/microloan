import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
export type QuotaResource = 'users' | 'borrowers' | 'loanProducts' | 'loans';
export declare const CheckQuota: (resource: QuotaResource) => import("@nestjs/common").CustomDecorator<string>;
export declare class QuotaGuard implements CanActivate {
    private reflector;
    private prisma;
    constructor(reflector: Reflector, prisma: PrismaService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
