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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoanProductsController = void 0;
const common_1 = require("@nestjs/common");
const loan_products_service_1 = require("./loan-products.service");
const create_loan_product_dto_1 = require("./dto/create-loan-product.dto");
const update_loan_product_dto_1 = require("./dto/update-loan-product.dto");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const current_user_decorator_1 = require("../auth/current-user.decorator");
let LoanProductsController = class LoanProductsController {
    loanProductsService;
    constructor(loanProductsService) {
        this.loanProductsService = loanProductsService;
    }
    create(user, createLoanProductDto) {
        return this.loanProductsService.create(user.tenantId, createLoanProductDto);
    }
    findAll(user) {
        return this.loanProductsService.findAll(user.tenantId);
    }
    findOne(user, id) {
        return this.loanProductsService.findOne(user.tenantId, id);
    }
    update(user, id, updateLoanProductDto) {
        return this.loanProductsService.update(user.tenantId, id, updateLoanProductDto);
    }
    remove(user, id) {
        return this.loanProductsService.remove(user.tenantId, id);
    }
};
exports.LoanProductsController = LoanProductsController;
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR'),
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_loan_product_dto_1.CreateLoanProductDto]),
    __metadata("design:returntype", void 0)
], LoanProductsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], LoanProductsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LoanProductsController.prototype, "findOne", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR'),
    (0, common_1.Put)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_loan_product_dto_1.UpdateLoanProductDto]),
    __metadata("design:returntype", void 0)
], LoanProductsController.prototype, "update", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR'),
    (0, common_1.Delete)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LoanProductsController.prototype, "remove", null);
exports.LoanProductsController = LoanProductsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('loan-products'),
    __metadata("design:paramtypes", [loan_products_service_1.LoanProductsService])
], LoanProductsController);
//# sourceMappingURL=loan-products.controller.js.map