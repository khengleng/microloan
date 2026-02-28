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
exports.BorrowersController = void 0;
const common_1 = require("@nestjs/common");
const borrowers_service_1 = require("./borrowers.service");
const create_borrower_dto_1 = require("./dto/create-borrower.dto");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const current_user_decorator_1 = require("../auth/current-user.decorator");
let BorrowersController = class BorrowersController {
    borrowersService;
    constructor(borrowersService) {
        this.borrowersService = borrowersService;
    }
    checkCrossTenant(user, idNumber, phone) {
        return this.borrowersService.checkCrossTenantCredit(user.tenantId, { idNumber, phone });
    }
    create(user, dto) {
        return this.borrowersService.create(user.tenantId, user.sub, dto);
    }
    findAll(user) {
        return this.borrowersService.findAll(user.tenantId);
    }
    findOne(user, id) {
        return this.borrowersService.findOne(user.tenantId, id);
    }
    update(user, id, dto) {
        return this.borrowersService.update(user.tenantId, user.sub, id, dto);
    }
    remove(user, id) {
        return this.borrowersService.remove(user.tenantId, user.sub, id);
    }
};
exports.BorrowersController = BorrowersController;
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'SALES', 'CX'),
    (0, common_1.Get)('cross-check'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('idNumber')),
    __param(2, (0, common_1.Query)('phone')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], BorrowersController.prototype, "checkCrossTenant", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'SALES'),
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_borrower_dto_1.CreateBorrowerDto]),
    __metadata("design:returntype", void 0)
], BorrowersController.prototype, "create", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'SALES', 'CX'),
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BorrowersController.prototype, "findAll", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'SALES', 'CX'),
    (0, common_1.Get)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BorrowersController.prototype, "findOne", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR'),
    (0, common_1.Put)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, create_borrower_dto_1.UpdateBorrowerDto]),
    __metadata("design:returntype", void 0)
], BorrowersController.prototype, "update", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN'),
    (0, common_1.Delete)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BorrowersController.prototype, "remove", null);
exports.BorrowersController = BorrowersController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('borrowers'),
    __metadata("design:paramtypes", [borrowers_service_1.BorrowersService])
], BorrowersController);
//# sourceMappingURL=borrowers.controller.js.map