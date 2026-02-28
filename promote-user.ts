import { PrismaClient } from '@prisma/client';

async function promote() {
    const prisma = new PrismaClient();
    try {
        const email = process.argv[2];
        if (!email) {
            console.error('Please provide an email address as an argument.');
            process.exit(1);
        }

        const user = await prisma.user.update({
            where: { email },
            data: { role: 'SUPERADMIN' }
        });

        console.log(`Successfully promoted ${email} to SUPERADMIN.`);
    } catch (error) {
        console.error('Error promoting user:', error);
    } finally {
        await prisma.$disconnect();
    }
}

promote();
