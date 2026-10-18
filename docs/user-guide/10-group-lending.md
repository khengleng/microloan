# Group lending

Who this is for: relationship officers who form and run solidarity groups, credit and operations staff who handle group loans, and collections staff who need to know who is liable.

A solidarity group is a small group of borrowers (for example village women's groups) who borrow together. This chapter explains how to form a group, manage its members, how group loans work, how to record who paid, and when a member may leave.

Note: Group lending is behind the feature flag `lending.group.joint_liability`, which is **off by default**. While it is off, applications, approvals, bookings and disbursements for group products are refused with "lending.group.joint_liability is currently unavailable". You can still form groups and manage members. Your tenant administrator switches the flag on (with a second administrator approving) — see [Tenant administration](18-tenant-administration.md).

---

## Key ideas

**Liability** — set by the product, and shown on each loan:

| Liability | Meaning |
|---|---|
| **GROUP_JOINT** | One loan, and **every member is liable for the whole outstanding balance**. If one member does not pay, the others must cover it. Shares only record who agreed to carry what among themselves. |
| **GROUP_INDIVIDUAL** | The group is a way to deliver and supervise the loan, but each member is liable **only for their own share**. One member's default does not reach the others. |

When deciding whom to pursue for arrears, read **Liable for**, not **Share**.

**Group rules** — also set by the product (see [Products and policies](04-products-and-policies.md)): the minimum and maximum number of members, how many days a member must have been in the group before a loan can include them (for example 30 days), whether a leader is required, how the principal is shared (**EQUAL**, or **NEGOTIATED** shares), and whether a member may leave while a loan is outstanding.

**One group at a time** — a borrower can be an active member of only one group.

---

## Where to find it

**Customers › Groups** opens **Borrower groups**: a list of groups with **Code**, **Name**, **Branch**, **Status**, **Members** and **Formed on**. Filter by status (**All statuses**) or search by name (**Search name…**, then **Search**). Click a group's **Code** to open it.

| Task | Who (standard roles) |
|---|---|
| View groups | Relationship officer, credit analyst, loan operations, risk / compliance, auditor |
| Form groups, add and remove members, change status | Relationship officer (within their branch / portfolio) |

---

## Group statuses

| Status | Meaning |
|---|---|
| **FORMING** | New group; members are being added. |
| **ACTIVE** | Running group. |
| **DORMANT** | Temporarily inactive. |
| **DISBANDED** | Closed for good. Takes no new members or loans; nothing more can be changed. |

Note: Today only **DISBANDED** stops lending. The system does not stop a group in **FORMING** or **DORMANT** from borrowing; the product's group rules (size, membership days, leader) are what is checked.

---

## Form a group

1. Go to **Customers › Groups** and click **New group**.
2. Fill in:
   - **Code** — e.g. GRP-PP-014 (2–48 characters: capital letters, digits and _ . -)
   - **Name**
   - **Branch id** (optional — defaults to your branch)
   - **Formed on** (optional — defaults to the business date)
3. Click **Create group**. You see "Group … created" and the group page opens.

A new group starts in **FORMING**. Add members, then activate it.

If it is blocked: "A group belongs to a branch; name one or sign in as a branch user." — enter the branch ID, or ask your administrator to assign you to a branch.

---

## Add members and a leader

1. On the group page, click **Add member**.
2. Under **Borrower**, search (name, full phone or ID) and click **Search**, then choose the borrower.
3. **Joined on** (optional) — the date the person really joined the group. It defaults to the business date and cannot be later. Record the real date: products count membership days from it.
4. Tick **Group leader** for the leader (only one; if the group already has one, the box reads "Leader (the group already has one)").
5. Click **Add to group**. You see "Member added" or "Leader added".

Shares are not set here: each member's share is worked out when a group loan is booked, by the product's share basis.

If it is blocked:

| Message | What to do |
|---|---|
| "This borrower is already an active member of another group." | Remove them from the other group first (if allowed). |
| "This borrower is already in the group." | Nothing to do. |
| "The group already has a leader; stand the current one down first." | See the note below. |
| "A member cannot join on …, which is after the business date." | Use a date up to today's business date. |
| "This group has been disbanded." | A disbanded group cannot be changed. |

Note: There is no screen to change a member's role (for example to replace the leader). To change the leader, remove the current leader (only possible when no live loan binds them) and add the new one as leader, or ask your system administrator / IT team.

---

## Change the group's status

On the group page, use the buttons at the top right: **Activate**, **Mark dormant**, **Disband** (only the ones that differ from the current status are shown). You see "Group is now …".

To disband, click **Disband**, read the warning in **Disband this group?** and click **Disband group**. This is refused while any of the group's loans is booked or active: "This group has … loan(s) still running; it cannot be disbanded."

---

## The group page

- **Group** — code, status, formed on, branch, **Active members**, **Leader**, **Past members**, **Loan bindings**.
- **Members** — each member (click the name to open the borrower), **Role** (Leader / Member), **Current share** on the latest group loan, **Joined**, and **Status**: **ACTIVE**, or **INACTIVE** with "Left …", the reason and any **Settlement**.
- **Loans** — each member's liability as fixed onto the group's booked loans, newest first: **Member**, **Role**, **Liability**, **Share**, **Fraction**, **Liable for**.

Note: The **Loan** column of the **Loans** card currently shows "—" because the loan reference is not supplied to this screen. To find the loan, open the leader's loans in **Loans › Loan accounts**.

---

## Lending to a group

A group loan is a normal application for a group product, with the **group leader as the borrower** and the group named on the application.

Note: **There is no screen to create a group application yet** — the **New application** form has no group field, and choosing a group product there gives "This product lends to a group; name the group the loan is for." Ask your system administrator / IT team (it is available to the IT team via the API). After it is created, the application is handled on the normal application page — see [Applications and credit decisions](05-applications-and-credit-decisions.md).

What the system does for a group loan:

- **When the application is created and again at booking**, it checks the group against the product's rules. All problems are listed together, for example:
  - "This group has … active member(s); the product requires at least …."
  - "Borrower … joined … day(s) ago; the product requires …."
  - "The group must name a leader."
  - "The borrower on a group application must be an active member of that group."
- **Affordability uses the group's combined income** — the monthly income of all active members together, not the leader's alone. The assessment records the number of members and the combined income.
- **At booking**, each active member is bound to the loan with their share, fraction and what they are liable for. Under **GROUP_JOINT** every member is liable for the whole balance. Later changes to the group do not change a loan already booked.

---

## Record a group repayment by member

Use this to post one repayment for a group loan and record how much each member paid. (Posting ordinary repayments is in [Repayments and payments](07-repayments-and-payments.md).)

1. Go to **Loans › Loan accounts** and open the group loan (status **ACTIVE**).
2. In **Servicing actions**, click **Group repayment by member**. The **Group members** card shows, for each member: **Share**, **Fraction**, **Liable for**, **Exposure today**, **Contributed** so far, and an input for **This payment**.
3. Enter each member's amount under **This payment**. **Rest of share: …** fills in what remains of that member's share.
4. Check **Repayment amount (sum of contributions)** at the bottom.
5. Click **Post group repayment of …**. You see "Group repayment of … posted".

What happens next: one repayment for the total is posted to the loan; the split records who paid. **Past contributions** lists the split for each repayment. **Clear** empties the inputs; **Close** closes the card.

Submitting twice will not pay twice: if you retry the same split (for example after a network error), the system recognises it and does not post it again.

If it is blocked: "Contribution from …, who is not on this loan." — only members bound to the loan at booking can contribute.

---

## Remove a member (member exit)

1. On the group page, click **Remove** on the member's row.
2. Enter the **Reason** (recorded on the membership and in the audit trail).
3. Click **Remove member**. You see "… left the group" (with "— settlement …" if a settlement applies).

Exit rules:

- **No live loan names the member** — they can leave freely.
- **A live loan names the member** (booked or active, even before the money is paid out):
  - If the product does **not** allow exit with a balance outstanding, exit is refused.
  - If it **does**, the member must settle their share of the outstanding balance; the **Settlement** amount is recorded on the membership.
- Leaving cannot drop the group below the product's minimum size while a loan is outstanding.
- The leader cannot leave while a loan is outstanding if the product requires a leader.

When exit is refused, the form shows **This member cannot leave the group** with the reasons, for example:

- "The group still owes …; under this product a member cannot leave until it is repaid."
- "The group has a loan booked that this member is bound to; under this product they cannot leave until it is repaid."
- "Leaving would drop the group to … member(s), below the minimum of … while a loan is outstanding."
- "The leader cannot leave while a loan is outstanding; appoint a new leader first."

A member named on a live loan stays jointly liable until that loan is repaid or the product allows exit with a balance outstanding.

---

## Related chapters

- Collecting arrears from group members: [Collections and recovery](11-collections-and-recovery.md).
- Product group rules: [Products and policies](04-products-and-policies.md).
- Feature flags: [Roles, permissions and approvals](02-roles-and-approvals.md) and [Tenant administration](18-tenant-administration.md).
