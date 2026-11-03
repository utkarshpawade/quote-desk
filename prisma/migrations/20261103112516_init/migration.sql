-- Trigram search for past quotes (similar-part lookup).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ESTIMATOR', 'SALES_HEAD');

-- CreateEnum
CREATE TYPE "Segment" AS ENUM ('TWO_WHEELER', 'TRACTOR', 'DRIVETRAIN', 'TIER1', 'OFF_HIGHWAY', 'COMMERCIAL_VEHICLE');

-- CreateEnum
CREATE TYPE "MarginBasis" AS ENUM ('MFG_COST', 'CONVERSION');

-- CreateEnum
CREATE TYPE "GstClass" AS ENUM ('GST_18', 'GST_5');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('ESTIMATING', 'IN_APPROVAL', 'APPROVED', 'SENT', 'WON', 'LOST', 'REGRETTED');

-- CreateEnum
CREATE TYPE "CloseReason" AS ENUM ('PRICE', 'LEAD_TIME', 'TECHNICAL', 'LATE_REPLY', 'CUSTOMER_CANCELLED', 'INCUMBENT_RETAINED', 'CAPACITY', 'OTHER');

-- CreateEnum
CREATE TYPE "RateCategory" AS ENUM ('MATERIAL', 'SCRAP', 'BOP', 'MACHINE', 'PROCESS', 'PACKING', 'FREIGHT', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('PER_KG', 'PER_HOUR', 'PER_PIECE', 'PERCENT', 'RUPEES', 'COUNT', 'DAYS');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'IN_APPROVAL', 'APPROVED', 'SENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ToolingMode" AS ENUM ('NONE', 'SEPARATE', 'AMORTIZED');

-- CreateEnum
CREATE TYPE "OperationKind" AS ENUM ('MACHINE', 'PROCESS_KG', 'PROCESS_PC', 'BOP');

-- CreateEnum
CREATE TYPE "WeightBasis" AS ENUM ('GROSS', 'FORGED', 'NET');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('EXTRACTING', 'REVIEW', 'COMPLETED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('EMAIL', 'PASTED_TEXT', 'EXCEL', 'DRAWING_PDF', 'DRAWING_IMAGE');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'NO_TEXT', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractionMode" AS ENUM ('AI', 'RULES', 'PARSER');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "FieldStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DecidedVia" AS ENUM ('SINGLE', 'COLUMN', 'AGREED', 'EDITED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('RFQ_EMAIL', 'PART_LIST', 'DRAWING', 'QUOTE_PDF', 'IMPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "FileAction" AS ENUM ('VIEW', 'DOWNLOAD', 'AI_EXTRACT');

-- CreateEnum
CREATE TYPE "PastQuoteSource" AS ENUM ('LEGACY_IMPORT', 'APP');

-- CreateEnum
CREATE TYPE "QuoteOutcome" AS ENUM ('WON', 'LOST', 'NO_RESPONSE', 'OPEN', 'REGRETTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segment" "Segment" NOT NULL,
    "city" TEXT NOT NULL,
    "emailDomain" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "paymentTerms" TEXT NOT NULL,
    "marginBasis" "MarginBasis" NOT NULL DEFAULT 'MFG_COST',
    "aiAllowed" BOOLEAN NOT NULL DEFAULT true,
    "freightItemId" TEXT,
    "packingItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerRef" TEXT,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "dueDate" DATE NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'ESTIMATING',
    "closeReason" "CloseReason",
    "closeNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqPart" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "partNo" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "drawingNo" TEXT,
    "drawingRev" TEXT,
    "materialText" TEXT,
    "materialItemId" TEXT,
    "grossWeightKg" DECIMAL(10,3),
    "forgedWeightKg" DECIMAL(10,3),
    "netWeightKg" DECIMAL(10,3),
    "annualVolume" INTEGER,
    "heatTreatment" TEXT,
    "surfaceTreatment" TEXT,
    "processHints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gstClass" "GstClass" NOT NULL DEFAULT 'GST_18',
    "hsnCode" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RfqPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateItem" (
    "id" TEXT NOT NULL,
    "category" "RateCategory" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "RateUnit" NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateVersion" (
    "id" TEXT NOT NULL,
    "rateItemId" TEXT NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "RateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "basisDate" DATE NOT NULL,
    "basisReason" TEXT,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "marginBasis" "MarginBasis" NOT NULL DEFAULT 'MFG_COST',
    "approvalValue" DECIMAL(16,2),
    "requiresApproval" BOOLEAN,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "returnedPartIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteParam" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rateVersionId" TEXT NOT NULL,

    CONSTRAINT "QuoteParam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "rfqPartId" TEXT NOT NULL,
    "grossWeightKg" DECIMAL(10,3),
    "forgedWeightKg" DECIMAL(10,3),
    "netWeightKg" DECIMAL(10,3),
    "scaleLossPct" DECIMAL(6,3),
    "materialVersionId" TEXT,
    "scrapVersionId" TEXT,
    "flashScrapVersionId" TEXT,
    "packingVersionId" TEXT,
    "freightVersionId" TEXT,
    "rejectionPct" DECIMAL(6,3) NOT NULL,
    "batchesPerYear" INTEGER NOT NULL,
    "gstClass" "GstClass" NOT NULL DEFAULT 'GST_18',
    "toolingMode" "ToolingMode" NOT NULL DEFAULT 'NONE',
    "toolingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "toolingAmortYears" INTEGER,
    "toolingNote" TEXT,
    "routingConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "costingStartedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteOperation" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "OperationKind" NOT NULL,
    "rateVersionId" TEXT,
    "legacyName" TEXT,
    "cycleTimeMin" DECIMAL(8,3),
    "setupMin" DECIMAL(8,3),
    "weightBasis" "WeightBasis",
    "quantity" DECIMAL(10,3),
    "suggestedFromId" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QuoteOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteTier" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "volume" INTEGER NOT NULL,
    "marginPct" DECIMAL(6,3) NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuoteTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeSession" (
    "id" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'EXTRACTING',
    "rfqId" TEXT,
    "createdById" TEXT NOT NULL,
    "aiModel" TEXT,
    "fallbackReason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStartedAt" TIMESTAMP(3),
    "reviewCompletedAt" TIMESTAMP(3),

    CONSTRAINT "IntakeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeSource" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "SourceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "fileId" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "mode" "ExtractionMode",
    "model" TEXT,
    "error" TEXT,
    "text" TEXT,
    "sentChars" INTEGER,
    "sentSha256" TEXT,
    "cachedAt" TIMESTAMP(3),
    "meta" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedField" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "partKey" TEXT NOT NULL DEFAULT '',
    "partLabel" TEXT,
    "fieldKey" TEXT NOT NULL,
    "proposedValue" TEXT,
    "candidates" JSONB NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "reason" TEXT,
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "status" "FieldStatus" NOT NULL DEFAULT 'PENDING',
    "finalValue" TEXT,
    "decidedVia" "DecidedVia",
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExtractedField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldProvenance" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "rfqPartId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceKind" "SourceKind" NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "locator" TEXT,
    "evidence" TEXT,
    "confidence" "Confidence" NOT NULL,
    "decidedVia" "DecidedVia" NOT NULL,
    "proposedValue" TEXT,
    "extractedFieldId" TEXT,
    "acceptedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiExtractionCache" (
    "key" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiExtractionCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT,
    "kind" "FileKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAccess" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "FileAction" NOT NULL,
    "ip" TEXT,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PastQuote" (
    "id" TEXT NOT NULL,
    "source" "PastQuoteSource" NOT NULL,
    "refNo" TEXT NOT NULL,
    "quoteDate" DATE NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerId" TEXT,
    "partNo" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "materialText" TEXT,
    "materialItemId" TEXT,
    "inputForm" TEXT,
    "shapeFamily" TEXT,
    "grossWeightKg" DECIMAL(10,3),
    "netWeightKg" DECIMAL(10,3),
    "annualVolume" INTEGER,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "outcome" "QuoteOutcome" NOT NULL,
    "lostReason" TEXT,
    "estimatorName" TEXT,
    "routingText" TEXT,
    "routingOps" JSONB,
    "quoteLineId" TEXT,
    "importBatchId" TEXT,
    "searchText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PastQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL,
    "rowsImported" INTEGER NOT NULL,
    "rowsSkipped" INTEGER NOT NULL,
    "rowsFailed" INTEGER NOT NULL,
    "issues" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "rfqId" TEXT,
    "quoteId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pdfFileId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_at_idx" ON "LoginAttempt"("email", "at");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_at_idx" ON "LoginAttempt"("ip", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_emailDomain_key" ON "Customer"("emailDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_number_key" ON "Rfq"("number");

-- CreateIndex
CREATE INDEX "Rfq_status_dueDate_idx" ON "Rfq"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Rfq_ownerId_idx" ON "Rfq"("ownerId");

-- CreateIndex
CREATE INDEX "Rfq_customerId_idx" ON "Rfq"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqPart_rfqId_lineNo_key" ON "RfqPart"("rfqId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "RateItem_code_key" ON "RateItem"("code");

-- CreateIndex
CREATE INDEX "RateItem_category_sortOrder_idx" ON "RateItem"("category", "sortOrder");

-- CreateIndex
CREATE INDEX "RateVersion_rateItemId_effectiveFrom_idx" ON "RateVersion"("rateItemId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RateVersion_live_item_date_key" ON "RateVersion"("rateItemId", "effectiveFrom") WHERE ("voidedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_rfqId_revision_key" ON "Quote"("rfqId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteParam_quoteId_key_key" ON "QuoteParam"("quoteId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteSnapshot_quoteId_seq_key" ON "QuoteSnapshot"("quoteId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_rfqPartId_key" ON "QuoteLine"("quoteId", "rfqPartId");

-- CreateIndex
CREATE INDEX "QuoteOperation_lineId_seq_idx" ON "QuoteOperation"("lineId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteTier_lineId_sortOrder_key" ON "QuoteTier"("lineId", "sortOrder");

-- CreateIndex
CREATE INDEX "IntakeSession_status_createdAt_idx" ON "IntakeSession"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeSource_sessionId_idx" ON "IntakeSource"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedField_sessionId_partKey_fieldKey_key" ON "ExtractedField"("sessionId", "partKey", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "FieldProvenance_extractedFieldId_key" ON "FieldProvenance"("extractedFieldId");

-- CreateIndex
CREATE INDEX "FieldProvenance_rfqId_idx" ON "FieldProvenance"("rfqId");

-- CreateIndex
CREATE INDEX "FieldProvenance_rfqPartId_idx" ON "FieldProvenance"("rfqPartId");

-- CreateIndex
CREATE INDEX "StoredFile_rfqId_idx" ON "StoredFile"("rfqId");

-- CreateIndex
CREATE INDEX "StoredFile_uploadedById_createdAt_idx" ON "StoredFile"("uploadedById", "createdAt");

-- CreateIndex
CREATE INDEX "FileAccess_fileId_at_idx" ON "FileAccess"("fileId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "PastQuote_quoteLineId_key" ON "PastQuote"("quoteLineId");

-- CreateIndex
CREATE INDEX "PastQuote_quoteDate_idx" ON "PastQuote"("quoteDate");

-- CreateIndex
CREATE INDEX "PastQuote_materialItemId_idx" ON "PastQuote"("materialItemId");

-- CreateIndex
CREATE INDEX "PastQuote_searchText_trgm_idx" ON "PastQuote" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "PastQuote_source_refNo_partNo_key" ON "PastQuote"("source", "refNo", "partNo");

-- CreateIndex
CREATE INDEX "AuditEvent_rfqId_at_idx" ON "AuditEvent"("rfqId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_freightItemId_fkey" FOREIGN KEY ("freightItemId") REFERENCES "RateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_packingItemId_fkey" FOREIGN KEY ("packingItemId") REFERENCES "RateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqPart" ADD CONSTRAINT "RfqPart_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqPart" ADD CONSTRAINT "RfqPart_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "RateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateVersion" ADD CONSTRAINT "RateVersion_rateItemId_fkey" FOREIGN KEY ("rateItemId") REFERENCES "RateItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateVersion" ADD CONSTRAINT "RateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateVersion" ADD CONSTRAINT "RateVersion_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteParam" ADD CONSTRAINT "QuoteParam_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteParam" ADD CONSTRAINT "QuoteParam_rateVersionId_fkey" FOREIGN KEY ("rateVersionId") REFERENCES "RateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_rfqPartId_fkey" FOREIGN KEY ("rfqPartId") REFERENCES "RfqPart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_materialVersionId_fkey" FOREIGN KEY ("materialVersionId") REFERENCES "RateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_scrapVersionId_fkey" FOREIGN KEY ("scrapVersionId") REFERENCES "RateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_flashScrapVersionId_fkey" FOREIGN KEY ("flashScrapVersionId") REFERENCES "RateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_packingVersionId_fkey" FOREIGN KEY ("packingVersionId") REFERENCES "RateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_freightVersionId_fkey" FOREIGN KEY ("freightVersionId") REFERENCES "RateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteOperation" ADD CONSTRAINT "QuoteOperation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "QuoteLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteOperation" ADD CONSTRAINT "QuoteOperation_rateVersionId_fkey" FOREIGN KEY ("rateVersionId") REFERENCES "RateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteOperation" ADD CONSTRAINT "QuoteOperation_suggestedFromId_fkey" FOREIGN KEY ("suggestedFromId") REFERENCES "PastQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteTier" ADD CONSTRAINT "QuoteTier_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "QuoteLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSession" ADD CONSTRAINT "IntakeSession_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSession" ADD CONSTRAINT "IntakeSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSource" ADD CONSTRAINT "IntakeSource_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IntakeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSource" ADD CONSTRAINT "IntakeSource_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "IntakeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSource" ADD CONSTRAINT "IntakeSource_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IntakeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_rfqPartId_fkey" FOREIGN KEY ("rfqPartId") REFERENCES "RfqPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_extractedFieldId_fkey" FOREIGN KEY ("extractedFieldId") REFERENCES "ExtractedField"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAccess" ADD CONSTRAINT "FileAccess_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAccess" ADD CONSTRAINT "FileAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastQuote" ADD CONSTRAINT "PastQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastQuote" ADD CONSTRAINT "PastQuote_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "RateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastQuote" ADD CONSTRAINT "PastQuote_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "QuoteLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastQuote" ADD CONSTRAINT "PastQuote_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Integrity guards Prisma cannot express ───────────────────────────────────

-- Audit events and frozen quote snapshots are append-only.
CREATE OR REPLACE FUNCTION qd_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION qd_forbid_change();

CREATE TRIGGER "QuoteSnapshot_append_only"
  BEFORE UPDATE OR DELETE ON "QuoteSnapshot"
  FOR EACH ROW EXECUTE FUNCTION qd_forbid_change();

-- Rate versions never change value or date; the only permitted update is voiding a live version.
CREATE OR REPLACE FUNCTION qd_rate_version_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."value" IS DISTINCT FROM OLD."value"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
     OR NEW."rateItemId" IS DISTINCT FROM OLD."rateItemId" THEN
    RAISE EXCEPTION 'Rate versions are immutable: void this version and add a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A voided rate version cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RateVersion_immutable"
  BEFORE UPDATE ON "RateVersion"
  FOR EACH ROW EXECUTE FUNCTION qd_rate_version_guard();
