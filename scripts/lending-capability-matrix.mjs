#!/usr/bin/env node
/**
 * Regenerate docs/lending/CAPABILITY_MATRIX.md from the code that ships.
 *
 *   pnpm --filter @microloan/shared build && node scripts/lending-capability-matrix.mjs
 *
 * The matrix is generated, never hand-edited, so it cannot claim a capability
 * the engine does not have.
 */
import fs from 'node:fs';
import { lending } from '../packages/shared/dist/index.js';

const rows = [];
const icon = { IMPLEMENTED: '✅ Fully implemented', SIMULATION_ONLY: '🧪 Simulation only', REQUIRES_INTEGRATION: '🔌 Requires integration', NOT_IMPLEMENTED: '⛔ Not implemented' };
rows.push('# Lending capability matrix');
rows.push('');
rows.push(`_Generated from \`packages/shared/src/lending/capabilities.ts\` and the product catalogue (engine ${lending.LENDING_ENGINE_VERSION}). Do not edit by hand — run \`node scripts/lending-capability-matrix.mjs\`._`);
rows.push('');
rows.push('A product version can be activated only when every capability it requires is **Fully implemented**.');
rows.push('');
const counts = lending.CAPABILITIES.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
rows.push(Object.entries(icon).map(([k, v]) => `${v}: ${counts[k] ?? 0}`).join(' · '));
rows.push('');
rows.push('## Capabilities');
for (const area of [...new Set(lending.CAPABILITIES.map((c) => c.area))]) {
  rows.push('', `### ${area}`, '', '| Capability | Status | Phase | Description | Evidence / limitation |', '|---|---|---|---|---|');
  for (const c of lending.CAPABILITIES.filter((x) => x.area === area)) {
    rows.push(`| \`${c.id}\` | ${icon[c.status]} | ${c.phase} | ${c.description} | ${[c.evidence ? `Tests: \`${c.evidence}\`` : '', c.limitation ?? ''].filter(Boolean).join('<br>')} |`);
  }
}
rows.push('', '## Product templates', '', '| Family | Template | Phase 1 slice | Available | Missing capabilities |', '|---|---|---|---|---|');
for (const fam of lending.LOAN_FAMILY_DEFINITIONS) {
  for (const t of lending.PRODUCT_TEMPLATES.filter((x) => x.familyCode === fam.code)) {
    const a = lending.templateAvailability(t);
    rows.push(`| ${fam.name} | ${t.name} (\`${t.code}\`) | ${t.phase1Slice ? 'Yes' : ''} | ${a.available ? '✅' : '⛔'} | ${a.missing.map((m) => `\`${m.id}\` (${m.status.toLowerCase().replace(/_/g, ' ')})`).join(', ')} |`);
  }
}
rows.push('');
fs.mkdirSync('docs/lending', { recursive: true });
fs.writeFileSync('docs/lending/CAPABILITY_MATRIX.md', rows.join('\n'));
console.log(`Wrote docs/lending/CAPABILITY_MATRIX.md (${lending.CAPABILITIES.length} capabilities, ${lending.PRODUCT_TEMPLATES.length} templates).`);
