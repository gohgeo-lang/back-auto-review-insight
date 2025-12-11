import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

// 세션 모드에서 연결 초과를 줄이기 위해 기본적으로 pgbouncer 플래그/connection_limit를 붙인다.
function buildSafeUrl(raw?: string) {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    // 이미 설정되어 있으면 그대로 유지
    if (!u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
    if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "1");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "10");
    return u.toString();
  } catch {
    return raw;
  }
}

const datasourceUrl = buildSafeUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
    datasources: { db: { url: datasourceUrl } },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
