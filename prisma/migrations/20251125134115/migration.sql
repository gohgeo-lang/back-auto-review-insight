-- AlterTable
ALTER TABLE "Summary" ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sentiment" TEXT NOT NULL DEFAULT 'irrelevant';
