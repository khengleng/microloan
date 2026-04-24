#!/usr/bin/env node

const env = process.env.NODE_ENV || 'development';
const allowUnsafe = process.env.ALLOW_UNSAFE_DB_PUSH === 'true';

if ((env === 'production' || env === 'staging') && !allowUnsafe) {
  console.error('Refusing to run prisma db push in production/staging. Use migration deploy instead.');
  console.error('If this is an emergency, set ALLOW_UNSAFE_DB_PUSH=true explicitly.');
  process.exit(1);
}

const { spawn } = await import('node:child_process');

const child = spawn('pnpm', ['--filter', 'db', 'db:push'], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
