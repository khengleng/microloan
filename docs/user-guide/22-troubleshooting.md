# Troubleshooting and FAQ

Who this is for: everyone. Find the message you see, or the symptom, and
follow the fix. Messages are quoted as the portal shows them; parts in
angle brackets such as `<date>` change each time. If your problem is not
here, look in the "If it is blocked" section of the chapter for the screen
you were on.

## First checks

Most refusals have one of these causes. Check them first.

1. **You are not signed in with your authenticator code.** Approvals,
   executions, reversals and some settlements need it. Look at the chip at
   the top of the screen: **Password only** means you must sign out and
   sign in again with your code ([01](01-getting-started.md), section 3).
2. **You prepared the item yourself.** Maker-checker: a different person
   must approve or complete it ([02](02-roles-and-approvals.md)).
3. **The amount is above your approval limit.** The **Limit** chip shows
   your limit. Pass the item to someone with a higher limit, or ask for a
   delegation.
4. **The record is outside your branch or portfolio scope.** The scope chip
   shows what you can work on.
5. **A function is switched off** by a feature flag, or the month is
   closed, or the business date is not what you expect (see the chip).

On lending-platform screens a refusal shows a red box with a **Blocked by**
list. Each line is one reason; all of them must be cleared.
[Chapter 02](02-roles-and-approvals.md) explains each kind of reason.

## Signing in

| Message or symptom | Cause | What to do |
|---|---|---|
| **Invalid credentials. N attempt(s) remaining before lockout.** | Wrong email or password. | Check Caps Lock; use **Forgot password?** |
| **Account locked for 30 minutes after 5 failed attempts.** | Too many wrong passwords or codes. | Wait, or ask your administrator to reset your password. |
| **Invalid MFA code** | Wrong or expired authenticator code. | Use the current code; make sure your phone sets its time automatically. |
| **Invalid or expired MFA session. Please log in again.** | More than 5 minutes passed between password and code. | Sign in again. |
| Lost or replaced phone with the authenticator | There is no self-service reset. | Ask your administrator / IT to reset your authenticator. |
| Reset email never arrives | The portal's email service may not be configured. | Ask your administrator to reset your password under **Administration › Team members**. |
| Suddenly back on the **Sign in** page | Sessions last 15 minutes. | Sign in again; save long forms often. |
| **This account signs in with Google. Use the "Continue with Google" button.** | The account has no password. | Use the Google button. |

## Permissions, approvals and limits

| Message or symptom | Cause | What to do |
|---|---|---|
| A menu item or button you expect is missing | Your roles do not include it. | Ask your tenant administrator ([18](18-tenant-administration.md)). Role changes that grant approval or money rights need a second administrator to approve before they take effect. |
| **You don't have permission to do that. Contact your administrator if you believe this is a mistake.** | Your roles do not allow the action. Some screens show a button even to people who cannot use it. | Ask a colleague with the right role, or your administrator. |
| **You cannot approve or complete an action you created or proposed** | Maker-checker: you were the maker (created, recommended, prepared or proposed it). | A different person must act. This applies to applications, disbursements, reversals, write-offs, fee waivers, refunds, set-offs, holiday programmes, restructures, period closes, migration files, product and policy versions, and access changes. |
| **This action requires signing in with multi-factor authentication.** / tile marked **Needs MFA** | You signed in with a password only. | Sign out and sign in again with your authenticator code. Set one up first if you have none ([01](01-getting-started.md), section 4). |
| **The amount exceeds your approval authority** / line marked **Above your limit** | The amount is above your limit for this action and currency. | Send it to an approver with a higher limit, or ask for a delegation. |
| **You have no approval authority for this action** | You hold the permission but no approval limit has been set for it (for example approving drawdowns, facility limit changes, issuing letters of credit). | Ask your tenant administrator to request an approval authority for you; a second administrator approves it ([18](18-tenant-administration.md)). |
| **The amount exceeds your approval authority** although the amount looks within your limit, in the other currency | Cross-currency limits are converted with the FX rate. If there is no USD/KHR rate, or the latest is more than 3 days old, the approval is refused. | Finance adds a current rate under **Finance › FX rates** ([14](14-accounting-and-period-close.md)). |
| **`<flag>` is currently unavailable** (for example `lending.group.joint_liability is currently unavailable`) | The function is switched off by a feature flag. Several loan types and features are off by default. | Ask your tenant administrators to switch it on under **Risk & audit › Access & policy** (two administrators must agree) ([18](18-tenant-administration.md)). |
| **The requested record could not be found.** / **Nothing found for "…" in your scope.** | The record is in another branch or outside your scope, or it does not exist. | Check the reference; ask someone with the right scope. |

## Customers and applications

