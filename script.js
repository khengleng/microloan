const { PrismaClient } = require('./packages/db/node_modules/@prisma/client');
const prisma = new PrismaClient();
async function fix() {
    const sus = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' } });
    if (sus) {
        await prisma.tenant.update({ where: { id: sus.tenantId }, data: { status: 'ACTIVE' } });
        console.log('Fixed platform tenant status for SUPERADMIN');
    }
}
fix().catch(console.error).finally(() => prisma.$disconnect());
