/* Shapes returned by the solidarity-group endpoints (apps/api/src/lending/origination/groups.service.ts). */

export type GroupStatus = 'FORMING' | 'ACTIVE' | 'DORMANT' | 'DISBANDED';
export type MemberRole = 'LEADER' | 'MEMBER';

export interface GroupMembership {
    id: string;
    borrowerId: string;
    role: MemberRole | string;
    joinedOn: string | null;
    leftOn: string | null;
    exitReason: string | null;
    exitSettlement: string | null;
}

export interface BorrowerGroup {
    id: string;
    code: string;
    name: string;
    branchId: string | null;
    status: GroupStatus | string;
    formedOn: string | null;
    /** Active (not-left) members. */
    memberCount: number;
    members: GroupMembership[];
}

/** A member's liability frozen onto a booked loan. */
export interface LoanBinding {
    loanAccountId?: string;
    borrowerId: string;
    role: string;
    liability: string;
    shareAmount: string;
    shareFraction: string;
    liableFor: string;
}

/** One of the group's booked loans, as the group view names it. */
export interface GroupLoan {
    id: string;
    reference: string;
    status: string;
    currency: string;
    principalOutstanding: string;
    borrowerId: string;
}

/** An application made for the group (newest first). */
export interface GroupApplication {
    id: string;
    reference: string;
    status: string;
    currency: string;
    requestedAmount: string;
    borrowerId: string;
    createdAt: string;
}

export interface BorrowerGroupDetail extends BorrowerGroup {
    loanBindings: LoanBinding[];
    loans?: GroupLoan[];
    applications?: GroupApplication[];
}

export interface CreateGroupBody {
    code: string;
    name: string;
    branchId?: string;
    formedOn?: string;
}

export interface AddMemberBody {
    borrowerId: string;
    role?: MemberRole;
    joinedOn?: string;
}

export interface RemoveMemberResult {
    borrowerId: string;
    leftOn: string;
    settlementAmount: string | null;
}

/* GET /lending/loans/:id/group-members */

export interface LoanGroupMemberPosition extends LoanBinding {
    contributed: string;
    exposureToday: string;
}

export interface GroupContribution {
    borrowerId: string;
    amount: string;
    financialEventId: string;
}

export type LoanGroupMembers =
    | { group: false; members: []; contributions: [] }
    | {
          group: true;
          groupId: string;
          liability: string;
          outstanding: string;
          members: LoanGroupMemberPosition[];
          contributions: GroupContribution[];
      };

/** Body of POST /lending/loans/:id/repayments when split by member. */
export interface GroupRepaymentBody {
    amount: string;
    contributions: { borrowerId: string; amount: string }[];
}

/** Legacy GET /borrowers row (only the fields these screens use). */
export interface BorrowerLite {
    id: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    branchId?: string | null;
}

export interface BorrowersPage {
    data: BorrowerLite[];
    total: number;
    page: number;
    limit: number;
    pages: number;
}
