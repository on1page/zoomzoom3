import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const counts = {
    users: await db.user.count(),
    categories: await db.category.count(),
    criteria: await db.criterion.count(),
    zones: await db.zone.count(),
    entities: await db.entity.count(),
    entitiesDemo: await db.entity.count({ where: { isDemo: true } }),
    experiences: await db.experience.count(),
    invites: await db.invite.count(),
    reviews: await db.review.count(),
    reviewsDemo: await db.review.count({ where: { isDemo: true } }),
    reports: await db.report.count(),
    settings: await db.setting.count(),
    emailLog: await db.emailLog.count(),
    sessions: await db.session.count(),
    uploads: await db.verificationDoc.count(),
    proposals: await db.entityProposal.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
  const staff = await db.user.findMany({
    where: { role: { in: ['moderator', 'admin', 'superadmin'] } },
    select: { email: true, role: true, totpEnabled: true },
  });
  console.log('STAFF:', JSON.stringify(staff));
  const demoUser = await db.user.findFirst({ where: { isDemo: true }, select: { email: true } });
  console.log('DEMO USER:', demoUser?.email ?? 'nessuno');
}
main().finally(() => db.$disconnect());
