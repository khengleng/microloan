export declare const RateLimiter: {
    login: (ip: string) => {
        allowed: boolean;
        remaining: number;
        resetIn: number;
    };
    register: (ip: string) => {
        allowed: boolean;
        remaining: number;
        resetIn: number;
    };
    mfa: (ip: string) => {
        allowed: boolean;
        remaining: number;
        resetIn: number;
    };
};
