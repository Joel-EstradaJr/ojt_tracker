import { CanonicalStatus, Prisma, PrismaClient } from "@prisma/client";

const MAX_FUZZY_DISTANCE = 2;
const MIN_FUZZY_SCORE = 0.84;

type EntityType = "school" | "company";

type ResolveEntityOptions = {
  input: string;
  actorUserId?: string | null;
  autoApprove?: boolean;
};

type ResolveEntityResult = {
  id: string;
  canonicalName: string;
  originalInput: string;
  source: "exact" | "alias" | "fuzzy" | "new";
};

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeEntityInput(input: string): string {
  const collapsed = collapseSpaces(String(input || ""));
  if (!collapsed) return "";

  const punctuationReduced = collapsed
    .replace(/[.,/#!$%^&*;:{}=_`~()\[\]"'+?<>\\|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return punctuationReduced.toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function fuzzyScore(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length, 1);
  return 1 - levenshtein(a, b) / maxLength;
}

function isStrongFuzzyMatch(inputNormalized: string, candidateNormalized: string): boolean {
  const distance = levenshtein(inputNormalized, candidateNormalized);
  if (distance <= MAX_FUZZY_DISTANCE) return true;
  return fuzzyScore(inputNormalized, candidateNormalized) >= MIN_FUZZY_SCORE;
}

async function createSchoolAlias(tx: Prisma.TransactionClient, alias: string, schoolId: string): Promise<void> {
  const normalizedAlias = normalizeEntityInput(alias);
  if (!normalizedAlias) return;

  await tx.schoolAlias.upsert({
    where: { normalizedAlias },
    create: { alias: collapseSpaces(alias), normalizedAlias, schoolId },
    update: { schoolId },
  });
}

async function createCompanyAlias(tx: Prisma.TransactionClient, alias: string, companyId: string): Promise<void> {
  const normalizedAlias = normalizeEntityInput(alias);
  if (!normalizedAlias) return;

  await tx.companyAlias.upsert({
    where: { normalizedAlias },
    create: { alias: collapseSpaces(alias), normalizedAlias, companyId },
    update: { companyId },
  });
}

async function resolveSchool(tx: Prisma.TransactionClient, options: ResolveEntityOptions): Promise<ResolveEntityResult> {
  const originalInput = collapseSpaces(options.input || "");
  const normalized = normalizeEntityInput(originalInput);

  if (!normalized) {
    throw new Error("School is required.");
  }

  const existingCanonical = await tx.school.findUnique({ where: { normalizedName: normalized } });
  if (existingCanonical) {
    await tx.school.update({ where: { id: existingCanonical.id }, data: { usageCount: { increment: 1 } } });

    if (normalizeEntityInput(existingCanonical.name) !== normalized) {
      await createSchoolAlias(tx, originalInput, existingCanonical.id);
    }

    return {
      id: existingCanonical.id,
      canonicalName: existingCanonical.name,
      originalInput,
      source: "exact",
    };
  }

  const aliasMatch = await tx.schoolAlias.findUnique({
    where: { normalizedAlias: normalized },
    include: { school: true },
  });

  if (aliasMatch?.school) {
    await tx.school.update({ where: { id: aliasMatch.school.id }, data: { usageCount: { increment: 1 } } });
    return {
      id: aliasMatch.school.id,
      canonicalName: aliasMatch.school.name,
      originalInput,
      source: "alias",
    };
  }

  const candidates = await tx.school.findMany({
    where: { status: { not: CanonicalStatus.REJECTED } },
    select: { id: true, name: true, normalizedName: true },
    take: 100,
  });

  const fuzzyMatch = candidates.find((candidate) => isStrongFuzzyMatch(normalized, candidate.normalizedName));
  if (fuzzyMatch) {
    await tx.school.update({ where: { id: fuzzyMatch.id }, data: { usageCount: { increment: 1 } } });
    await createSchoolAlias(tx, originalInput, fuzzyMatch.id);

    return {
      id: fuzzyMatch.id,
      canonicalName: fuzzyMatch.name,
      originalInput,
      source: "fuzzy",
    };
  }

  const created = await tx.school.create({
    data: {
      name: originalInput,
      normalizedName: normalized,
      status: options.autoApprove ? CanonicalStatus.APPROVED : CanonicalStatus.PENDING,
      usageCount: 1,
      reviewedAt: options.autoApprove ? new Date() : null,
      reviewedById: options.autoApprove ? options.actorUserId ?? null : null,
    },
  });

  return {
    id: created.id,
    canonicalName: created.name,
    originalInput,
    source: "new",
  };
}

async function resolveCompany(tx: Prisma.TransactionClient, options: ResolveEntityOptions): Promise<ResolveEntityResult> {
  const originalInput = collapseSpaces(options.input || "");
  const normalized = normalizeEntityInput(originalInput);

  if (!normalized) {
    throw new Error("Company / institution name is required.");
  }

  const existingCanonical = await tx.company.findUnique({ where: { normalizedName: normalized } });
  if (existingCanonical) {
    await tx.company.update({ where: { id: existingCanonical.id }, data: { usageCount: { increment: 1 } } });

    if (normalizeEntityInput(existingCanonical.name) !== normalized) {
      await createCompanyAlias(tx, originalInput, existingCanonical.id);
    }

    return {
      id: existingCanonical.id,
      canonicalName: existingCanonical.name,
      originalInput,
      source: "exact",
    };
  }

  const aliasMatch = await tx.companyAlias.findUnique({
    where: { normalizedAlias: normalized },
    include: { company: true },
  });

  if (aliasMatch?.company) {
    await tx.company.update({ where: { id: aliasMatch.company.id }, data: { usageCount: { increment: 1 } } });
    return {
      id: aliasMatch.company.id,
      canonicalName: aliasMatch.company.name,
      originalInput,
      source: "alias",
    };
  }

  const candidates = await tx.company.findMany({
    where: { status: { not: CanonicalStatus.REJECTED } },
    select: { id: true, name: true, normalizedName: true },
    take: 100,
  });

  const fuzzyMatch = candidates.find((candidate) => isStrongFuzzyMatch(normalized, candidate.normalizedName));
  if (fuzzyMatch) {
    await tx.company.update({ where: { id: fuzzyMatch.id }, data: { usageCount: { increment: 1 } } });
    await createCompanyAlias(tx, originalInput, fuzzyMatch.id);

    return {
      id: fuzzyMatch.id,
      canonicalName: fuzzyMatch.name,
      originalInput,
      source: "fuzzy",
    };
  }

  const created = await tx.company.create({
    data: {
      name: originalInput,
      normalizedName: normalized,
      status: options.autoApprove ? CanonicalStatus.APPROVED : CanonicalStatus.PENDING,
      usageCount: 1,
      reviewedAt: options.autoApprove ? new Date() : null,
      reviewedById: options.autoApprove ? options.actorUserId ?? null : null,
    },
  });

  return {
    id: created.id,
    canonicalName: created.name,
    originalInput,
    source: "new",
  };
}

export async function resolveCanonicalEntities(
  prisma: PrismaClient,
  params: {
    schoolInput: string;
    companyInput: string;
    actorUserId?: string | null;
    autoApprove?: boolean;
  }
): Promise<{
  school: ResolveEntityResult;
  company: ResolveEntityResult;
}> {
  return prisma.$transaction(async (tx) => {
    const school = await resolveSchool(tx, {
      input: params.schoolInput,
      actorUserId: params.actorUserId,
      autoApprove: params.autoApprove,
    });

    const company = await resolveCompany(tx, {
      input: params.companyInput,
      actorUserId: params.actorUserId,
      autoApprove: params.autoApprove,
    });

    return { school, company };
  });
}

export async function resolveSchoolCanonical(
  prisma: PrismaClient,
  params: ResolveEntityOptions
): Promise<ResolveEntityResult> {
  return prisma.$transaction(async (tx) => resolveSchool(tx, params));
}

export async function resolveCompanyCanonical(
  prisma: PrismaClient,
  params: ResolveEntityOptions
): Promise<ResolveEntityResult> {
  return prisma.$transaction(async (tx) => resolveCompany(tx, params));
}

export async function searchCanonicalEntities(
  prisma: PrismaClient,
  type: EntityType,
  query: string
): Promise<Array<{ id: string; name: string; usageCount: number }>> {
  const normalized = normalizeEntityInput(query);
  const prefix = collapseSpaces(query).trim();

  if (!prefix) return [];

  if (type === "school") {
    const rows = await prisma.school.findMany({
      where: {
        status: CanonicalStatus.APPROVED,
        OR: [
          { name: { startsWith: prefix, mode: "insensitive" } },
          { normalizedName: { startsWith: normalized } },
          { aliases: { some: { alias: { startsWith: prefix, mode: "insensitive" } } } },
        ],
      },
      orderBy: [{ usageCount: "desc" }, { name: "asc" }],
      select: { id: true, name: true, usageCount: true },
    });

    return rows;
  }

  const rows = await prisma.company.findMany({
    where: {
      status: CanonicalStatus.APPROVED,
      OR: [
        { name: { startsWith: prefix, mode: "insensitive" } },
        { normalizedName: { startsWith: normalized } },
        { aliases: { some: { alias: { startsWith: prefix, mode: "insensitive" } } } },
      ],
    },
    orderBy: [{ usageCount: "desc" }, { name: "asc" }],
    select: { id: true, name: true, usageCount: true },
  });

  return rows;
}
