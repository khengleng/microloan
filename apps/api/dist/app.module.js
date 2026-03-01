"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const prisma_module_1 = require("./prisma/prisma.module");
const tenants_module_1 = require("./tenants/tenants.module");
const users_module_1 = require("./users/users.module");
const auth_module_1 = require("./auth/auth.module");
const borrowers_module_1 = require("./borrowers/borrowers.module");
const loans_module_1 = require("./loans/loans.module");
const repayments_module_1 = require("./repayments/repayments.module");
const audit_module_1 = require("./audit/audit.module");
const reports_module_1 = require("./reports/reports.module");
const bot_module_1 = require("./bot/bot.module");
const loan_products_module_1 = require("./loan-products/loan-products.module");
const health_module_1 = require("./health/health.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            schedule_1.ScheduleModule.forRoot(),
            prisma_module_1.PrismaModule,
            tenants_module_1.TenantsModule,
            users_module_1.UsersModule,
            auth_module_1.AuthModule,
            borrowers_module_1.BorrowersModule,
            loans_module_1.LoansModule,
            repayments_module_1.RepaymentsModule,
            audit_module_1.AuditModule,
            reports_module_1.ReportsModule,
            bot_module_1.BotModule,
            loan_products_module_1.LoanProductsModule,
            health_module_1.HealthModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map