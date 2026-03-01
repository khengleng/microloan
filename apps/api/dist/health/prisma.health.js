"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaHealthIndicator = void 0;
const common_1 = require("@nestjs/common");
const terminus_1 = require("@nestjs/terminus");
const prisma_service_1 = require("../prisma/prisma.service");
let PrismaHealthIndicator = class PrismaHealthIndicator extends terminus_1.HealthIndicator {
    prisma;
    constructor(prisma) {
        super();
        this.prisma = prisma;
    }
    async isHealthy(key) {
        try {
            await this.prisma.$queryRaw `SELECT 1`;
            return this.getStatus(key, true);
        }
        catch (e) {
            throw new terminus_1.HealthCheckError('Prisma check failed', this.getStatus(key, false, { message: e.message }));
        }
    }
};
exports.PrismaHealthIndicator = PrismaHealthIndicator;
exports.PrismaHealthIndicator = PrismaHealthIndicator = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PrismaHealthIndicator);
//# sourceMappingURL=prisma.health.js.map