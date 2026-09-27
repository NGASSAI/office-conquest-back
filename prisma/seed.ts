import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

const TEAMS = [
  { name: 'Marketing', color: '#C9A227' },
  { name: 'Tech', color: '#2F6F6B' },
  { name: 'Ventes', color: '#B4462F' },
  { name: 'RH & Finance', color: '#6B7FD7' },
];

const TERRITORIES = [
  'Open Space Nord', 'Salle Everest', 'Cafétéria', 'Salle Serveurs',
  'Terrasse', 'Salle K2', 'Accueil', 'Open Space Sud',
];

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD doivent être définis (.env en local, variables d\'environnement Render en production).',
    );
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', status: 'ACTIVE' },
    create: { email, pseudo: 'Admin', passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  console.log(`Admin prêt : ${admin.email} (${admin.id})`);
}

async function seedTeams() {
  const teams = [];
  for (const t of TEAMS) {
    const team = await prisma.team.upsert({
      where: { name: t.name },
      update: {},
      create: { name: t.name, color: t.color },
    });
    teams.push(team);
  }
  console.log(`${teams.length} équipe(s) prête(s)`);
  return teams;
}

async function seedTerritories(teams: { id: string }[]) {
  let count = 0;
  for (let i = 0; i < TERRITORIES.length; i++) {
    const name = TERRITORIES[i];
    const existing = await prisma.territory.findUnique({ where: { name } });
    if (existing) continue;
    // Répartition initiale des territoires entre les équipes, à tour de rôle
    const ownerTeamId = teams[i % teams.length].id;
    await prisma.territory.create({
      data: { name, ownerTeamId, capturedAt: new Date() },
    });
    count++;
  }
  console.log(`${count} territoire(s) créé(s) (${TERRITORIES.length - count} déjà existant(s))`);
}

async function main() {
  await seedAdmin();
  const teams = await seedTeams();
  await seedTerritories(teams);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());