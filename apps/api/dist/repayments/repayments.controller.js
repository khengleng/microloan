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
exports.RepaymentsController = void 0;
const common_1 = require("@nestjs/common");
const repayments_service_1 = require("./repayments.service");
const post_repayment_dto_1 = require("./dto/post-repayment.dto");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const current_user_decorator_1 = require("../auth/current-user.decorator");
let RepaymentsController = class RepaymentsController {
    repaymentsService;
    constructor(repaymentsService) {
        this.repaymentsService = repaymentsService;
    }
    create(user, dto) {
        return this.repaymentsService.postRepayment(user.tenantId, user.sub, dto);
    }
    findAll(user, loanId) {
        return this.repaymentsService.findAll(user.tenantId, loanId);
    }
};
exports.RepaymentsController = RepaymentsController;
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'FINANCE'),
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, post_repayment_dto_1.PostRepaymentDto]),
    __metadata("design:returntype", void 0)
], RepaymentsController.prototype, "create", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'FINANCE', 'CX'),
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('loanId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], RepaymentsController.prototype, "findAll", null);
exports.RepaymentsController = RepaymentsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('repayments'),
    __metadata("design:paramtypes", [repayments_service_1.RepaymentsService])
], RepaymentsController);
//# sourceMappingURL=repayments.controller.js.map