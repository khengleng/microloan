/**
 * Run with: npx tsx seed-admin.ts
 * Creates a SUPERADMIN user for the PaaS platform if none exists.
 */
import { PrismaClient } from '@microloan/db';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = process.env.ADMIN_EMAIL || 'admin@microloanos.com';
    const password = process.env.ADMIN_PASSWORD || 'Admin@123!';

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
    console.log(`   Password: ${password}`);
    console.log(`   Role:     ${user.role}`);
    console.log(`   Tenant:   ${tenant.name}\n`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
