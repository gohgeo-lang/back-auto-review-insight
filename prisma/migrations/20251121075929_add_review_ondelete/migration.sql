/*
  Warnings:

  - You are about to drop the column `placeId` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `reviewId` on the `Review` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Reply" DROP CONSTRAINT "Reply_reviewId_fkey";

-- DropForeignKey
ALTER TABLE "Summary" DROP CONSTRAINT "Summary_reviewId_fkey";

-- DropIndex
DROP INDEX "Review_reviewId_key";

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "placeId",
DROP COLUMN "reviewId";

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
