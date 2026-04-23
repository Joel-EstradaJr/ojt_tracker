import { CanonicalStatus } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../utils/prisma";
import {
  normalizeEntityInput,
  resolveCompanyCanonical,
  resolveSchoolCanonical,
  searchCanonicalEntities,
} from "../utils/canonical-entities";

type EntityType = "school" | "company";

function parseEntityType(value: string): EntityType | null {
  if (value === "school" || value === "company") return value;
  return null;
}

async function getActorUserId(req: Request): Promise<string | null> {
  const auth = (req as Request & { auth?: { traineeId?: string } }).auth;
  if (!auth?.traineeId) return null;

  const actor = await prisma.userProfile.findUnique({
    where: { id: auth.traineeId },
    select: { userId: true },
  });

  return actor?.userId ?? null;
}

export const searchEntities = async (req: Request, res: Response) => {
  try {
    const type = parseEntityType(req.params.type);
    if (!type) {
      return res.status(400).json({ error: "Invalid entity type." });
    }

    const query = String(req.query.query || "").trim();
    if (!query) {
      if (type === "school") {
        const schools = await prisma.school.findMany({
          where: { status: { not: CanonicalStatus.REJECTED } },
          orderBy: [{ usageCount: "desc" }, { name: "asc" }],
          take: 10,
          select: { id: true, name: true, usageCount: true },
        });

        return res.json({ items: schools });
      }

      const companies = await prisma.company.findMany({
        where: { status: { not: CanonicalStatus.REJECTED } },
        orderBy: [{ usageCount: "desc" }, { name: "asc" }],
        take: 10,
        select: { id: true, name: true, usageCount: true },
      });

      return res.json({ items: companies });
    }

    const items = await searchCanonicalEntities(prisma, type, query);
    return res.json({ items });
  } catch (error) {
    console.error("searchEntities error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const resolveEntity = async (req: Request, res: Response) => {
  try {
    const type = parseEntityType(req.params.type);
    if (!type) {
      return res.status(400).json({ error: "Invalid entity type." });
    }

    const value = String(req.body?.value || "").trim();
    if (!value) {
      return res.status(400).json({ error: "Value is required." });
    }

    const auth = (req as Request & { auth?: { role?: "admin" | "trainee" } }).auth;
    const actorUserId = await getActorUserId(req);
    const autoApprove = auth?.role === "admin";

    const resolved = type === "school"
      ? await resolveSchoolCanonical(prisma, { input: value, actorUserId, autoApprove })
      : await resolveCompanyCanonical(prisma, { input: value, actorUserId, autoApprove });

    return res.json(resolved);
  } catch (error) {
    console.error("resolveEntity error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error." });
  }
};

export const adminListEntities = async (req: Request, res: Response) => {
  try {
    const type = parseEntityType(req.params.type);
    if (!type) {
      return res.status(400).json({ error: "Invalid entity type." });
    }

    if (type === "school") {
      const schools = await prisma.school.findMany({
        include: {
          aliases: { orderBy: { alias: "asc" } },
          _count: { select: { trainees: true } },
        },
        orderBy: [{ status: "asc" }, { usageCount: "desc" }, { name: "asc" }],
      });

      return res.json({
        items: schools.map((school) => ({
          id: school.id,
          name: school.name,
          status: school.status,
          usageCount: school.usageCount,
          traineeCount: school._count.trainees,
          aliases: school.aliases,
        })),
      });
    }

    const companies = await prisma.company.findMany({
      include: {
        aliases: { orderBy: { alias: "asc" } },
        _count: { select: { trainees: true } },
      },
      orderBy: [{ status: "asc" }, { usageCount: "desc" }, { name: "asc" }],
    });

    return res.json({
      items: companies.map((company) => ({
        id: company.id,
        name: company.name,
        status: company.status,
        usageCount: company.usageCount,
        traineeCount: company._count.trainees,
        aliases: company.aliases,
      })),
    });
  } catch (error) {
    console.error("adminListEntities error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const adminReviewEntity = async (req: Request, res: Response) => {
  try {
    const type = parseEntityType(req.params.type);
    if (!type) {
      return res.status(400).json({ error: "Invalid entity type." });
    }

    const status = String(req.body?.status || "").toUpperCase() as CanonicalStatus;
    if (![CanonicalStatus.APPROVED, CanonicalStatus.REJECTED, CanonicalStatus.PENDING].includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }

    const actorUserId = await getActorUserId(req);

    if (type === "school") {
      const updated = await prisma.school.update({
        where: { id: req.params.id },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedById: actorUserId,
        },
      });

      return res.json(updated);
    }

    const updated = await prisma.company.update({
      where: { id: req.params.id },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedById: actorUserId,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("adminReviewEntity error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const adminAddAlias = async (req: Request, res: Response) => {
  try {
    const type = parseEntityType(req.params.type);
    if (!type) {
      return res.status(400).json({ error: "Invalid entity type." });
    }

    const alias = String(req.body?.alias || "").trim();
    if (!alias) {
      return res.status(400).json({ error: "Alias is required." });
    }

    const canonicalId = req.params.id;
    const normalizedAlias = normalizeEntityInput(alias);
    if (!normalizedAlias) return res.status(400).json({ error: "Alias is invalid." });

    if (type === "school") {
      await prisma.schoolAlias.upsert({
        where: { normalizedAlias },
        create: { alias, normalizedAlias, schoolId: canonicalId },
        update: { schoolId: canonicalId, alias },
      });
    } else {
      await prisma.companyAlias.upsert({
        where: { normalizedAlias },
        create: { alias, normalizedAlias, companyId: canonicalId },
        update: { companyId: canonicalId, alias },
      });
    }

    return res.json({ message: "Alias saved." });
  } catch (error) {
    console.error("adminAddAlias error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const adminReassignAlias = async (req: Request, res: Response) => {
  try {
    const type = parseEntityType(req.params.type);
    if (!type) {
      return res.status(400).json({ error: "Invalid entity type." });
    }

    const canonicalId = String(req.body?.canonicalId || "").trim();
    if (!canonicalId) {
      return res.status(400).json({ error: "canonicalId is required." });
    }

    if (type === "school") {
      await prisma.schoolAlias.update({ where: { id: req.params.aliasId }, data: { schoolId: canonicalId } });
      return res.json({ message: "Alias reassigned." });
    }

    await prisma.companyAlias.update({ where: { id: req.params.aliasId }, data: { companyId: canonicalId } });
    return res.json({ message: "Alias reassigned." });
  } catch (error) {
    console.error("adminReassignAlias error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const adminMergeEntities = async (req: Request, res: Response) => {
  try {
    const type = parseEntityType(req.params.type);
    if (!type) {
      return res.status(400).json({ error: "Invalid entity type." });
    }

    const sourceId = String(req.body?.sourceId || "").trim();
    const targetId = String(req.body?.targetId || "").trim();

    if (!sourceId || !targetId || sourceId === targetId) {
      return res.status(400).json({ error: "sourceId and targetId are required and must be different." });
    }

    if (type === "school") {
      await prisma.$transaction(async (tx) => {
        const source = await tx.school.findUnique({ where: { id: sourceId }, include: { aliases: true } });
        const target = await tx.school.findUnique({ where: { id: targetId } });
        if (!source || !target) throw new Error("School not found.");

        await tx.schoolAlias.upsert({
          where: { normalizedAlias: source.normalizedName },
          create: { alias: source.name, normalizedAlias: source.normalizedName, schoolId: targetId },
          update: { schoolId: targetId },
        });

        for (const alias of source.aliases) {
          await tx.schoolAlias.upsert({
            where: { normalizedAlias: alias.normalizedAlias },
            create: { alias: alias.alias, normalizedAlias: alias.normalizedAlias, schoolId: targetId },
            update: { schoolId: targetId },
          });
        }

        await tx.userProfile.updateMany({
          where: { schoolEntityId: sourceId },
          data: { schoolEntityId: targetId, school: target.name },
        });

        await tx.school.update({
          where: { id: targetId },
          data: { usageCount: { increment: source.usageCount } },
        });

        await tx.schoolAlias.deleteMany({ where: { schoolId: sourceId } });
        await tx.school.delete({ where: { id: sourceId } });
      });

      return res.json({ message: "Schools merged." });
    }

    await prisma.$transaction(async (tx) => {
      const source = await tx.company.findUnique({ where: { id: sourceId }, include: { aliases: true } });
      const target = await tx.company.findUnique({ where: { id: targetId } });
      if (!source || !target) throw new Error("Company not found.");

      await tx.companyAlias.upsert({
        where: { normalizedAlias: source.normalizedName },
        create: { alias: source.name, normalizedAlias: source.normalizedName, companyId: targetId },
        update: { companyId: targetId },
      });

      for (const alias of source.aliases) {
        await tx.companyAlias.upsert({
          where: { normalizedAlias: alias.normalizedAlias },
          create: { alias: alias.alias, normalizedAlias: alias.normalizedAlias, companyId: targetId },
          update: { companyId: targetId },
        });
      }

      await tx.userProfile.updateMany({
        where: { companyId: sourceId },
        data: {
          companyId: targetId,
          originalCompanyInput: target.name,
        },
      });

      await tx.company.update({
        where: { id: targetId },
        data: { usageCount: { increment: source.usageCount } },
      });

      await tx.companyAlias.deleteMany({ where: { companyId: sourceId } });
      await tx.company.delete({ where: { id: sourceId } });
    });

    return res.json({ message: "Companies merged." });
  } catch (error) {
    console.error("adminMergeEntities error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error." });
  }
};
