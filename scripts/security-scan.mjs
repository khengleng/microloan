#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const mode = process.argv[2];
if (!mode) {
  console.error('Usage: node scripts/security-scan.mjs <hardcodes|timebombs|memory>');
  process.exit(1);
}

const repoRoot = process.cwd();
const allowlistPath = path.join(repoRoot, 'security-allowlist.json');
const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  : [];

const PATTERNS = {
  hardcodes: [
    /password123/i,
    /admin@example\.com/i,
    /super-secret/i,
    /changeme/i,
    /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
    /JWT_ACCESS_SECRET\s*=\s*['"][^'"]{1,31}['"]/i,
    /JWT_REFRESH_SECRET\s*=\s*['"][^'"]{1,31}['"]/i,
    /postgresql:\/\/[^\s"']*:[^\s"']+@/i,
  ],
  timebombs: [
    /disableAfter/i,
    /validUntil/i,
    /killSwitch/i,
    /if\s*\([^\)]*Date\.now\(\)\s*[><=]/,
    /new Date\(['"][0-9]{4}-[0-9]{2}-[0-9]{2}/,
    /trial\s*expir/i,
    /demo\s*expir/i,
  ],
  memory: [
    /users\s*=\s*\[\]/,
    /loans\s*=\s*\[\]/,
    /borrowers\s*=\s*\[\]/,
    /in[- ]memory/i,
    /mockAuth/i,
    /fakeJwt/i,
    /sessionStorage\./,
    /localStorage\.(setItem|getItem).*token/i,
  ],
};

const patterns = PATTERNS[mode];
if (!patterns) {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => !f.startsWith('node_modules/'))
  .filter((f) => !f.startsWith('.turbo/'))
  .filter((f) => !f.endsWith('pnpm-lock.yaml'))
  .filter((f) => !f.includes('/dist/'))
  .filter((f) => !f.includes('/coverage/'))
  .filter((f) => !f.includes('.next/'))
  .filter((f) => !f.endsWith('.spec.ts'))
  .filter((f) => !f.endsWith('.test.ts'))
  .filter((f) => !f.includes('/__tests__/'));

const findings = [];

for (const rel of files) {
  const full = path.join(repoRoot, rel);
  let content = '';
  try {
    content = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    patterns.forEach((pattern) => {
      if (pattern.test(line)) {
        if (mode === 'hardcodes' && rel.endsWith('.env.example') && line.includes('<') && line.includes('>')) {
          return;
        }
        const allowed = allowlist.some((entry) => {
          const notExpired = new Date(entry.expiryDate).getTime() >= Date.now();
          return (
            notExpired &&
            entry.file === rel &&
            new RegExp(entry.pattern).test(line) &&
            entry.mode === mode
          );
        });
        if (!allowed) {
          findings.push({ file: rel, line: idx + 1, text: line.trim(), pattern: String(pattern) });
        }
      }
    });
  });
}

if (findings.length) {
  console.error(`Security scan failed (${mode}). Findings:`);
  findings.slice(0, 200).forEach((f) => {
    console.error(`${f.file}:${f.line} :: ${f.text}`);
  });
  if (findings.length > 200) {
    console.error(`... and ${findings.length - 200} more`);
  }
  process.exit(1);
}

console.log(`Security scan passed (${mode}).`);
