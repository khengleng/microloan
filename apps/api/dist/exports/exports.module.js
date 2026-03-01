"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportsModule = void 0;
const common_1 = require("@nestjs/common");
const exports_service_1 = require("./exports.service");
const exports_controller_1 = require("./exports.controller");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
let ExportsModule = class ExportsModule {
};
exports.ExportsModule = ExportsModule;
exports.ExportsModule = ExportsModule = __decorate([
    (0, common_1.Module)({
        providers: [exports_service_1.ExportsService, prisma_service_1.PrismaService, audit_service_1.AuditService],
        controllers: [exports_controller_1.ExportsController]
    })
], ExportsModule);
//# sourceMappingURL=exports.module.js.map