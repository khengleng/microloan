#!/usr/bin/env node

// Refuse migration files that contain CLI output instead of SQL.
//
// `prisma migrate diff --script > migration.sql` also captures anything the
// CLI prints to stdout — notably the "Update available" box. Postgres rejects
// it with a syntax error at deploy time, and because the integration-test
// database is built with `db push` rather than from the migration history,
// nothing else in CI notices. This scan catches it before merge.

import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.join(process.cwd(), 'packages/db/prisma/migrations');

const FORBIDDEN = [
  { pattern: /^[\s]*[┌│└├╭╰]/, reason: 'box-drawing banner (CLI output)' },
  { pattern: /Update available/i, reason: 'Prisma update notice' },
  { pattern: /^\s*(prisma:(warn|info|error)|Environment variables loaded|Prisma schema loaded|Datasource ")/, reason: 'Prisma CLI log line' },
  { pattern: /\u001b\[/, reason: 'ANSI escape sequence' },
];

const failures = [];

for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = path.join(migrationsDir, entry.name, 'migration.sql');
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { pattern, reason } of FORBIDDEN) {
      if (pattern.test(line)) {
        failures.push(`${path.relative(process.cwd(), file)}:${i + 1}  ${reason}: ${line.trim().slice(0, 80)}`);
        break;
      }
    }
  });
}

if (failures.length) {
  console.error('Migration files contain non-SQL output:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Migration files look like SQL.');
