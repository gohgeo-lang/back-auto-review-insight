import { prisma } from "../src/lib/prisma";

async function main() {
  const deleted = await prisma.summary.deleteMany({
    where: {
      summary: { equals: "" },
      positives: { equals: [] },
      negatives: { equals: [] },
      insights: { equals: [] },
      tags: { equals: [] },
      keywords: { equals: [] },
    },
  });

  console.log(`🧹 Deleted empty summaries: ${deleted.count}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
