# Getting started

Who this is for: everyone who uses the portal. Read this first. It covers signing in, setting up your authenticator, changing language, resetting your password, finding your way around the screen and using your work queues.

---

## 1. Before you start

You need:

- **An account.** Your organisation's administrator creates it for you (see [18-tenant-administration.md](18-tenant-administration.md)). You receive your email address and a temporary password from them. You cannot create your own staff account.
- **A role.** Your account only shows the menus and buttons your roles allow. If something you need is missing, ask your administrator (see [02-roles-and-approvals.md](02-roles-and-approvals.md)).
- **An authenticator app on your phone** (for example Google Authenticator or Microsoft Authenticator) if you approve loans, disbursements, write-offs, restructures or reversals. These actions need a six-digit code at sign-in. See section 4.
- A current web browser (Chrome, Edge, Firefox or Safari).

---

## 2. Signing in

To sign in:

1. Open the portal address your organisation gave you. The **Sign in** page appears.
2. Type your **Email**.
3. Type your **Password**. Click the eye icon to show or hide what you typed.
4. Click **Sign in**.
5. If your account has an authenticator set up, the **Two-factor authentication** page appears: open your authenticator app, type the six-digit code into **Verification code** and click **Confirm**. (See section 3.)

What happens next:

- Staff of a lending organisation land on **Home** (your work queues, section 8). If you have no lending-platform role, you land on the **KPI dashboard** instead.
- The platform operator (super-admin) lands on **Organisations** (see [20-platform-administration.md](20-platform-administration.md)).

If it is blocked:

| Message | What it means | What to do |
|---|---|---|
| **Invalid credentials. 4 attempt(s) remaining before lockout.** | Wrong email or password. The number counts down. | Check the email and password (Caps Lock). Use **Forgot password?** if you are not sure. |
| **Account locked for 30 minutes after 5 failed attempts.** | Too many wrong passwords or codes. | Wait 30 minutes, or ask your administrator to reset your password (this also clears the lock). The limits (5 attempts, 30 minutes) are the defaults; your organisation's IT team may have changed them. |
| **Account is temporarily locked due to too many failed attempts. Try again in N minute(s).** | You tried again while still locked. | Wait the time shown. |
| **Your staff account has been suspended by your administrator.** | Your administrator suspended you. | Contact your administrator. |
| **… is awaiting plan payment confirmation. Once the platform team confirms your transfer, you can sign in.** | Your organisation registered on a paid plan and the payment has not been confirmed yet. | Wait for the platform team to confirm the payment (see [20-platform-administration.md](20-platform-administration.md)). |
| **Organization … has been suspended or is pending data erasure. Please contact platform support.** | The whole organisation is suspended. | Contact platform support. |
| **This account signs in with Google. Use the "Continue with Google" button.** | Your account was created with Google and has no password. | Use the Google button (section 2.1). |
| **Unable to connect to service.** | The portal cannot reach the server. | Check your internet connection and try again; if it continues, contact IT. |

### 2.1 Signing in with Google

If your organisation has Google sign-in switched on, a Google button appears under **Sign in**, after the word **or**. If you do not see it, Google sign-in is not configured for your portal; use your email and password.

To sign in with Google:

1. On the **Sign in** page, click the Google button.
2. Choose your Google account in the pop-up.
3. If your account has an authenticator, enter the code as in section 3.

Your Google address must already belong to a staff account. Otherwise you see **No account is registered for this Google address. Ask your administrator to invite you, or register a new organization.**

---

## 3. The authenticator code at sign-in (two-factor authentication)

Once you have set up an authenticator (section 4), every sign-in asks for a code after your password.

1. After **Sign in**, the page changes to **Two-factor authentication** — "Enter the 6-digit code from your authenticator app."
2. Open the authenticator app on your phone and find the entry for the portal.
3. Type the six digits shown into **Verification code** and click **Confirm**.

Notes:

- Codes change every 30 seconds. If the code is about to change, wait for the next one.
- You have 5 minutes to enter the code. After that you see **Invalid or expired MFA session. Please log in again.** Click **Try another method** to go back and sign in again.
- A wrong code shows **Invalid MFA code**. Wrong codes count towards the same lockout as wrong passwords.
- If your phone's clock is wrong, codes will not work. Set the phone to set its time automatically.

**Why it matters:** some actions (approvals, disbursements, write-offs, reversals and restructure executions) are allowed only when you signed in **with** your code. Signing in with only a password lets you look at everything but not approve. See [02-roles-and-approvals.md](02-roles-and-approvals.md), section 6.

---

## 4. Setting up your authenticator

Do this once, on your first day, if you approve or execute anything. It is also good practice for everyone.

To set up your authenticator:

1. Install an authenticator app on your phone.
2. Open the **Settings** page:
   - Administrators: click **Administration › Settings** in the menu.
   - Everyone else: click the link **Set up an authenticator** in the amber banner at the top of the screen (it appears when your role includes approvals), or type the portal address followed by `/en/settings` (for example `https://portal.example.com/en/settings`).
