-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "authzVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LoanFamily" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LoanFamily_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ProductTemplate" (
    "code" TEXT NOT NULL,
    "familyCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultConfig" JSONB NOT NULL,
    "extraCapabilities" TEXT[],
    "phase1Slice" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTemplate_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "AccessPermission" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "financial" BOOLEAN NOT NULL DEFAULT false,
    "platformAllowed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AccessPermission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "defaultEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformFlagRule" (
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFlagRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'KH',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantBusinessDate" (
    "tenantId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBusinessDate_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "HolidayCalendar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weekendDays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "allBranches" BOOLEAN NOT NULL DEFAULT false,
    "branchIds" TEXT[],
    "portfolioIds" TEXT[],
    "legalEntityIds" TEXT[],
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "permissions" TEXT[],
    "maxAmount" DECIMAL(24,4),
    "currency" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAuthority" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT,
    "userId" TEXT,
    "permission" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "maxAmount" DECIMAL(24,4) NOT NULL,
    "familyCode" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeValue" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlagRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagChangeApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlagChangeApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CohortMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cohortCode" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CohortMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LendingProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "familyCode" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LendingProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "requiredCapabilities" TEXT[],
    "engineVersion" TEXT NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "changeSummary" TEXT NOT NULL DEFAULT '',
    "makerId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "checkerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingConfiguration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "interestMethod" TEXT NOT NULL,
    "rateConvention" TEXT NOT NULL,
    "accrualBasis" TEXT NOT NULL,
    "dayCount" TEXT NOT NULL,
    "defaultAnnualRate" DECIMAL(18,10),
    "payload" JSONB NOT NULL,

    CONSTRAINT "PricingConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepaymentConfiguration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "frequency" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "RepaymentConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateObservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "benchmarkCode" TEXT NOT NULL,
    "observationDate" DATE NOT NULL,
    "rate" DECIMAL(18,10) NOT NULL,
    "source" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowerGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorrowerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "legalEntityId" TEXT,
    "borrowerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "segmentCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "requestedAmount" DECIMAL(24,4) NOT NULL,
    "terms" JSONB NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "assessment" JSONB NOT NULL,
    "policyDecision" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requiredPermission" TEXT NOT NULL,
    "amount" DECIMAL(24,4),
    "currency" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionPrecedent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OUTSTANDING',
    "evidence" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ConditionPrecedent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollateralAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollateralAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Valuation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "collateralId" TEXT NOT NULL,
    "valuationDate" DATE NOT NULL,
    "marketValue" DECIMAL(24,4) NOT NULL,
    "valuer" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Valuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollateralPledge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "collateralId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollateralPledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guarantee" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "guarantorName" TEXT NOT NULL,
    "guarantorBorrowerId" TEXT,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guarantee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "limitAmount" DECIMAL(24,4) NOT NULL,
    "maturityDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drawdown" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "valueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Drawdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LendingAgreement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LendingAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "productConfig" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "scheduleInput" JSONB NOT NULL,
    "calculation" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "legalEntityId" TEXT,
    "productId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "familyCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "bookedPrincipal" DECIMAL(24,4) NOT NULL,
    "principalOutstanding" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "interestReceivable" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "feesReceivable" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "penaltyReceivable" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "instalmentAmount" DECIMAL(24,4),
    "daysPastDue" INTEGER NOT NULL DEFAULT 0,
    "delinquencyBucket" TEXT NOT NULL DEFAULT 'CURRENT',
    "collectionStage" TEXT,
    "disbursementDate" DATE,
    "maturityDate" DATE,
    "lastAccrualDate" DATE,
    "closedAt" TIMESTAMP(3),
    "writtenOffAt" TIMESTAMP(3),
    "isRestructured" BOOLEAN NOT NULL DEFAULT false,
    "restructureCount" INTEGER NOT NULL DEFAULT 0,
    "lastRestructuredAt" TIMESTAMP(3),
    "delinquencyFloorBucket" TEXT,
    "delinquencyFloorDpd" INTEGER,
    "probationRemaining" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleInstalment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "openingPrincipal" DECIMAL(24,4) NOT NULL,
    "principalDue" DECIMAL(24,4) NOT NULL,
    "interestDue" DECIMAL(24,4) NOT NULL,
    "capitalizedInterest" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "feeDue" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "taxDue" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "penaltyDue" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "principalPaid" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "interestPaid" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "feePaid" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "taxPaid" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "penaltyPaid" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "deferredInterestDue" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "accruedAtClose" DECIMAL(24,4),
    "annualRate" DECIMAL(18,10) NOT NULL,
    "projected" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "penaltyAssessedThrough" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleInstalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccrualEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "financialEventId" TEXT NOT NULL,
    "accrualDate" DATE NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccrualEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "businessDate" DATE NOT NULL,
    "valueDate" DATE NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "productVersionId" TEXT NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "externalReference" TEXT,
    "narrative" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "financialEventId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "instalmentNumber" INTEGER NOT NULL,
    "component" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LendingJournalEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "financialEventId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LendingJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LendingJournalLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "debit" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(24,4) NOT NULL DEFAULT 0,

    CONSTRAINT "LendingJournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffordabilityPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffordabilityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestructureCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "trigger" TEXT NOT NULL,
    "initiatorType" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "hardshipCategory" TEXT NOT NULL,
    "difficultyType" TEXT NOT NULL,
    "customerStatement" TEXT NOT NULL DEFAULT '',
    "requestedRelief" JSONB NOT NULL,
    "consentRecorded" BOOLEAN NOT NULL DEFAULT false,
    "consentReference" TEXT,
    "expectedRecoveryDate" DATE,
    "previousRestructures" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "specialistReview" BOOLEAN NOT NULL DEFAULT false,
    "outcomeNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestructureCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestructureEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "documentRef" TEXT,
    "providedBy" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestructureEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffordabilityAssessment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "policySettings" JSONB NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "evidenceQuality" TEXT NOT NULL,
    "assumptions" TEXT NOT NULL,
    "verificationDate" DATE NOT NULL,
    "assessorId" TEXT NOT NULL,
    "comments" TEXT NOT NULL DEFAULT '',
    "sustainable" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffordabilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestructureProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "effectiveDate" DATE NOT NULL,
    "options" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "calculation" JSONB NOT NULL,
    "comparison" JSONB NOT NULL,
    "concessions" JSONB NOT NULL,
    "policyExceptions" JSONB NOT NULL,
    "requiredFlags" TEXT[],
    "approvalsRequired" INTEGER NOT NULL DEFAULT 1,
    "proposalHash" TEXT NOT NULL,
    "assessmentId" TEXT,
    "proposedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestructureProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestructureApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestructureApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestructureAcceptance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "acceptedByType" TEXT NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "proposalHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestructureAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestructureCondition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'OUTSTANDING',
    "evidence" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RestructureCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestructureReviewTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detail" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestructureReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAmendment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "fromAgreementVersion" INTEGER NOT NULL,
    "toAgreementVersion" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "beforeSnapshot" JSONB NOT NULL,
    "afterSnapshot" JSONB NOT NULL,
    "financialEventId" TEXT NOT NULL,
    "executedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXECUTED',
    "reversalEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "decision" JSONB,
    "details" JSONB,
    "configVersions" JSONB,
    "businessDate" DATE,
    "eventTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformFlagRule_flagKey_status_idx" ON "PlatformFlagRule"("flagKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_tenantId_code_key" ON "LegalEntity"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_tenantId_id_key" ON "LegalEntity"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_tenantId_code_key" ON "Portfolio"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_tenantId_id_key" ON "Portfolio"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayCalendar_tenantId_code_key" ON "HolidayCalendar"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_calendarId_date_key" ON "Holiday"("calendarId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_tenantId_code_key" ON "AccessRole"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_tenantId_id_key" ON "AccessRole"("tenantId", "id");

-- CreateIndex
CREATE INDEX "RoleAssignment_tenantId_userId_status_idx" ON "RoleAssignment"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "Delegation_tenantId_toUserId_status_idx" ON "Delegation"("tenantId", "toUserId", "status");

-- CreateIndex
CREATE INDEX "ApprovalAuthority_tenantId_permission_status_idx" ON "ApprovalAuthority"("tenantId", "permission", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccessPolicy_tenantId_code_key" ON "AccessPolicy"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AccessPolicy_tenantId_id_key" ON "AccessPolicy"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PolicyVersion_tenantId_status_idx" ON "PolicyVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_policyId_version_key" ON "PolicyVersion"("policyId", "version");

-- CreateIndex
CREATE INDEX "FlagRule_tenantId_flagKey_status_idx" ON "FlagRule"("tenantId", "flagKey", "status");

-- CreateIndex
CREATE INDEX "FlagChangeApproval_tenantId_status_idx" ON "FlagChangeApproval"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CohortMembership_tenantId_cohortCode_subjectType_subjectId_key" ON "CohortMembership"("tenantId", "cohortCode", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAccount_keyPrefix_key" ON "ServiceAccount"("keyPrefix");

-- CreateIndex
CREATE INDEX "ServiceAccount_tenantId_idx" ON "ServiceAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_tenantId_code_version_key" ON "WorkflowVersion"("tenantId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LendingProduct_tenantId_code_key" ON "LendingProduct"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LendingProduct_tenantId_id_key" ON "LendingProduct"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ProductVersion_tenantId_status_idx" ON "ProductVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVersion_productId_version_key" ON "ProductVersion"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVersion_tenantId_id_key" ON "ProductVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PricingConfiguration_tenantId_productVersionId_key" ON "PricingConfiguration"("tenantId", "productVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentConfiguration_tenantId_productVersionId_key" ON "RepaymentConfiguration"("tenantId", "productVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RateObservation_tenantId_benchmarkCode_observationDate_key" ON "RateObservation"("tenantId", "benchmarkCode", "observationDate");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowerGroup_tenantId_code_key" ON "BorrowerGroup"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowerGroup_tenantId_id_key" ON "BorrowerGroup"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMembership_groupId_borrowerId_key" ON "GroupMembership"("groupId", "borrowerId");

-- CreateIndex
CREATE INDEX "Application_tenantId_status_idx" ON "Application"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Application_tenantId_branchId_idx" ON "Application"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_tenantId_reference_key" ON "Application"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Application_tenantId_id_key" ON "Application"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ApplicationDocument_tenantId_applicationId_idx" ON "ApplicationDocument"("tenantId", "applicationId");

-- CreateIndex
CREATE INDEX "CreditDecision_tenantId_applicationId_idx" ON "CreditDecision"("tenantId", "applicationId");

-- CreateIndex
CREATE INDEX "ApprovalTask_tenantId_status_subjectType_idx" ON "ApprovalTask"("tenantId", "status", "subjectType");

-- CreateIndex
CREATE INDEX "ApprovalTask_tenantId_subjectType_subjectId_idx" ON "ApprovalTask"("tenantId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionPrecedent_applicationId_code_key" ON "ConditionPrecedent"("applicationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CollateralAsset_tenantId_id_key" ON "CollateralAsset"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Valuation_tenantId_collateralId_idx" ON "Valuation"("tenantId", "collateralId");

-- CreateIndex
CREATE UNIQUE INDEX "CollateralPledge_collateralId_applicationId_key" ON "CollateralPledge"("collateralId", "applicationId");

-- CreateIndex
CREATE INDEX "Guarantee_tenantId_applicationId_idx" ON "Guarantee"("tenantId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_tenantId_id_key" ON "Facility"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LendingAgreement_applicationId_key" ON "LendingAgreement"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "LendingAgreement_tenantId_reference_key" ON "LendingAgreement"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "LendingAgreement_tenantId_id_key" ON "LendingAgreement"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementVersion_agreementId_version_key" ON "AgreementVersion"("agreementId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAccount_agreementId_key" ON "LoanAccount"("agreementId");

-- CreateIndex
CREATE INDEX "LoanAccount_tenantId_status_idx" ON "LoanAccount"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LoanAccount_tenantId_branchId_idx" ON "LoanAccount"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAccount_tenantId_reference_key" ON "LoanAccount"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAccount_tenantId_id_key" ON "LoanAccount"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAccount_tenantId_agreementId_key" ON "LoanAccount"("tenantId", "agreementId");

-- CreateIndex
CREATE INDEX "ScheduleInstalment_tenantId_loanAccountId_status_idx" ON "ScheduleInstalment"("tenantId", "loanAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccrualEvent_financialEventId_key" ON "AccrualEvent"("financialEventId");

-- CreateIndex
CREATE INDEX "AccrualEvent_tenantId_loanAccountId_accrualDate_idx" ON "AccrualEvent"("tenantId", "loanAccountId", "accrualDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEvent_reversalOfId_key" ON "FinancialEvent"("reversalOfId");

-- CreateIndex
CREATE INDEX "FinancialEvent_tenantId_loanAccountId_createdAt_idx" ON "FinancialEvent"("tenantId", "loanAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEvent_tenantId_idempotencyKey_key" ON "FinancialEvent"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEvent_tenantId_id_key" ON "FinancialEvent"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PaymentAllocation_tenantId_financialEventId_idx" ON "PaymentAllocation"("tenantId", "financialEventId");

-- CreateIndex
CREATE UNIQUE INDEX "LendingJournalEntry_financialEventId_key" ON "LendingJournalEntry"("financialEventId");

-- CreateIndex
CREATE INDEX "LendingJournalEntry_tenantId_entryDate_idx" ON "LendingJournalEntry"("tenantId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "LendingJournalEntry_tenantId_id_key" ON "LendingJournalEntry"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LendingJournalEntry_tenantId_financialEventId_key" ON "LendingJournalEntry"("tenantId", "financialEventId");

-- CreateIndex
CREATE INDEX "LendingJournalLine_tenantId_accountCode_idx" ON "LendingJournalLine"("tenantId", "accountCode");

-- CreateIndex
CREATE INDEX "LendingJournalLine_tenantId_loanAccountId_idx" ON "LendingJournalLine"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AffordabilityPolicy_tenantId_version_key" ON "AffordabilityPolicy"("tenantId", "version");

-- CreateIndex
CREATE INDEX "RestructureCase_tenantId_status_idx" ON "RestructureCase"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RestructureCase_tenantId_loanAccountId_idx" ON "RestructureCase"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "RestructureCase_tenantId_reference_key" ON "RestructureCase"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "RestructureCase_tenantId_id_key" ON "RestructureCase"("tenantId", "id");

-- CreateIndex
CREATE INDEX "RestructureEvidence_tenantId_caseId_idx" ON "RestructureEvidence"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "AffordabilityAssessment_tenantId_caseId_idx" ON "AffordabilityAssessment"("tenantId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "RestructureProposal_caseId_version_key" ON "RestructureProposal"("caseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RestructureProposal_tenantId_id_key" ON "RestructureProposal"("tenantId", "id");

-- CreateIndex
CREATE INDEX "RestructureApproval_tenantId_proposalId_idx" ON "RestructureApproval"("tenantId", "proposalId");

-- CreateIndex
CREATE INDEX "RestructureAcceptance_tenantId_proposalId_idx" ON "RestructureAcceptance"("tenantId", "proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "RestructureCondition_caseId_code_key" ON "RestructureCondition"("caseId", "code");

-- CreateIndex
CREATE INDEX "RestructureReviewTask_tenantId_status_dueDate_idx" ON "RestructureReviewTask"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RestructureReviewTask_tenantId_dedupeKey_key" ON "RestructureReviewTask"("tenantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAmendment_proposalId_key" ON "LoanAmendment"("proposalId");

-- CreateIndex
CREATE INDEX "LoanAmendment_tenantId_loanAccountId_idx" ON "LoanAmendment"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_availableAt_idx" ON "OutboxMessage"("status", "availableAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_eventTime_idx" ON "AuditEvent"("tenantId", "eventTime");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_resourceType_resourceId_idx" ON "AuditEvent"("tenantId", "resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_tenantId_id_key" ON "Borrower"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_tenantId_id_key" ON "LedgerAccount"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "ProductTemplate" ADD CONSTRAINT "ProductTemplate_familyCode_fkey" FOREIGN KEY ("familyCode") REFERENCES "LoanFamily"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFlagRule" ADD CONSTRAINT "PlatformFlagRule_flagKey_fkey" FOREIGN KEY ("flagKey") REFERENCES "FeatureFlag"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantBusinessDate" ADD CONSTRAINT "TenantBusinessDate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayCalendar" ADD CONSTRAINT "HolidayCalendar_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "HolidayCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRole" ADD CONSTRAINT "AccessRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "AccessPermission"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "AccessRole"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAuthority" ADD CONSTRAINT "ApprovalAuthority_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "AccessRole"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPolicy" ADD CONSTRAINT "AccessPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_tenantId_policyId_fkey" FOREIGN KEY ("tenantId", "policyId") REFERENCES "AccessPolicy"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagRule" ADD CONSTRAINT "FlagRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagRule" ADD CONSTRAINT "FlagRule_flagKey_fkey" FOREIGN KEY ("flagKey") REFERENCES "FeatureFlag"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagChangeApproval" ADD CONSTRAINT "FlagChangeApproval_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "FlagRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAccount" ADD CONSTRAINT "ServiceAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LendingProduct" ADD CONSTRAINT "LendingProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "LendingProduct"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingConfiguration" ADD CONSTRAINT "PricingConfiguration_tenantId_productVersionId_fkey" FOREIGN KEY ("tenantId", "productVersionId") REFERENCES "ProductVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentConfiguration" ADD CONSTRAINT "RepaymentConfiguration_tenantId_productVersionId_fkey" FOREIGN KEY ("tenantId", "productVersionId") REFERENCES "ProductVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowerGroup" ADD CONSTRAINT "BorrowerGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_tenantId_groupId_fkey" FOREIGN KEY ("tenantId", "groupId") REFERENCES "BorrowerGroup"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDocument" ADD CONSTRAINT "ApplicationDocument_tenantId_applicationId_fkey" FOREIGN KEY ("tenantId", "applicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditDecision" ADD CONSTRAINT "CreditDecision_tenantId_applicationId_fkey" FOREIGN KEY ("tenantId", "applicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalTask" ADD CONSTRAINT "ApprovalTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionPrecedent" ADD CONSTRAINT "ConditionPrecedent_tenantId_applicationId_fkey" FOREIGN KEY ("tenantId", "applicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollateralAsset" ADD CONSTRAINT "CollateralAsset_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Valuation" ADD CONSTRAINT "Valuation_tenantId_collateralId_fkey" FOREIGN KEY ("tenantId", "collateralId") REFERENCES "CollateralAsset"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollateralPledge" ADD CONSTRAINT "CollateralPledge_tenantId_collateralId_fkey" FOREIGN KEY ("tenantId", "collateralId") REFERENCES "CollateralAsset"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollateralPledge" ADD CONSTRAINT "CollateralPledge_tenantId_applicationId_fkey" FOREIGN KEY ("tenantId", "applicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guarantee" ADD CONSTRAINT "Guarantee_tenantId_applicationId_fkey" FOREIGN KEY ("tenantId", "applicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawdown" ADD CONSTRAINT "Drawdown_tenantId_facilityId_fkey" FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LendingAgreement" ADD CONSTRAINT "LendingAgreement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementVersion" ADD CONSTRAINT "AgreementVersion_tenantId_agreementId_fkey" FOREIGN KEY ("tenantId", "agreementId") REFERENCES "LendingAgreement"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAccount" ADD CONSTRAINT "LoanAccount_tenantId_agreementId_fkey" FOREIGN KEY ("tenantId", "agreementId") REFERENCES "LendingAgreement"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleInstalment" ADD CONSTRAINT "ScheduleInstalment_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_financialEventId_fkey" FOREIGN KEY ("tenantId", "financialEventId") REFERENCES "FinancialEvent"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LendingJournalEntry" ADD CONSTRAINT "LendingJournalEntry_tenantId_financialEventId_fkey" FOREIGN KEY ("tenantId", "financialEventId") REFERENCES "FinancialEvent"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LendingJournalLine" ADD CONSTRAINT "LendingJournalLine_tenantId_entryId_fkey" FOREIGN KEY ("tenantId", "entryId") REFERENCES "LendingJournalEntry"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LendingJournalLine" ADD CONSTRAINT "LendingJournalLine_tenantId_accountId_fkey" FOREIGN KEY ("tenantId", "accountId") REFERENCES "LedgerAccount"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestructureCase" ADD CONSTRAINT "RestructureCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestructureCase" ADD CONSTRAINT "RestructureCase_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestructureEvidence" ADD CONSTRAINT "RestructureEvidence_tenantId_caseId_fkey" FOREIGN KEY ("tenantId", "caseId") REFERENCES "RestructureCase"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffordabilityAssessment" ADD CONSTRAINT "AffordabilityAssessment_tenantId_caseId_fkey" FOREIGN KEY ("tenantId", "caseId") REFERENCES "RestructureCase"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestructureProposal" ADD CONSTRAINT "RestructureProposal_tenantId_caseId_fkey" FOREIGN KEY ("tenantId", "caseId") REFERENCES "RestructureCase"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestructureApproval" ADD CONSTRAINT "RestructureApproval_tenantId_proposalId_fkey" FOREIGN KEY ("tenantId", "proposalId") REFERENCES "RestructureProposal"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestructureAcceptance" ADD CONSTRAINT "RestructureAcceptance_tenantId_proposalId_fkey" FOREIGN KEY ("tenantId", "proposalId") REFERENCES "RestructureProposal"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestructureCondition" ADD CONSTRAINT "RestructureCondition_tenantId_caseId_fkey" FOREIGN KEY ("tenantId", "caseId") REFERENCES "RestructureCase"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestructureReviewTask" ADD CONSTRAINT "RestructureReviewTask_tenantId_caseId_fkey" FOREIGN KEY ("tenantId", "caseId") REFERENCES "RestructureCase"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for the lending platform.
--
-- The application enforces these too; the database enforces them again so a
-- bug, a raw query or a console session cannot rewrite financial history.
-- The only exception is the tenant GDPR purge, which must opt in inside its
-- own transaction with:  SET LOCAL lending.purge = 'on';
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lending_purge_allowed() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('lending.purge', true), '') = 'on'
$$;

-- Append-only tables: no UPDATE, no DELETE (except the opted-in purge).
CREATE OR REPLACE FUNCTION lending_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND lending_purge_allowed() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'lending: % on % is not allowed; % rows are immutable (post a reversal instead)', TG_OP, TG_TABLE_NAME, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PaymentAllocation','LendingJournalEntry','LendingJournalLine','AccrualEvent','AuditEvent','AgreementVersion','CreditDecision','RestructureApproval','RestructureAcceptance','AffordabilityAssessment']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION lending_append_only()', t || '_append_only', t);
  END LOOP;
END $$;

-- FinancialEvent: the only permitted change is POSTED → REVERSED.
CREATE OR REPLACE FUNCTION lending_financial_event_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: financial events cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'lending: financial event % is immutable', OLD.id USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER "FinancialEvent_guard" BEFORE UPDATE OR DELETE ON "FinancialEvent"
  FOR EACH ROW EXECUTE FUNCTION lending_financial_event_guard();

-- ProductVersion: terms are frozen once the version leaves DRAFT. Status and
-- approval metadata may still progress; the configuration may not change.
CREATE OR REPLACE FUNCTION lending_product_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: product version % (%) cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW.config IS DISTINCT FROM OLD.config OR
       NEW."configHash" IS DISTINCT FROM OLD."configHash" OR
       NEW."requiredCapabilities" IS DISTINCT FROM OLD."requiredCapabilities" OR
       NEW.version IS DISTINCT FROM OLD.version OR
       NEW."productId" IS DISTINCT FROM OLD."productId" OR
       NEW."makerId" IS DISTINCT FROM OLD."makerId" OR
       NEW."engineVersion" IS DISTINCT FROM OLD."engineVersion"
     ) THEN
    RAISE EXCEPTION 'lending: product version % is % and its configuration is immutable; create a new version', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductVersion_guard" BEFORE UPDATE OR DELETE ON "ProductVersion"
  FOR EACH ROW EXECUTE FUNCTION lending_product_version_guard();

-- Double entry: every journal entry balances at commit, and no line is both
-- debit and credit or negative.
ALTER TABLE "LendingJournalLine"
  ADD CONSTRAINT "LendingJournalLine_amounts_check"
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND (debit + credit) > 0);

CREATE OR REPLACE FUNCTION lending_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; n int;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO d, c, n
    FROM "LendingJournalLine" WHERE "entryId" = NEW."entryId";
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'lending: journal entry % is unbalanced (debits %, credits %, % lines)', NEW."entryId", d, c, n
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "LendingJournalLine_balanced"
  AFTER INSERT ON "LendingJournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION lending_journal_balanced();

-- Money columns on financial events and allocations are never negative.
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_amount_check" CHECK (amount >= 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_check" CHECK (amount > 0);
ALTER TABLE "LoanAccount" ADD CONSTRAINT "LoanAccount_balances_check"
  CHECK ("principalOutstanding" >= 0 AND "interestReceivable" >= 0 AND "feesReceivable" >= 0 AND "penaltyReceivable" >= 0);

-- ── Row-level security (additional protection) ─────────────────────────────
-- The Prisma tenant guard is the primary wall. These policies are a second
-- wall for financial tables: inside a transaction that has declared its
-- tenant (SELECT set_config('app.tenant_id', <id>, true)), rows of any other
-- tenant are invisible and unwritable, including to raw SQL. When no tenant
-- is declared (platform, system and legacy paths) the policy is permissive,
-- so enabling it cannot break existing callers.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LoanAccount','ScheduleInstalment','FinancialEvent','PaymentAllocation','LendingJournalEntry','LendingJournalLine','AccrualEvent','Application','LendingAgreement','AgreementVersion','RestructureCase','RestructureProposal','LoanAmendment']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
