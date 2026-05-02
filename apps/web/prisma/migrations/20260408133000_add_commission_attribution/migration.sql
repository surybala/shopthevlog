ALTER TABLE "Commission"
ADD COLUMN "attributedTripKitId" TEXT,
ADD COLUMN "attributionMethod" TEXT;

ALTER TABLE "Commission"
ADD CONSTRAINT "Commission_attributedTripKitId_fkey"
FOREIGN KEY ("attributedTripKitId") REFERENCES "TripKit"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Commission_attributedTripKitId_idx" ON "Commission"("attributedTripKitId");