| Message or symptom | Cause | What to do |
|---|---|---|
| **The borrower must belong to a branch before an application can be created.** | The borrower was registered by a user with no branch. There is no screen to set a borrower's branch. | Ask IT to assign the branch. Register customers while signed in as a branch user. |
| **The application cannot be submitted yet.** with **The borrower's KYC must be verified.** | The product's workflow checks KYC and the borrower is not verified. | Verify KYC on the borrower's profile ([03](03-customers-and-documents.md)). The **Approve** button there appears only for documents the customer uploaded through the borrower portal; otherwise ask IT. |
| **The borrower's date of birth is required for this product.** | The product has age rules; there is no date-of-birth field on the borrower screen. | Ask IT to record the date of birth. |
| **Approval requirements are not met.** with **Monthly income is needed to assess affordability.** | The borrower's monthly income is blank. | Edit the borrower and fill **Monthly Income (USD)**. |
| **This product lends to a group; name the group the loan is for.** | Group applications cannot be created from the screen yet. | Ask IT ([10](10-group-lending.md)). |
| You cannot find the credit score | The application is scored when it is submitted; the **Credit score** card on the application page stays empty while it is a draft. | Submit the application, or (credit analyst / approver) click **Re-run score**. See [24](24-scorecards-and-alternative-data.md). |
| A credit score factor is marked **missing** | No consent in force, no verified record (or the record is older than 365 days), no exchange rate for a riel cash flow, or the data comes from a provider or the credit bureau, which are not connected yet. | Open **Input snapshot** on the **Credit score** card and read the **Note**. See [24](24-scorecards-and-alternative-data.md), section 7. |
| **Recommend approve** shown but the application still waits | The score only recommends; the normal recommendation and approvals are still needed. | Continue the normal process ([05](05-applications-and-credit-decisions.md)). |

## Disbursement

| Message or symptom | Cause | What to do |
|---|---|---|
| **Conditions precedent outstanding: …** | Conditions on the application are not satisfied or waived. | Open the application › **Conditions precedent** › **Satisfy** with evidence, or have an approver **Waive** ([05](05-applications-and-credit-decisions.md)). |
| **The … down payment has not been received (recorded: …).** | The agreed down payment is not recorded. | Record it in the **Disbursement** panel ([06](06-disbursement.md)). |
| **A down payment is held for the seller: name the payees of this disbursement.** | The down payment is held by your organisation for the seller. | Add the payees before executing. |

## Repayments, settlements and reversals

| Message or symptom | Cause | What to do |
|---|---|---|
| **This payment would leave X … more on advance than the loan owes. Request a settlement quote and use early settlement to repay in full.** | The payment is more than the whole loan. There is no unapplied-cash account for excess money. | Use **Early settlement**; hold the excess as an unidentified payment or return it ([07](07-repayments-and-payments.md)). |
| **The payment exceeds the X … currently due, and this product does not take partial prepayments. Use early settlement to repay in full.** | The product does not allow part-prepayment. | Post only what is due, or settle in full. |
| **Value date … is N day(s) before the business date; this product allows M.** | Back-dating beyond the product's limit. | Use a later value date or escalate. |
| **`<Month Year>` is closed; nothing can be posted on `<date>`. Ask finance to reopen it.** | The accounting month is locked. | Use a date in the open month, or ask finance to request a reopening ([14](14-accounting-and-period-close.md)). |
| **Reverse later repayments first (latest first).** | Reversals go newest first. | Reverse the newer events first ([08](08-servicing-changes.md)). |
| **The loan has been rescheduled or restructured since this prepayment; it cannot be reversed automatically.** | A later schedule change depends on the payment. | Escalate to operations management. |
| **The settlement amount on `<date>` is X …** when settling | The quote was for another date; settlement posts on the business date. | Get a new quote with **Quote as of** left blank. |
| Payoff letter refused as stale or expired (**The balance has changed since letter X was issued …** / **Payoff letter X is not good on `<date>` …**) | The balance changed or the letter ran out. | Issue a new letter. |
| **No KHR/USD rate is published for `<date>` …; the payment cannot be converted.** | No FX rate for the date. | Finance publishes the rate. |
| **The file has N error(s); nothing was imported. Correct them and send the whole file again.** | A payment-channel file has errors. | Fix the lines and import the whole file again. |
| Payment by KHQR does not appear on the loan | QR payments are not linked automatically. | Post the repayment by hand, or match it under **Unidentified payments**. |

## Restructuring, relief and rate resets

| Message or symptom | Cause | What to do |
|---|---|---|
| **Balances changed since the proposal was accepted — execution stopped.** | Something was posted after acceptance. | Create a new proposal; it needs fresh approval and customer acceptance ([08](08-servicing-changes.md)). |
| **Not allowed while the record is …** on **Reject case…** or **Withdraw…** | The button is shown later in the case than the action is allowed. | Rejecting is possible only until options are proposed; withdrawing only until approval. |
| **No `<benchmark>` observation on or before `<date>` …** | A floating-rate loan needs a benchmark rate that has not been recorded. | Finance records it under **Finance › End of day & operations › Benchmark rates**. |
| Clicking **Payment holiday** or **Rate resets** on a loan fails | The buttons show for everyone, but only some roles can complete them. | Ask a collections officer (holidays) or a user with rate-reset rights. |

