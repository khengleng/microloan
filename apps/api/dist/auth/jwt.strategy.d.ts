import { Strategy } from 'passport-jwt';
export type JwtPayload = {
    sub: string;
    email: string;
    role: string;
    tenantId: string;
};
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    constructor();
    validate(payload: JwtPayload): Promise<{
        id: string;
        sub: string;
        email: string;
        role: string;
        tenantId: string;
    }>;
}
export {};