3. Find the box **Security Verification** ("Add an extra layer of security to your organization account.") on the right.
4. Click **Setup Authenticator**. "Generating security keys..." appears, then a QR code.
5. In your authenticator app, add a new account and scan the QR code ("Scan this with your Auth App"). If you cannot scan, type the **Manual Key** shown under the QR code into the app instead.
6. Type the six-digit code the app now shows into **Enter 6-digit Verification Code**.
7. Click **Complete Security Setup**.

What happens next:

- The box turns green and shows **MFA Active** — "Your account is protected with Multi-Factor Authentication."
- **Sign out and sign in again**, entering your code. Your current session still counts as "password only" until you do. After signing in with the code, the chip at the top of the screen shows **MFA** instead of **Password only** (section 9).

If it is blocked:

- If you are not an administrator, the Settings page may also show a red message such as **Failed to load settings** or **You don't have permission to do that…** and an organisation form you cannot save. Ignore these: they are about the organisation settings, not your authenticator. The **Security Verification** box still works.
- If you type a wrong code in step 6, you may see **Invalid code. Please try again.**, or the portal may send you back to the **Sign in** page. Sign in again, return to Settings and start again from step 4. **Delete the old entry from your authenticator app first** — each new start creates a new QR code and the old entry will no longer work.
- The **Security Verification** box does not remember that you have already finished. If you click **Setup Authenticator** after setting it up, you see **MFA is already enabled** and **Failed to initiate MFA setup**. This is harmless: your authenticator is still active.
- **Lost or replaced phone:** there is no screen to remove or reset an authenticator. Ask your system administrator / IT team to reset it for you.

---

## 5. Forgot password and resetting your password

To reset a forgotten password yourself:

1. On the **Sign in** page, click **Forgot password?**
2. On **Reset your password**, type your account email and click **Send reset link**.
3. The page says **If an account exists for that email, a reset link has been sent.** — "Check your inbox and follow the link (valid for 1 hour)."
4. Open the email and click the link. The **Set a new password** page opens.
5. Type a **New password** (at least 12 characters) and the same again in **Confirm password**, then click **Update password**.
6. **Password updated. Redirecting to sign in…** appears and you are taken to **Sign in**.

Messages you may see: **Password must be at least 12 characters.**, **Passwords do not match.**, **This reset link is missing its token. Please request a new one.** (click **Request a reset link**), **This reset link is invalid or has expired.**

Notes:

- The email is only sent if your portal has an email service configured. If no email arrives within a few minutes (check spam too), ask your administrator to reset your password from **Administration › Team members** (see [18-tenant-administration.md](18-tenant-administration.md)). That also signs you out everywhere and clears any lockout.
- If a reset link is old or already used, the portal may simply return you to the **Sign in** page. Request a new link.
- Resetting your password does not change your authenticator.

There is no "change my password" screen for a signed-in user. To change your password, use **Forgot password?** or ask your administrator.

---

## 6. Changing the language (English / Khmer)

The portal is available in English (**EN**) and Khmer (**ខ្មែរ** / **KM**).

- **Before signing in:** use the language switch at the top right of the **Sign in**, **Create your account** and payment pages. It shows **EN** and **ខ្មែរ**.
- **After signing in:** use the **EN | KM** switch at the right of the top bar.

The switch keeps you on the same page. Menus, the Home page, sign-in screens and the original screens are translated. **Most lending-platform screens (applications, loan accounts, Access & policy and so on) are shown in English in both languages** — their labels are not translated yet.

---

## 7. Finding your way around

### 7.1 The sidebar (left)

- The top shows your organisation's name.
- The menu is grouped into sections: **Work**, **Customers**, **Origination**, **Loans**, **Collections & relief**, **Finance**, **Products**, **Risk & audit**, **Administration**. You only see the sections and items your roles allow — two colleagues may see different menus.
- A number on a menu item is how many items are waiting for **you** in that area (for example applications to approve). It refreshes every minute.
- Items marked **(original)** are the older loan module; see [21-original-loan-module.md](21-original-loan-module.md).
- The bottom shows your name (from your email) and your roles. Hover over the roles to see them all.
- **Sign out** ends your session.

On a small screen the sidebar is hidden; click the menu icon (three lines) at the top left to open it.

### 7.2 The top bar

From left to right: the page name, the **search box** (section 10), the **status chips** (section 9) and the **EN | KM** language switch.

### 7.3 Lending pages

Lending-platform pages have a row of tabs across the top (for example **Applications**, **Loans**, **Facilities**, **Audit**, **Access & policy**). It lists the same pages as the menu and also only shows the ones you can use.

---

## 8. Home — your work queues ("My work")

**Work › Home** shows what is waiting for you today. The title is **My work** and the line underneath says how many queues need you, for example "3 queues need you today, dara".

Each tile is one queue: a name (for example **Waiting for your credit decision**, **Disbursements to prepare**, **Documents to review**) and a count. Labels on the tile tell you the kind of work:

