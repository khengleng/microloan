// otplib ships as ESM only, which ts-jest's CommonJS runtime cannot load, so
// the integration suites use this stand-in with the real contract: verify()
// resolves to { valid, timeStep } and honours afterTimeStep.
//
// Test codes: a six-digit code starting with "1" is valid for any secret; its
// last digit moves it that many time steps ahead of the current one, so a
// test can use "100000" and then "100001" as two different codes. Any other
// code is invalid.
export const verify = async (opts: {
  token: string;
  secret: string;
  afterTimeStep?: number;
}) => {
  if (!/^1\d{5}$/.test(opts.token)) return { valid: false };
  const timeStep = Math.floor(Date.now() / 30_000) + Number(opts.token[5]);
  if (typeof opts.afterTimeStep === 'number' && timeStep <= opts.afterTimeStep)
    return { valid: false };
  return { valid: true, delta: 0, timeStep, epoch: timeStep * 30 };
};
export const generateSecret = () => 'TESTSECRET';
export const generateURI = () => 'otpauth://totp/test';
