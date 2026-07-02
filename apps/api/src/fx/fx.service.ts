import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Currency } from '@microloan/db';
import { normalizeCurrency, convertCurrency, Currency as SharedCurrency } from '@microloan/shared';

@Injectable()
export class FxService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authz: AuthzService,
        private readonly audit: AuditService,
    ) { }

    /**
     * Record a new effective-dated exchange rate. Rates are append-only history;
     * the latest effective rate at/before a date is the one applied.
     */
    async upsertRate(
        actor: JwtPayload,
        dto: { fromCurrency: string; toCurrency: string; rate: number; effectiveDate?: string },
    ) {
        this.authz.assertPermission(actor, Permission.FX_MANAGE);
        const tenantId = this.requireTenant(actor);

        const from = normalizeCurrency(dto.fromCurrency) as unknown as Currency;
        const to = normalizeCurrency(dto.toCurrency) as unknown as Currency;
        if (from === to) {
            throw new BadRequestException('fromCurrency and toCurrency must differ.');
        }
        if (!(dto.rate > 0)) {
            throw new BadRequestException('Exchange rate must be positive.');
        }

        const rate = await this.prisma.exchangeRate.create({
            data: {
                tenantId,
                fromCurrency: from,
                toCurrency: to,
                rate: dto.rate,
                effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
            },
        });
        await this.audit.logAction(tenantId, this.authz.actorId(actor), 'CREATE', 'ExchangeRate', rate.id, {
            fromCurrency: from,
            toCurrency: to,
            rate: dto.rate,
        });
        return rate;
    }

    async listRates(actor: JwtPayload) {
        this.authz.assertPermission(actor, Permission.FX_VIEW);
        const tenantId = this.requireTenant(actor);
        return this.prisma.exchangeRate.findMany({
            where: { tenantId },
            orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
            take: 200,
        });
    }

    /** Latest effective rate for a currency pair at a given date (default now). */
    async getRate(
        tenantId: string,
        from: Currency,
        to: Currency,
        at: Date = new Date(),
    ): Promise<number | null> {
        if (from === to) return 1;
        const rate = await this.prisma.exchangeRate.findFirst({
            where: { tenantId, fromCurrency: from, toCurrency: to, effectiveDate: { lte: at } },
            orderBy: { effectiveDate: 'desc' },
        });
        return rate ? Number(rate.rate) : null;
    }

    async convert(actor: JwtPayload, amount: number, from: string, to: string) {
        this.authz.assertPermission(actor, Permission.FX_VIEW);
        const tenantId = this.requireTenant(actor);
        const fromCur = normalizeCurrency(from) as unknown as Currency;
        const toCur = normalizeCurrency(to) as unknown as Currency;
        if (fromCur === toCur) return { amount, from: fromCur, to: toCur, rate: 1, converted: amount };
        const rate = await this.getRate(tenantId, fromCur, toCur);
        if (rate == null) {
            throw new NotFoundException(`No exchange rate configured for ${fromCur}->${toCur}.`);
        }
        const converted = convertCurrency(
            amount,
            fromCur as unknown as SharedCurrency,
            toCur as unknown as SharedCurrency,
            rate,
        );
        return { amount, from: fromCur, to: toCur, rate, converted };
    }

    private requireTenant(actor: JwtPayload): string {
        if (!actor.tenantId) throw new NotFoundException('FX is scoped to a tenant.');
        return actor.tenantId;
    }
}
