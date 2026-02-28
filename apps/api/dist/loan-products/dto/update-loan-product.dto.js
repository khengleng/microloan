"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateLoanProductDto = void 0;
const mapped_types_1 = require("@nestjs/mapped-types");
const create_loan_product_dto_1 = require("./create-loan-product.dto");
class UpdateLoanProductDto extends (0, mapped_types_1.PartialType)(create_loan_product_dto_1.CreateLoanProductDto) {
}
exports.UpdateLoanProductDto = UpdateLoanProductDto;
//# sourceMappingURL=update-loan-product.dto.js.map