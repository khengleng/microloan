"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoanProductsModule = void 0;
const common_1 = require("@nestjs/common");
const loan_products_service_1 = require("./loan-products.service");
const loan_products_controller_1 = require("./loan-products.controller");
let LoanProductsModule = class LoanProductsModule {
};
exports.LoanProductsModule = LoanProductsModule;
exports.LoanProductsModule = LoanProductsModule = __decorate([
    (0, common_1.Module)({
        controllers: [loan_products_controller_1.LoanProductsController],
        providers: [loan_products_service_1.LoanProductsService],
        exports: [loan_products_service_1.LoanProductsService],
    })
], LoanProductsModule);
//# sourceMappingURL=loan-products.module.js.map