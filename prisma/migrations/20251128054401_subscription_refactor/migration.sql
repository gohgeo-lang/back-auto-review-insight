-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "lastCrawledAt" TIMESTAMP(3),
ADD COLUMN     "lastReviewCursor" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extraCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastBilledAt" TIMESTAMP(3),
ADD COLUMN     "nextBillingAt" TIMESTAMP(3),
ADD COLUMN     "storeQuota" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "subscriptionStatus" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "subscriptionTier" TEXT DEFAULT 'base',
ALTER COLUMN "plan" DROP NOT NULL,
ALTER COLUMN "plan" DROP DEFAULT;
