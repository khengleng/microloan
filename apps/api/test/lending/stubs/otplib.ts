// Integration tests issue their own access tokens and never exercise TOTP.
// otplib ships as ESM only, which ts-jest's CommonJS runtime cannot load.
export const verify = () => false;
export const generateSecret = () => 'TESTSECRET';
export const generateURI = () => 'otpauth://totp/test';
