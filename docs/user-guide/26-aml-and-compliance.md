# AML and compliance

Who this is for: risk / compliance reviewers who screen customers, keep the
watch lists, disposition matches, approve enhanced due diligence and report
to CAFIU; credit analysts who screen customers and record due diligence;
relationship officers and every other member of staff who may notice
something suspicious.

Cambodia's 2020 Law on Anti-Money Laundering and Combating the Financing of
Terrorism requires a lender to know who its customers are, check them
against sanctions and politically-exposed-person (PEP) lists, look harder at
high-risk customers, report large cash transactions and suspicious
transactions to the Cambodia Financial Intelligence Unit (**CAFIU**), and
keep its records. The platform supports each of these steps; the decisions
remain your compliance team's.

> Some settings below (the cash reporting threshold, the risk weights, the
> lists of higher-risk countries and occupations) are **assumed defaults
> that need your compliance officer's sign-off** before you rely on them.
> They are changed in the lending settings, by one person and approved by a
> second.

---

## 1. Where to find things

| Screen | Where | What you do there |
|---|---|---|
| **AML & compliance** | **Risk & audit › AML & compliance** | Tabs: **Screening cases**, **Watch lists**, **Risk & EDD**, **Cash transactions**, **Suspicious transactions** (each shown only if you hold its permission). |
| **AML/CFT** panel | Customer profile (**Customers › Borrowers** › open a customer) | The customer's AML status, risk rating, whether they may borrow and why not, and the actions you may take. |
| **Blocked by** | Application and loan screens ("Why can't I…") | When a customer's due diligence is incomplete, the submit, approve, book and disbursement actions say so, naming the customer and what is missing. |

---

## 2. Who can do what

| Permission | What it allows | Standard roles that hold it |
|---|---|---|
| `aml.read` | See a customer's AML status, risk rating and screening cases, the risk list and the cash transaction report — for customers in your branches. | Relationship officer, credit analyst, credit approver, loan operations maker and checker, risk / compliance reviewer, auditor |
| `aml.screen` | Screen a customer now, re-rate their risk, record AML clearance or flag them, record enhanced due diligence, upload a watch-list version. | Credit analyst, risk / compliance reviewer |
| `aml.disposition` | Propose and approve the outcome of a screening case, approve an AML clearance, activate a watch-list version, run queued re-screens. Never your own. | Risk / compliance reviewer |
| `aml.edd.approve` | Approve enhanced due diligence recorded by **someone else**. | Risk / compliance reviewer |
| `aml.str.raise` | Raise a suspicious transaction referral. | Every operational role |
| `aml.str.review` | See and review referrals and record reports to CAFIU. Nobody else sees them. | Risk / compliance reviewer |

---

## 3. When a customer may borrow

An application cannot be **submitted**, **approved** or **booked**, and no
money can be **disbursed** or **drawn**, unless every customer who is a party
to it — the borrower, the members of a group loan, and a guarantor who is on
file as a customer — meets all of these:

1. their **identity is verified** (the KYC review, by two people);
2. their AML status is **Clear** (recorded by one person, approved by a second);
3. they have **no watch-list match awaiting review**;
4. if their risk rating is **High**, or they are a **politically exposed
   person**, their **enhanced due diligence is approved**.

This applies whatever the product's workflow steps say. The application or
loan screen shows the reason under **Blocked by**, for example *"Borrower Sok
Dara: has not been AML-cleared (screened and approved by two people)."*

---

## 4. AML status: clear and flag

On the customer's **AML/CFT** panel:

- **Record AML clearance** — the customer is screened against the lists in
  force first. If a match is found a screening case opens and the clearance
  is refused until the case is dispositioned. Otherwise the clearance waits
  for a second compliance user, who presses **Approve clearance** (or
  **Refuse**, with a reason). The customer stays as they were until then.
- **Flag customer** — takes effect at once, by one person, with a reason. A
  flagged customer cannot borrow or be paid out; clearing them again needs
  two people.
- A customer who is a **confirmed sanctions match** cannot be cleared at all.

Every change is in the audit trail, with who did it and why. The old
**Modify KYC/AML** shortcut can still flag a customer but can no longer clear
one.

---

## 5. Watch lists and screening

Compliance keeps the watch lists under **AML & compliance › Watch lists**:

