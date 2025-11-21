/*
  Warnings:

  - A unique constraint covering the columns `[reviewId]` on the table `Review` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `reviewId` to the `Review` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "reviewId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Review_reviewId_key" ON "Review"("reviewId");
