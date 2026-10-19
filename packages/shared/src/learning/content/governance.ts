import type { LearningModule } from '../types.js';

/**
 * Governance: roles and maker-checker, the lending audit trail, Access &
 * policy, and team members. Facts follow docs/user-guide chapters 02, 18 and 19.
 */
export const GOVERNANCE_MODULE: LearningModule = {
  tours: [
    {
      id: 'audit-trail',
      title: 'Search the audit trail',
      summary: 'Filter lending events, open one and read why it was allowed or refused.',
      startPath: '/lending/audit',
      pages: ['/lending/audit'],
      demoAccount: 'auditor',
      steps: [
        {
          target: 'audit-filter-resource-type',
          title: 'Resource type',
          body: 'Pick the kind of record, for example Application or LoanAccount. Leave it on Any to search all records.',
        },
        {
          target: 'audit-filter-resource-id',
          title: 'Resource id',
          body: "Paste a record's ID to see its full history. Copy the ID from the address bar while the record is open.",
        },
        {
          target: 'audit-filter-action',
          title: 'Action contains',
          body: 'Type part of an action name: loan.repayment for repayments, credit_decision for credit decisions, access_policy for access changes.',
        },
        {
          target: 'audit-filter-outcome',
          title: 'Outcome',
          body: 'SUCCESS and FAILURE are actions carried out or failed. ALLOW and DENY are access checks; DENY rows are shaded red.',
        },
        {
          target: 'audit-search',
          title: 'Search',
          body: 'Click Search to apply the filters. Reset clears them. The newest events come first, 100 per page.',
        },
        {
          target: 'audit-event-row',
          title: 'Open an event',
          body: 'Each row shows Time, Action, Resource, Actor and Outcome. Click a row to open it.',
          action: 'click',
        },
        {
          target: 'audit-event-decision',
          title: 'Policy decision',
          body: 'For access decisions, every check is listed with pass or fail and its message, for example a failed MAKER_CHECKER or APPROVAL_AUTHORITY check.',
        },
        {
          target: 'audit-event-details',
          title: 'Details',
          body: 'The specifics of the action: amounts, roles and reasons. The footer line shows the event ID, the actor and the business date.',
        },
        {
          target: 'audit-event-config',
          title: 'Configuration versions in force',
          body: 'Which product, workflow and access-policy versions applied at that moment. Nobody can change or delete an entry.',
        },
      ],
    },
    {
      id: 'access-policy',
      title: 'Access & policy',
      summary: 'Roles, role assignments with a second approver, approval limits, delegations and the policy simulator.',
      startPath: '/lending/access',
      pages: ['/lending/access'],
      demoAccount: 'admin',
      steps: [
        {
          target: 'access-role-matrix',
          title: 'Role matrix',
          body: 'Every permission against every role. SENSITIVE marks a role whose assignment needs a second administrator; $ marks a financial permission.',
        },
        {
          target: 'access-tab-assignments',
          title: 'Assignments',
          body: 'Click Assignments to see who holds which role, in what scope.',
          action: 'click',
        },
        {
          target: 'access-assignment-role',
          title: 'Request role assignment',
          body: 'Choose the User and the Role, then the scope: All branches, branch or portfolio IDs, or empty for the user\'s own branch.',
        },
        {
          target: 'access-assignment-request',
          title: 'Request assignment',
          body: 'A non-sensitive role becomes ACTIVE at once. A sensitive role stays PENDING until another administrator approves it.',
        },
        {
          target: 'access-assignment-approve',
          title: 'Approve as the second admin',
          body: 'Only an administrator other than the requester and the person receiving the role can approve. Your own requests show "Awaiting another admin".',
        },
        {
          target: 'access-tab-authorities',
          title: 'Approval authorities',
          body: 'Click Approval authorities: the largest amount a role or user may approve, per permission and currency.',
          action: 'click',
        },
        {
          target: 'access-authority-request',
          title: 'Request authority',
          body: 'Choose role or user, permission, currency and Max amount. Every new limit is PENDING until a second administrator approves it.',
        },
        {
          target: 'access-tab-simulator',
          title: 'Policy simulator',
          body: 'Delegations (the tab before) lend permissions for up to 30 days. Now click Policy simulator.',
          action: 'click',
        },
        {
          target: 'access-simulator-run',
          title: 'Simulate',
          body: 'Choose a user and an action, then Simulate to see YES or NO with every check. Nothing is changed.',
        },
      ],
    },
    {
      id: 'team-members',
      title: 'Team members',
      summary: 'Read the team list, change an account type and add a new member.',
      startPath: '/users',
      pages: ['/users'],
      demoAccount: 'admin',
      steps: [
        {
          target: 'users-kpis',
          title: 'Team at a glance',
          body: 'Active Seats counts active accounts, Identity Strength the share with an authenticator, Logic Tiers the account types in use.',
        },
        {
          target: 'users-row',
          title: 'One member per row',
          body: 'Digital Identity is the email; Access Suspended means the account is suspended. A green shield under Identity Vault means MFA is set up.',
        },
        {
          target: 'users-role-select',
          title: 'Logic Role',
          body: 'The account type (ADMIN, FINANCE, SALES, CX, OPERATOR). It is not the lending role; lending roles are given on Access & policy.',
        },
        {
          target: 'users-governance',
          title: 'Governance',
          body: 'The key icon is Reset Password; the person-with-cross icon is Suspend Access. ADMIN accounts cannot be suspended here.',
        },
        {
          target: 'users-onboard',
          title: 'Onboard Member',
          body: 'Click Onboard Member to open the Onboard New Talent window.',
          action: 'click',
        },
        {
          target: 'users-onboard-email',
          title: 'Email Identifier',
          body: "The person's work email. It must not already be used anywhere on the platform.",
        },
        {
          target: 'users-onboard-password',
          title: 'Temporary Credential',
          body: 'A starting password of at least 12 characters, whatever the hint says. Give it to the person securely; nothing is emailed.',
        },
        {
          target: 'users-onboard-role',
          title: 'Logic Tier Assignment',
          body: 'Choose OPERATOR for lending staff unless they use the original module or are administrators. ADMIN gives full administrator powers.',
        },
        {
          target: 'users-onboard-submit',
          title: 'Register and Dispatch',
          body: 'This creates the account. Next, assign their lending role on Risk & audit › Access & policy, or they will see almost nothing.',
        },
      ],
    },
  ],
  lessons: [
    {
      id: 'roles-and-maker-checker',
      title: 'Roles, permissions and maker-checker',
      summary: 'Why the portal lets you do some things and not others, and why important steps need two people.',
      minutes: 8,
      objectives: [
        'Name the checks every lending action passes, from identity to workflow state',
        'Tell an account type apart from a lending role',
        'Explain maker-checker and why your own work never reaches your queue',
        'Read your approval limit and know what happens above it',
        'Know which actions need you to sign in with your authenticator code',
      ],
      explainer: {
        kind: 'handoff',
        actors: ['Maker', 'Checker'],
        stages: [
          {
            actor: 0,
            label: 'Maker prepares',
            caption: 'One person prepares the step, for example a disbursement or a credit recommendation.',
          },
          {
            actor: 1,
            label: 'A different checker',
            caption: 'A second person who holds the checker role must approve. The maker can never approve their own work.',
          },
          {
            actor: 1,
            label: 'Within approval limit',
            caption: "The amount must be within the checker's approval limit for that permission and currency.",
          },
          {
            actor: 1,
            label: 'Signed in with MFA',
            caption: 'Approving credit, disbursements, write-offs and similar steps needs a session signed in with the authenticator code.',
          },
          {
            actor: 0,
            label: 'Recorded in audit',
            caption: 'Every decision, allowed or refused, is written to the audit trail with the reasons.',
          },
        ],
      },
      guide: { chapter: '02-roles-and-approvals', anchor: '4-maker-checker-four-eyes-control' },
      quiz: {
        passMark: 4,
        questions: [
          {
            id: 'roles-q1',
            prompt: 'You prepared a disbursement. Who can approve it?',
            options: [
              'You, once you sign in with your authenticator code',
              'A different person who holds the checker role',
              'Any tenant administrator',
            ],
            answer: 1,
            explanation: 'Maker-checker: the person who prepared something cannot approve it. A second, different person with the checker role must.',
          },
          {
            id: 'roles-q2',
            prompt: 'An approval limit is set per…',
            options: [
              'branch only',
              'user only, never for a role',
              'permission and currency',
              'calendar month',
            ],
            answer: 2,
            explanation: 'Limits are set per permission (credit approval, disbursement approval…) and per currency, and can be given to a person or a role.',
          },
          {
            id: 'roles-q3',
            prompt: 'The top-bar chip shows "Password only". What should you do before approving credit?',
            options: [
              'Sign out and sign in again, entering your six-digit authenticator code',
              'Ask an administrator for a higher approval limit',
              'Nothing — approvals work in any session',
            ],
            answer: 0,
            explanation: 'Approvals need a session signed in with the authenticator code (MFA step-up). Sign out and sign in again with the code.',
          },
          {
            id: 'roles-q4',
            prompt: 'Which standard role manages access but can neither approve credit nor move money?',
            options: [
              'Credit approver',
              'Loan operations checker',
              'Restructure committee',
              'Tenant administrator',
            ],
            answer: 3,
            explanation: 'The Tenant administrator governs who can do what; by design it makes no credit decisions and moves no money.',
          },
          {
            id: 'roles-q5',
            prompt: 'A new colleague can sign in but sees almost nothing on the lending platform. What is missing?',
            options: [
              'An ADMIN account type',
              'A lending role assigned on Access & policy › Assignments',
              'An approval limit',
            ],
            answer: 1,
            explanation: 'The account (Team members) lets them sign in; a lending role on the Assignments tab lets them work.',
          },
        ],
      },
    },
    {
      id: 'audit-trail-basics',
      title: 'Finding answers in the audit trail',
      summary: 'Find who did what and when, and why an action was allowed or refused.',
      minutes: 7,
      tourId: 'audit-trail',
      objectives: [
        'Filter events by resource type, resource id, action and outcome',
        'Tell SUCCESS and FAILURE apart from ALLOW and DENY',
        'Open an event and read its policy decision checks',
        'Answer common questions such as "who approved this loan?"',
      ],
      explainer: {
        kind: 'flow',
        stages: [
          {
            label: 'Someone acts',
            caption: 'A user, an integration key, a borrower or the platform operator attempts a lending action.',
          },
          {
            label: 'Access check',
            caption: 'The checks run in order; the result is ALLOW or DENY, with each check that failed.',
          },
          {
            label: 'Event recorded',
            caption: 'The event keeps the time, action, record, actor, outcome, details and the configuration versions in force.',
          },
          {
            label: 'Search with filters',
            caption: 'Filter by Resource type, Resource id, Action contains and Outcome to find it again.',
          },
          {
            label: 'Read the event',
            caption: 'Open the row to see the policy decision, the details and the business date. Nobody can change or delete it.',
          },
        ],
      },
      guide: { chapter: '19-audit-trail', anchor: '1-audit-trail-risk--audit--audit-trail' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'audit-q1',
            prompt: 'How do you find who approved a particular loan application?',
            options: [
              'Outcome = DENY and look at the newest row',
              'Resource type = Application, Resource id = its ID, then look for credit_decision.approve with SUCCESS',
              'Open Administration › Team members',
            ],
            answer: 1,
            explanation: 'Filter on the application and look for the credit_decision.approve event with outcome SUCCESS.',
          },
          {
            id: 'audit-q2',
            prompt: 'What does the outcome DENY mean?',
            options: [
              'The action was carried out',
              'The action was attempted but failed for a technical reason',
              'An access check refused the action',
            ],
            answer: 2,
            explanation: 'ALLOW and DENY are access decisions; DENY means a check refused it. Refused rows are shaded red.',
          },
          {
            id: 'audit-q3',
            prompt: 'What does the Actor column show?',
            options: [
              "The actor type (USER, SERVICE, CUSTOMER or PLATFORM) and the start of their ID",
              "The person's full name",
              "The person's email address",
            ],
            answer: 0,
            explanation: 'Only the actor type and the start of the ID are shown; compare it with Access & policy or ask IT to identify the person.',
          },
          {
            id: 'audit-q4',
            prompt: 'Who can change or delete an audit trail entry?',
            options: [
              'A tenant administrator',
              'A risk / compliance reviewer',
              'The auditor who found the mistake',
              'Nobody',
            ],
            answer: 3,
            explanation: 'Neither the Audit trail nor the Audit log lets anyone change or delete entries.',
          },
        ],
      },
    },
    {
      id: 'access-and-policy',
      title: 'Granting access with a second administrator',
      summary: 'Assign roles, approval limits and delegations so that a second administrator always confirms sensitive access.',
      minutes: 10,
      tourId: 'access-policy',
      objectives: [
        'Read the role matrix and spot sensitive roles',
        'Request a role assignment with the right scope',
        'Explain who may approve a pending request',
        'Know how approval limits and delegations are requested',
        'Test "can this person do this?" with the policy simulator',
      ],
      explainer: {
        kind: 'handoff',
        actors: ['First admin', 'Second admin'],
        stages: [
          {
            actor: 0,
            label: 'Request assignment',
            caption: 'The first administrator chooses the user, the role and the scope, and clicks Request assignment.',
          },
          {
            actor: 0,
            label: 'Sensitive: PENDING',
            caption: 'A sensitive role (money, approvals or access management) waits as PENDING. A non-sensitive role is ACTIVE at once.',
          },
          {
            actor: 1,
            label: 'Approve or Reject',
            caption: 'A different administrator decides — not the requester and not the person receiving the role.',
          },
          {
            actor: 1,
            label: 'ACTIVE',
            caption: "The role applies from the user's next action. A rejected request never takes effect.",
          },
          {
            actor: 0,
            label: 'Limits work the same',
            caption: 'Approval authorities and delegations are also requested by one administrator and approved by another.',
          },
        ],
      },
      guide: { chapter: '18-tenant-administration', anchor: '6-access--policy-risk--audit--access--policy' },
      quiz: {
        passMark: 4,
        questions: [
          {
            id: 'access-q1',
            prompt: 'You request the Credit analyst role (not sensitive) for a colleague. What happens?',
            options: [
              'It is ACTIVE at once',
              'It is PENDING until a second administrator approves',
              'It is SUBMITTED to the risk reviewer',
            ],
            answer: 0,
            explanation: 'Non-sensitive roles (no money, no approval permissions) become ACTIVE at once; sensitive roles wait for a second administrator.',
          },
          {
            id: 'access-q2',
            prompt: 'Admin A requested the Credit approver role for user X. Who can approve it?',
            options: [
              'Admin A',
              'User X',
              'Another administrator who is neither A nor X',
              'Any auditor',
            ],
            answer: 2,
            explanation: 'The requester cannot approve their own request, and the person receiving the access cannot approve it either.',
          },
          {
            id: 'access-q3',
            prompt: 'A delegation of approval permissions has no maximum amount. What does the delegate get?',
            options: [
              'The delegator’s full approval limit',
              'The permission but no approval limit, so approvals are refused',
              'An unlimited approval limit',
            ],
            answer: 1,
            explanation: 'Approval limits travel only if a maximum amount and currency are set; otherwise approvals fail with "You have no approval authority for this action".',
          },
          {
            id: 'access-q4',
            prompt: 'What does the Policy simulator do?',
            options: [
              'Approves pending requests in bulk',
              'Runs the action for real on a test record',
              'Answers whether a user may do an action, and why, without changing anything',
            ],
            answer: 2,
            explanation: 'Simulation is side-effect free: it shows YES or NO with every check, and nothing is changed.',
          },
          {
            id: 'access-q5',
            prompt: 'A custom role needs one more permission. What do you do?',
            options: [
              'Edit the role on the Role matrix',
              'Create a new role and move people to it',
              'Add the permission through a delegation for every holder',
            ],
            answer: 1,
            explanation: 'A role cannot be edited after it is created, so nobody can widen an assigned role without a new approval.',
          },
        ],
      },
    },
    {
      id: 'managing-team-members',
      title: 'Adding and removing team members',
      summary: 'Create accounts on Team members, and know what else a new or leaving person needs.',
      minutes: 6,
      tourId: 'team-members',
      objectives: [
        'Add a team member with a temporary password and an account type',
        'Choose the right account type for lending staff',
        'Reset a password or suspend an account',
        'Follow the checklist for a new starter and a leaver',
      ],
      explainer: {
        kind: 'flow',
        stages: [
          {
            label: 'Onboard Member',
            caption: 'Enter the work email and a temporary password of at least 12 characters.',
          },
          {
            label: 'Account type',
            caption: 'Choose OPERATOR for lending staff unless they are administrators or use the original module.',
          },
          {
            label: 'Tell the person',
            caption: 'Nothing is emailed: give them their email and temporary password yourself, securely.',
          },
          {
            label: 'Assign lending role',
            caption: 'On Access & policy › Assignments, give them a lending role and scope, and an approval limit if they approve.',
          },
          {
            label: 'When they leave',
            caption: 'Revoke their assignments and delegations, then suspend the account on Team members.',
          },
        ],
      },
      guide: { chapter: '18-tenant-administration', anchor: '3-team-members-administration--team-members' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'team-q1',
            prompt: 'How long must the Temporary Credential be?',
            options: ['At least 6 characters', 'At least 8 characters', 'At least 12 characters'],
            answer: 2,
            explanation: 'The box says "Min. 8 characters", but the server refuses fewer than 12.',
          },
          {
            id: 'team-q2',
            prompt: 'Which account type should most lending-platform staff get?',
            options: ['ADMIN', 'OPERATOR', 'FINANCE', 'SALES'],
            answer: 1,
            explanation: 'For lending staff the account type matters only for the original screens; choose OPERATOR unless they are administrators or use the original module.',
          },
          {
            id: 'team-q3',
            prompt: 'You clicked Register and Dispatch. How does the new person learn their password?',
            options: [
              'You tell them yourself, securely',
              'They receive an invitation email',
              'They receive a Telegram message',
            ],
            answer: 0,
            explanation: 'Nothing is emailed. Give the person their email and temporary password yourself.',
          },
          {
            id: 'team-q4',
            prompt: 'Someone is leaving. What is the right order?',
            options: [
              'Suspend the account only; roles end automatically',
              'Revoke assignments, revoke delegations, then suspend the account',
              'Change their account type to CX',
            ],
            answer: 1,
            explanation: 'Revoke each active assignment and any delegation on Access & policy, then suspend the account on Team members.',
          },
        ],
      },
    },
  ],
  pathLessons: {
    'loan-officer': ['roles-and-maker-checker'],
    'credit-analyst': ['roles-and-maker-checker'],
    'credit-approver': ['roles-and-maker-checker'],
    'loan-operations': ['roles-and-maker-checker'],
    collections: ['roles-and-maker-checker'],
    finance: ['roles-and-maker-checker'],
    'product-team': ['roles-and-maker-checker'],
    'risk-compliance': ['roles-and-maker-checker', 'audit-trail-basics', 'access-and-policy'],
    auditor: ['roles-and-maker-checker', 'audit-trail-basics'],
    'tenant-admin': ['roles-and-maker-checker', 'managing-team-members', 'access-and-policy', 'audit-trail-basics'],
  },
};
