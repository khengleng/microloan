/**
 * Run with: npx tsx seed-admin.ts
 * Creates a SUPERADMIN user for the PaaS platform if none exists.
 */
import { PrismaClient } from '@microloan/db';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();
const WEAK_DEFAULTS = new Set(['Admin@123!', 'password123', 'admin123']);

async function main() {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const email = process.env.ADMIN_EMAIL;
    let password = process.env.ADMIN_PASSWORD;

    if (!email) {
        throw new Error('ADMIN_EMAIL is required for seed-admin.');
    }

    if (!password) {
        if (!isDevelopment) {
            throw new Error('ADMIN_PASSWORD is required outside development.');
        }
        // Development-only fallback: secure random credential.
        password = randomBytes(24).toString('base64url');
    }

    if (!isDevelopment && WEAK_DEFAULTS.has(password)) {
        throw new Error('Refusing to use weak/default ADMIN_PASSWORD outside development.');
    }

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        // Just make sure they are SUPERADMIN
        await prisma.user.update({
            where: { email },
            data: { role: 'SUPERADMIN' as any },
        });
        console.log(`✅ User ${email} promoted to SUPERADMIN`);
        return;
    }

    // Create a platform tenant if needed
    let tenant = await prisma.tenant.findFirst({ where: { name: 'Magic Money Platform' } });
    if (!tenant) {
        tenant = await prisma.tenant.create({
            data: { name: 'Magic Money Platform', plan: 'ENTERPRISE', status: 'ACTIVE' },
        });
        console.log(`✅ Created platform tenant: ${tenant.name}`);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
        data: {
            tenantId: tenant.id,
            email,
            passwordHash,
            role: 'SUPERADMIN' as any,
        },
    });

    console.log(`\n✅ SUPERADMIN created successfully!`);
    console.log(`   Email:    ${user.email}`);
    if (isDevelopment) {
        console.log(`   Password: ${password}`);
    } else {
        console.log('   Password: [REDACTED]');
    }
    console.log(`   Role:     ${user.role}`);
    console.log(`   Tenant:   ${tenant.name}\n`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
