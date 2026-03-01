import { ExportsService } from './exports.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';
export declare class ExportsController {
    private readonly exportsService;
    constructor(exportsService: ExportsService);
    exportLoansExcel(user: JwtPayload, res: Response): Promise<void>;
    exportRepaymentsExcel(user: JwtPayload, res: Response): Promise<void>;
}