## Collections and recovery

| Message or symptom | Cause | What to do |
|---|---|---|
| **Write-off needs at least 180 days past due (currently N).** | The product's minimum days past due is not reached (180 is an example). | Wait, or consider negotiated settlement or recovery steps ([11](11-collections-and-recovery.md)). |
| **This product does not allow write-off.** | The product has no write-off threshold. | Ask the product team. |
| **This loan holds X USD paid in advance. Refund the advance before you write it off.** | There is an advance balance. | Use **Refund advance** first. |
| **Set-off applies only to a debt in arrears.** / **A guarantor is called only once the borrower is in arrears.** | The loan is not past due, or end of day has not run yet. | Check days past due; run end of day. |
| **This task is closed or already claimed by someone else.** | Another collector took the task. | Click **Refresh**. |
| **A recovery applies to a written-off loan; this one is ACTIVE.** | Recovery is only for written-off loans. | Use **Post repayment**. |
| The **Guarantor / set-off** button has disappeared | It is shown only while the loan is past due or a set-off is pending. | Ask IT if an open guarantor demand needs a payment recorded after the loan cured. |
| The **Set-offs to approve** queue opens Collections but the set-off is not listed | Pending set-offs are only shown on the loan itself. | Open the loan › **Guarantor / set-off**. |

## Products

| Message or symptom | Cause | What to do |
|---|---|---|
| **Cannot activate: required capabilities are not implemented — …** / **Activation refused: the engine lacks capabilities…** | The version needs something not built or needing an outside system (for example credit bureau REQUIRED, external KYC, payment adapter). | Create a new version with those options set to manual / not required ([04](04-products-and-policies.md)). |
| **Finish or reject the version already in progress first.** | Another version is in draft, submitted or approved. | Finish it, or have a checker reject it. |
| **Only the maker of a draft can edit it; create your own version instead.** | Someone else owns the draft. | Ask the maker to edit it, or to finish it. |
| **Accounting mapping references unknown ledger accounts: X.** | A wrong account code on the Accounting step. | Correct it in a new version, or have finance create the account. |
| **Policies on this product's menus have no approved version: …** | A referenced policy is not approved. | Approve it in **Products › Policy library** first. |

## Accounting, period close, returns and migration

| Message or symptom | Cause | What to do |
|---|---|---|
| **Advance the business date at most 31 days at a time, running accruals between steps.** | Jump too large. | Advance in steps and run end of day after each ([14](14-accounting-and-period-close.md)). |
| **The business date only moves forward (current `<date>`).** | The date is not later than the current one. | Pick a later date. |
| **Prepare close** greyed out, "Fix the failing checks first" | A close check failed (end-of-day failures, previous month open, reconciliation breaks). | Use the **Fix** links next to each check. |
| **`<Month Year>` is not closed. Close the month … before generating its return; use the preview meanwhile.** | Returns are generated from closed months. | Close the month first ([15](15-reports-and-regulatory-returns.md)). |
| **The return does not tie to the ledger or its tables do not add up; it cannot be submitted. …** | A reconciliation break or self-check failure. | Correct the books, reopen and close the month, generate a new version. |
| Migration **Approve and post** greyed out | A readiness check is red, often "Business date X, cut-over Y". | Align the business date with the cut-over date or reload the file ([16](16-loan-book-migration.md)). |
| **Control totals for USD do not match: …** | The file and the old system's report disagree. | Find the missing or extra rows and reload. |
| A download link shows a page of technical text | You lack permission for that export. | Ask someone with export rights. |

## Frequently asked questions

**Why can't I approve something I can see?** Seeing and approving are
separate rights. You may also be the maker, be above your limit, or be
signed in without your code. See "First checks" above.

**Why are there two "Loans" and two "Collections" menus?** Items marked
**(original)** belong to the older loan module, which keeps its own loan
records. New loans are normally created in the lending platform
(**Origination › Applications**). See [21](21-original-loan-module.md).

**Why do the KPI dashboard and Reports not show my new loans?** Those
screens read the original loan module only. Use **Loans › Loan accounts**,
**Finance › Ledger & reconciliation** and **Finance › Regulatory returns**
for lending-platform loans ([15](15-reports-and-regulatory-returns.md)).

**Can I delete a wrong payment?** No. Nothing financial is deleted; a
second person reverses it, which leaves a full record
([08](08-servicing-changes.md)).

**Why is the date on my posting not today?** Postings use the business
date shown at the top of the screen, which finance moves forward at end of
day.

**Why are some screens in English when I chose Khmer?** Many lending-platform
screens are not translated yet.

**Does the system send SMS or Telegram messages to borrowers?** Only where
your organisation has connected a provider. Borrower notices on the
Collections page are copied and sent by staff
([17](17-webhooks-and-integrations.md)).
