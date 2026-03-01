import { Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
export type JwtPayload = {
    sub: string;
    email: string;
    role: string;
    tenantId: string;
    tenantName?: string;
    tenantPlan?: string;
};
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private prisma;
    constructor(prisma: PrismaService);
    validate(payload: JwtPayload): Promise<{
        id: string;
        sub: string;
        email: string;
        role: string;
        tenantId: string;
        tenantName: string | undefined;
        tenantPlan: string;
    }>;
}
export {};
