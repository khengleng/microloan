#!/usr/bin/env tsx
/**
 * SaaS Role Segregation Test
 * Tests that SUPERADMIN is locked to platform ops, and that tenant roles
 * correctly fence business operations.
 *
 * Usage:
 *   npx tsx scripts/test-roles.ts
 *
 * Env vars:
 *   API_URL
 *   SUPER_EMAIL      SUPERADMIN email
 *   SUPER_PASSWORD   SUPERADMIN password
 *   TENANT_EMAIL     Tenant ADMIN email (created during this run if missing)
 *   TENANT_PASSWORD  Tenant ADMIN password
 */

const API = process.env.API_URL ?? '';
const SUPER_EMAIL = process.env.SUPER_EMAIL ?? '';
const SUPER_PASS = process.env.SUPER_PASSWORD ?? '';
// A real tenant admin that exists on the platform — override via env
const TENANT_EMAIL = process.env.TENANT_EMAIL ?? '';
const TENANT_PASS = process.env.TENANT_PASSWORD ?? '';

// ─── helpers ──────────────────────────────────────────────────────────────────

type Resp = { status: number; body: any };

async function req(
    method: string,
    path: string,
    token: string | null,
    body?: any,
): Promise<Resp> {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    let parsed: any;
    try { parsed = await res.json(); } catch { parsed = null; }
    return { status: res.status, body: parsed };
}

function pass(label: string, detail?: any) {
    console.log(`  ✅  ${label}`, detail !== undefined ? `→ ${JSON.stringify(detail)}` : '');
}
function fail(label: string, detail?: any) {
    console.error(`  ❌  ${label}`, detail !== undefined ? `→ ${JSON.stringify(detail)}` : '');
    process.exitCode = 1;
}
function expect(label: string, condition: boolean, detail?: any) {
    condition ? pass(label, detail) : fail(label, detail);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (!API || !SUPER_EMAIL || !SUPER_PASS) {
        throw new Error('API_URL, SUPER_EMAIL, and SUPER_PASSWORD are required.');
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  SaaS Role Segregation Test`);
    console.log(`  API: ${API}`);
    console.log(`${'═'.repeat(60)}\n`);

    // ── 1. SUPERADMIN login ────────────────────────────────────────────────────
    console.log('【1】 SUPERADMIN platform operations\n');

    const suLogin = await req('POST', '/auth/login', null, {
        email: SUPER_EMAIL,
        password: SUPER_PASS,
    });
    expect('SUPERADMIN login returns 200', suLogin.status === 200, suLogin.body?.message);
    if (suLogin.status !== 200) {
        console.error('\nFATAL: Cannot log in as SUPERADMIN. Check credentials.\n');
        return;
    }
    const suToken: string = suLogin.body.accessToken;

    // Platform stats — should work
    const stats = await req('GET', '/tenants/stats/platform', suToken);
    expect('SUPERADMIN can GET /tenants/stats/platform (200)', stats.status === 200, stats.body);

    // List tenants — should work
    const tenants = await req('GET', '/tenants', suToken);
    expect('SUPERADMIN can GET /tenants (200)', tenants.status === 200);

    // Detailed health check — SUPERADMIN only
    const health = await req('GET', '/health/detailed', suToken);
    expect('SUPERADMIN can GET /health/detailed (200)', health.status === 200);

    // SHOULD BE BLOCKED: borrower list (tenant-level op)
    const suBorrowers = await req('GET', '/borrowers', suToken);
    expect(
        'SUPERADMIN is BLOCKED from GET /borrowers (403)',
        suBorrowers.status === 403,
        `got ${suBorrowers.status}`,
    );

    // SHOULD BE BLOCKED: create loan product (tenant-level op)
    const suProduct = await req('POST', '/loan-products', suToken, {
        name: 'Test', interestMethod: 'FLAT',
    });
    expect(
        'SUPERADMIN is BLOCKED from POST /loan-products (403)',
        suProduct.status === 403,
        `got ${suProduct.status}`,
    );

    // SHOULD BE BLOCKED: record repayment (tenant-level op)
    const suRepay = await req('POST', '/repayments', suToken, {
        loanId: '00000000-0000-0000-0000-000000000000', amount: 100,
    });
    expect(
        'SUPERADMIN is BLOCKED from POST /repayments (403)',
        suRepay.status === 403,
        `got ${suRepay.status}`,
    );

    // SHOULD BE BLOCKED: dashboard/reports (tenant-level op)
    const suDash = await req('GET', '/reports/dashboard', suToken);
    expect(
        'SUPERADMIN is BLOCKED from GET /reports/dashboard (403)',
        suDash.status === 403,
        `got ${suDash.status}`,
    );

    // SHOULD BE BLOCKED: manage tenant users directly (must go through /tenants/:id/users)
    const suUsers = await req('GET', '/users', suToken);
    expect(
        'SUPERADMIN is BLOCKED from GET /users (403)',
        suUsers.status === 403,
        `got ${suUsers.status}`,
    );

    // ── 2. Tenant ADMIN operations ─────────────────────────────────────────────
    if (!TENANT_EMAIL || !TENANT_PASS) {
        console.log('\n⚠️  Skipping tenant tests — set TENANT_EMAIL and TENANT_PASSWORD env vars\n');
        console.log('   Example:');
        console.log('   TENANT_EMAIL=admin@yourtenant.com TENANT_PASSWORD=xxx npx tsx scripts/test-roles.ts\n');
    } else {
        console.log('\n【2】 Tenant ADMIN business operations\n');

        const taLogin = await req('POST', '/auth/login', null, {
            email: TENANT_EMAIL,
            password: TENANT_PASS,
        });
        expect('Tenant ADMIN login returns 200', taLogin.status === 200, taLogin.body?.message);

        if (taLogin.status === 200) {
            const taToken: string = taLogin.body.accessToken;

            // Tenant ops — should all work
            const taBorrowers = await req('GET', '/borrowers', taToken);
            expect('Tenant ADMIN can GET /borrowers (200)', taBorrowers.status === 200);

            const taProducts = await req('GET', '/loan-products', taToken);
            expect('Tenant ADMIN can GET /loan-products (200)', taProducts.status === 200);

            const taDash = await req('GET', '/reports/dashboard', taToken);
            expect('Tenant ADMIN can GET /reports/dashboard (200)', taDash.status === 200);

            const taUsers = await req('GET', '/users', taToken);
            expect('Tenant ADMIN can GET /users (200)', taUsers.status === 200);

            // Platform ops — tenant ADMIN should be BLOCKED
            const taTenants = await req('GET', '/tenants', taToken);
            expect(
                'Tenant ADMIN is BLOCKED from GET /tenants (403)',
                taTenants.status === 403,
                `got ${taTenants.status}`,
            );

            const taPlatformStats = await req('GET', '/tenants/stats/platform', taToken);
            expect(
                'Tenant ADMIN is BLOCKED from GET /tenants/stats/platform (403)',
                taPlatformStats.status === 403,
                `got ${taPlatformStats.status}`,
            );

            const taHealth = await req('GET', '/health/detailed', taToken);
            expect(
                'Tenant ADMIN is BLOCKED from GET /health/detailed (403)',
                taHealth.status === 403,
                `got ${taHealth.status}`,
            );
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    if (process.exitCode === 1) {
        console.log('  RESULT: ❌ Some checks failed — review output above');
    } else {
        console.log('  RESULT: ✅ All role segregation checks passed');
    }
    console.log(`${'═'.repeat(60)}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
