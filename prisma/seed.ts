import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/auth/password'
import { nextCode } from '../src/lib/idgen'

const prisma = new PrismaClient()

const LABOR_CATEGORIES = [
  'Mason',
  'Steel Fixer',
  'Carpenter',
  'Plumber',
  'Electrician',
  'Painter',
  'Tiler',
  'Equipment Operator',
  'Helper/Labourer',
  'Foreman',
]

const MATERIALS: { name: string; unit: string }[] = [
  { name: 'OPC Cement', unit: 'bag' },
  { name: 'Sand', unit: 'm3' },
  { name: 'Aggregate 3/4"', unit: 'm3' },
  { name: 'Rebar 12mm', unit: 'ton' },
  { name: 'Rebar 16mm', unit: 'ton' },
  { name: 'Block 200mm', unit: 'no' },
  { name: 'Block 150mm', unit: 'no' },
  { name: 'Ready-Mix C35', unit: 'm3' },
  { name: 'Plywood 18mm', unit: 'sheet' },
  { name: 'Diesel', unit: 'ltr' },
]

async function main() {
  // ─── 1. Admin user (USR-00001) ───
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@yourcompany.com').toLowerCase()
  const adminPassword = process.env.SEED_ADMIN_PASSWORD
  if (!adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD is required to seed the admin user.')
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!existingAdmin) {
    const passwordHash = await hashPassword(adminPassword)
    await prisma.$transaction(async (tx) => {
      const userCode = await nextCode(tx, 'user', 'USR', 5)
      await tx.user.create({
        data: {
          userCode,
          email: adminEmail,
          passwordHash,
          firstName: 'System',
          lastName: 'Administrator',
          role: 'ADMIN',
          status: 'ACTIVE',
          mustChangePassword: false,
        },
      })
    })
    console.info(`Created admin user ${adminEmail} (USR-00001)`)
  } else {
    console.info(`Admin user ${adminEmail} already exists — skipping.`)
  }

  // ─── 2. Labor categories ───
  for (let i = 0; i < LABOR_CATEGORIES.length; i++) {
    const name = LABOR_CATEGORIES[i]!
    await prisma.laborCategory.upsert({
      where: { name },
      create: { name, sortOrder: i },
      update: { sortOrder: i },
    })
  }
  console.info(`Seeded ${LABOR_CATEGORIES.length} labor categories.`)

  // ─── 3. Materials ───
  for (let i = 0; i < MATERIALS.length; i++) {
    const { name, unit } = MATERIALS[i]!
    await prisma.material.upsert({
      where: { name },
      create: { name, unit, sortOrder: i },
      update: { unit, sortOrder: i },
    })
  }
  console.info(`Seeded ${MATERIALS.length} materials.`)

  // ─── 4. Demo project (PRJ-2026-001) ───
  const admin = await prisma.user.findUnique({ where: { email: adminEmail } })
  const demoExists = await prisma.project.findFirst({ where: { name: 'Demo Site' } })
  if (!demoExists && admin) {
    const year = new Date().getFullYear()
    await prisma.$transaction(async (tx) => {
      const projectCode = await nextCode(tx, `project:${year}`, `PRJ-${year}`, 3)
      await tx.project.create({
        data: {
          projectCode,
          name: 'Demo Site',
          location: 'Manama',
          status: 'ACTIVE',
          createdBy: admin.id,
        },
      })
    })
    console.info('Created demo project "Demo Site" (delete after go-live).')
  } else {
    console.info('Demo project already exists — skipping.')
  }

  // ─── 5. Demo scope (assets + activities) so the demo project is immediately reportable ───
  const demo = await prisma.project.findFirst({ where: { name: 'Demo Site' } })
  if (demo) {
    const existingAssets = await prisma.asset.count({ where: { projectId: demo.id } })
    if (existingAssets === 0) {
      const scope: { name: string; ref: string; activities: { name: string; unit: string; boq: number }[] }[] = [
        {
          name: 'Tower A',
          ref: 'A',
          activities: [
            { name: 'Blockwork 200mm', unit: 'm2', boq: 500 },
            { name: 'Concrete C35 to columns', unit: 'm3', boq: 120 },
            { name: 'Rebar to columns', unit: 'ton', boq: 18 },
          ],
        },
        {
          name: 'External Works',
          ref: 'EXT',
          activities: [
            { name: 'Excavation', unit: 'm3', boq: 800 },
            { name: 'Kerb stones', unit: 'LM', boq: 350 },
          ],
        },
      ]
      for (let a = 0; a < scope.length; a++) {
        const asset = scope[a]!
        await prisma.asset.create({
          data: {
            projectId: demo.id,
            ref: asset.ref,
            name: asset.name,
            sortOrder: a,
            activities: {
              create: asset.activities.map((act, i) => ({
                name: act.name,
                unit: act.unit,
                boqQuantity: act.boq,
                sortOrder: i,
              })),
            },
          },
        })
      }
      console.info(`Seeded ${scope.length} demo assets with activities on "Demo Site".`)
    } else {
      console.info('Demo assets already exist — skipping.')
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