1. **Upload list version** — choose a list code (for example `UN_SANCTIONS`,
   `PEP_REGISTER`, `INTERNAL`), a name, and a CSV file with the columns
   `name`, `type` (`SANCTION`, `PEP` or `INTERNAL`), `source` and `list_date`
   (`YYYY-MM-DD`), and optionally `aliases` (separated by `;`), `country`,
   `date_of_birth` and `reference`. A file with mistakes is refused line by
   line; nothing is uploaded.
2. A **second** compliance user **activates** it (or rejects it with a
   reason). Activation replaces the list's previous version and **re-screens
   every customer** in the background. Progress shows under **Re-screening**;
   **Run queued re-screens** starts it at once.

Customers are also screened when they are created, whenever their details
change, when someone presses **Screen now**, and before a clearance.

**How names are compared.** Case, accents, punctuation, doubled letters and
titles (Mr, Dr, Oknha, Lok Chumteav, H.E. …) are ignored; the order of names
does not matter; and names are also compared with their spaces removed, so
"Sokdara Chan" matches "Sok Dara Chan". A name is a match when its
similarity reaches the threshold in the settings (0.88 by default, on a
scale of 0 to 1). A missing middle name still matches; a single shared word
does not.

---

## 6. Screening cases

A match opens a **screening case** (one open case per customer; later matches
are added to it). Under **Screening cases**, open a case to see each list
entry, the name it matched, the score and notes such as *date of birth
differs*.

1. A compliance user **proposes the outcome**: **False positive** (say why —
   date of birth, nationality, identity document) or **True match**.
2. A **second** compliance user **approves** it or **sends it back** with a
   reason.

What an approved outcome does:

| Outcome | Effect |
|---|---|
| False positive | The case closes. The same list entry is not raised again for this name. |
| True match — PEP | The customer is **flagged** and marked **politically exposed**; their rating becomes High; they need approved enhanced due diligence (and a new clearance) before borrowing. |
| True match — sanctions or internal list | The customer is **flagged**, cannot be cleared (sanctions), and a **suspicious transaction referral** is raised for compliance automatically. |

---

## 7. Risk rating and enhanced due diligence

Each customer is rated **Low**, **Medium** or **High** from factors whose
weights are in the lending settings: politically exposed person, nationality
(a list of higher-risk countries), occupation or business type, the product
types they borrow, and cash intensity (the share of their repayments made in
cash, or a cash-intensive occupation). The panel shows which factors are
present, the score and the **next review date** (by default 36 months for
Low, 24 for Medium, 12 for High). **Risk & EDD** lists customers by rating,
with reviews that are due.

For a **High** or politically exposed customer, record **enhanced due
diligence** on their panel: the source of funds, the source of wealth and
the reference of the document you saw. A second person approves it.

---

## 8. Cash transaction report

**AML & compliance › Cash transactions** lists cash repayments and cash
disbursements at or above the reporting threshold (by default USD 10,000 /
KHR 40,000,000 — *assumed, to be confirmed by your compliance officer*),
either as one transaction or added up for one customer on one business day.
Choose the period and press **Run**; **Download CSV** gives the extract for
CAFIU.

A payment counts as cash when it was recorded through a cash channel
(**Branch cash** by default): a repayment or disbursement posted with that
channel, or a receipt matched from an unidentified cash payment. **Record the
channel when you post a repayment or a disbursement**; the report tells you
how many payments in the period had no channel and could not be classed.

---

## 9. Suspicious transaction referrals

Anyone who suspects something — a customer who repays a large sum in cash
and will not say where it came from, payments by strangers, amounts kept
just under limits — presses **Raise suspicious transaction referral** on the
customer's panel, describes the facts and ticks the red flags. You receive a
reference; you will not see what happens next.

**Do not tell the customer, or anyone outside compliance, that a referral
has been raised.** Tipping-off is an offence. Only compliance users see
referrals; the audit trail records that one was raised, not on whom.

Compliance, under **Suspicious transactions**: open the referral, **Record
review** (*To report* or *No further action*, with notes), and once it has
been filed with CAFIU, **Mark reported to CAFIU** with CAFIU's reference and
the date.

---

## 10. Record keeping

Screening cases, enhanced due diligence and referrals cannot be deleted or
edited after their decision, and a customer who has any of them cannot be
deleted. The settings record the retention period (by default five years
after the relationship ends).
