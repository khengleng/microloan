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
exports.DocumentVaultController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const document_vault_service_1 = require("./document-vault.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const current_user_decorator_1 = require("../auth/current-user.decorator");
let DocumentVaultController = class DocumentVaultController {
    documentVaultService;
    constructor(documentVaultService) {
        this.documentVaultService = documentVaultService;
    }
    async uploadDocument(user, loanId, file) {
        if (!file)
            throw new common_1.BadRequestException('File is required');
        return this.documentVaultService.uploadDocument(user.tenantId, loanId, user.sub, file);
    }
    async getDocuments(user, loanId) {
        return this.documentVaultService.getDocuments(user.tenantId, loanId);
    }
    async downloadDocument(user, documentId, res) {
        const doc = await this.documentVaultService.downloadDocument(user.tenantId, documentId, user.sub);
        if (doc.type === 'url' && doc.url) {
            return res.redirect(doc.url);
        }
        else if (doc.type === 'buffer' && doc.mimetype) {
            res.setHeader('Content-Type', doc.mimetype);
            res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
            res.send(doc.data);
        }
    }
};
exports.DocumentVaultController = DocumentVaultController;
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'SALES', 'FINANCE'),
    (0, common_1.Post)('upload/:loanId'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('loanId')),
    __param(2, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], DocumentVaultController.prototype, "uploadDocument", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'SALES', 'FINANCE', 'CX'),
    (0, common_1.Get)('loan/:loanId'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('loanId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentVaultController.prototype, "getDocuments", null);
__decorate([
    (0, roles_decorator_1.Roles)('ADMIN', 'OPERATOR', 'SALES', 'FINANCE', 'CX'),
    (0, common_1.Get)('download/:documentId'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('documentId')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], DocumentVaultController.prototype, "downloadDocument", null);
exports.DocumentVaultController = DocumentVaultController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('documents'),
    __metadata("design:paramtypes", [document_vault_service_1.DocumentVaultService])
], DocumentVaultController);
//# sourceMappingURL=document-vault.controller.js.map