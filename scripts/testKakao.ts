/**
 * Kakao Maps 리뷰 수집 테스트 스크립트 (DOM 크롤러)
 * 실행 예시:
 *   npx ts-node scripts/testKakao.ts <placeId> [storeId]
 *
 * placeId 예: 8401632
 */
import { fetchKakaoReviews } from "../src/crawler/kakao";
import { prisma } from "../src/lib/prisma";

async function main() {
  const placeId = process.argv[2];
  const storeId = process.argv[3];
  if (!placeId) {
    console.error("❌ placeId 필요: npx ts-node scripts/testKakao.ts <placeId> [storeId]");
    process.exit(1);
  }

  // 테스트용 유저 확보 (없으면 생성)
  const userId = process.env.TEST_USER_ID || "test-user";
  const email = `${userId}@example.com`;
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, email, password: "dummy", subscriptionStatus: "free", subscriptionTier: "base" },
    update: {},
  });

  console.log(`▶️ 카카오 리뷰 수집 시작: ${placeId} (userId=${userId}, storeId=${storeId || "-"})`);
  const result = await fetchKakaoReviews(placeId, userId, storeId, 300);
  console.log("✅ 저장된 리뷰 수:", result.count);
  console.log("📝 로그:", result.logs);
}

main()
  .catch((err) => {
    console.error("❌ 에러:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
