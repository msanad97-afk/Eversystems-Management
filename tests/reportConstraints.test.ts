import { describe, it, expect, afterAll } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'

// Integration test: the DB enforces one report per (project, date, author).
const prisma = new PrismaClient()
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string } = {}

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TST-${suffix}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('one report per project + date + author', () => {
  it('rejects a duplicate (projectId, reportDate, authorId) with a unique violation', async () => {
    const user = await prisma.user.create({
      data: {
        userCode: `TST-U-${suffix}`,
        email: `tst_${suffix}@example.local`,
        passwordHash: 'x',
        firstName: 'Test',
        lastName: 'Author',
        role: 'SUPERVISOR',
      },
    })
    ids.userId = user.id

    const project = await prisma.project.create({
      data: { projectCode: `TST-P-${suffix}`, name: 'Constraint Test', createdBy: user.id },
    })
    ids.projectId = project.id

    const reportDate = new Date('2026-07-10T00:00:00.000Z')

    await prisma.dailyReport.create({
      data: {
        reportCode: `TST-${suffix}-R1`,
        projectId: project.id,
        authorId: user.id,
        reportDate,
        status: 'DRAFT',
      },
    })

    let error: unknown = null
    try {
      await prisma.dailyReport.create({
        data: {
          reportCode: `TST-${suffix}-R2`,
          projectId: project.id,
          authorId: user.id,
          reportDate,
          status: 'DRAFT',
        },
      })
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002')
  })

  it('allows the same author on a different date', async () => {
    const created = await prisma.dailyReport.create({
      data: {
        reportCode: `TST-${suffix}-R3`,
        projectId: ids.projectId!,
        authorId: ids.userId!,
        reportDate: new Date('2026-07-11T00:00:00.000Z'),
        status: 'DRAFT',
      },
    })
    expect(created.id).toBeTruthy()
  })
})
