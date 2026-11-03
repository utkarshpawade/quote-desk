-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "address" TEXT;

-- AlterTable
ALTER TABLE "ExtractedField" ADD COLUMN     "rfqPartId" TEXT;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_rfqPartId_fkey" FOREIGN KEY ("rfqPartId") REFERENCES "RfqPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;
