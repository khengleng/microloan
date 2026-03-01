"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PenaltyCronModule = void 0;
const common_1 = require("@nestjs/common");
const penalty_cron_service_1 = require("./penalty-cron.service");
const prisma_service_1 = require("../prisma/prisma.service");
const bot_module_1 = require("../bot/bot.module");
let PenaltyCronModule = class PenaltyCronModule {
};
exports.PenaltyCronModule = PenaltyCronModule;
exports.PenaltyCronModule = PenaltyCronModule = __decorate([
    (0, common_1.Module)({
        imports: [(0, common_1.forwardRef)(() => bot_module_1.BotModule)],
        providers: [penalty_cron_service_1.PenaltyCronService, prisma_service_1.PrismaService],
    })
], PenaltyCronModule);
//# sourceMappingURL=penalty-cron.module.js.map