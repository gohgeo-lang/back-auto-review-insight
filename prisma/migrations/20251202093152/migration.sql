-- CreateTable
CREATE TABLE "BatchSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT,
    "reviewIds" TEXT[],
    "batchSummary" TEXT,
    "batchKeywords" TEXT[],
    "batchPositives" TEXT[],
    "batchNegatives" TEXT[],
    "batchSentimentPos" INTEGER NOT NULL DEFAULT 0,
    "batchSentimentNeu" INTEGER NOT NULL DEFAULT 0,
    "batchSentimentNeg" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchSummary_userId_idx" ON "BatchSummary"("userId");

-- CreateIndex
CREATE INDEX "BatchSummary_storeId_idx" ON "BatchSummary"("storeId");

-- AddForeignKey
ALTER TABLE "BatchSummary" ADD CONSTRAINT "BatchSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSummary" ADD CONSTRAINT "BatchSummary_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