| Label | Meaning |
|---|---|
| **You prepare** | You are the maker: you start or prepare this work. |
| **You approve** | You are the checker: someone else prepared it and you decide. |
| **For information** | Nothing to do; shown so you know (for example **Past due in your scope**, **Refused actions this week**). |
| **Money** | Acting on it moves money. |
| **Needs MFA** | You must be signed in with your authenticator code to act (section 3). The tile is greyed out until you are. |

Click a tile to open the page where the work is done.

Under the tiles, up to three of the most urgent queues are listed item by item, **Oldest first · within your scope**. Each line shows the record, the reference, the amount and an **Open** button. Two warnings may appear on a line:

- **Above your limit** — the amount is above your approval authority. "Send it to an approver with a higher limit, or ask for a delegation."
- **Needs MFA** — "This approval needs a sign-in with your authenticator code."

**See all N** opens the full list.

Buttons at the top right:

- **Refresh** — reload the counts now (they also refresh every minute).
- **KPI dashboard** — opens the dashboard (if your role can see it).
- **New application** — opens **Applications** to start one (if you can create applications).

Notes:

- Queues **never include work you created yourself** where a second person must act (maker-checker). If you prepared a disbursement, it will not appear in your own "to approve" queue.
- Queues only include records in your branch or portfolio scope.
- "Your role reads data but has no queue. Use search or the menu." means your role can look but has nothing to act on.

---

## 9. The status chips (top bar)

These small labels are always visible (on wider screens) so you know the conditions you are working under.

| Chip | Meaning |
|---|---|
| **Business date · 2026-10-18** | The organisation's business date. Postings (repayments, disbursements, accruals) are dated by it, not by today's calendar date. Finance moves it forward at end of day — see [14-accounting-and-period-close.md](14-accounting-and-period-close.md). |
| **All branches** / **Branch · Phnom Penh** / **3 branches** / **Limited scope** | Your scope: which branches' borrowers and loans you can work on. Hover to see branch names. |
| **Limit · 100,000.00 USD · 400,000,000.00 KHR** | Your highest approval authority per currency. Only shown if you have one. See [02-roles-and-approvals.md](02-roles-and-approvals.md), section 5. |
| **MFA** (green) / **Password only** (amber) | How you signed in this session. Only shown if your role has actions that need the authenticator code. |
| **Platform · all organisations** | Shown instead to the platform operator. |

If you have no lending-platform role, no chips are shown.

### 9.1 Banners under the top bar

- **Verify with your authenticator to approve.** "You can review everything, but approvals and reversals need a code." Shown when your role can approve but you signed in with a password only. The link says **Sign in again with your code** (if you already have an authenticator — sign out, then sign in again and enter your code) or **Set up an authenticator** (if you do not — see section 4).
- **Acting with authority delegated by … until ….** (and **Capped at …** if there is an amount cap). You are temporarily holding another person's permissions. See [02-roles-and-approvals.md](02-roles-and-approvals.md), section 7.

---

## 10. Searching

The search box in the top bar finds borrowers, loan accounts, applications, facilities, cards, restructure cases and loans in the original module.

To search:

1. Click the search box, or press **/** or **Ctrl+K** (**⌘K** on Mac) anywhere.
2. Type at least two characters: a borrower name, phone number, ID number, loan reference, application number or case number ("Search borrower, phone, ID, loan, application, case").
3. Results appear grouped (**Borrowers**, **Loan accounts**, **Applications**, …) with their status.
4. Click a result, or use the arrow keys and **Enter**. **Esc** closes the list.

Only records you are allowed to open, in your scope, are returned. "Nothing found for "…" in your scope." means there is no match you can see — the record may exist in another branch. **Search failed. Try again.** means a temporary error.

---

## 11. When your session ends

For security, your sign-in lasts **15 minutes**. When it has expired, the next thing you click returns you to the **Sign in** page. Anything you typed but had not saved is lost.

Tips:

- Save forms promptly, especially long ones.
- If you are sent to **Sign in** unexpectedly, simply sign in again.
- If your administrator changes your roles, your menu updates when you reload the page or sign in again.

---

## 12. Messages that pop up

Short messages appear at the corner of the screen after an action. Red ones are errors. Common ones:

| Message | Meaning |
|---|---|
| **You don't have permission to do that. Contact your administrator if you believe this is a mistake.** | Your roles do not allow this action. See [02-roles-and-approvals.md](02-roles-and-approvals.md). |
| **The requested record could not be found.** | The record was removed, or is outside your organisation or scope. |
| **A conflict occurred — this record may already exist.** / **… was changed by another request. Reload and try again.** | Someone else changed the same record at the same time. Reload the page and try again. |
| **Too many requests. Please slow down and try again in a moment.** | Wait a moment and retry. |
| **Something went wrong on our end. Please try again shortly.** | A server error. Try again; if it repeats, tell IT with the time and what you did. |

On lending-platform pages a refused action shows a red box with the reason and a **Blocked by** list. [02-roles-and-approvals.md](02-roles-and-approvals.md), section 10 explains each reason.

---

## 13. Signing out

Click **Sign out** at the bottom of the sidebar. Always sign out on a shared computer.
