import type { LearningModule } from '../types.js';

/**
 * Servicing: disbursement, repayments, payoff and closure, and the
 * collections work queue. Facts follow the manual's chapters 06, 07 and 11.
 */
export const SERVICING_MODULE: LearningModule = {
  tours: [
    {
      id: 'disbursement',
      title: 'Pay out a loan',
      summary:
        'Prepare a disbursement as a loan operations maker, then approve and execute it as a checker.',
      startPath: '/lending/loans',
      pages: ['/lending/loans'],
      demoAccount: 'ops.maker',
      steps: [
        {
          target: 'loan-list-status-filter',
          title: 'Find loans waiting for payout',
          body: 'Choose BOOKED in this box. A booked loan has its agreement in place but no money paid out yet.',
        },
        {
          target: 'loan-list-row-link',
          title: 'Open the loan',
          body: 'Click a loan reference to open the loan screen.',
          action: 'click',
        },
        {
          target: 'loan-servicing-actions',
          title: 'Servicing actions',
          body: 'Click Disbursement to open the Disbursement panel. A greyed-out button shows the reason when you hover over it.',
          action: 'click',
        },
        {
          target: 'disb-down-payment',
          title: 'Down payment first',
          body: 'If the terms include a down payment, record it here first: Amount, Collected by and Receipt reference, then Record down payment.',
        },
        {
          target: 'disb-prepare',
          title: 'Step 1: prepare',
          body: 'The maker sets the Value date (blank means today’s business date) and clicks Prepare disbursement. The task then waits for a checker.',
        },
        {
          target: 'disb-pending-task',
          title: 'Step 2: approve or reject',
          body: 'A checker who did not prepare it clicks Approve or Reject. You need your authenticator sign-in and an approval limit that covers the amount.',
        },
        {
          target: 'disb-payees',
          title: 'Pay to',
          body: 'Leave the list empty to pay the borrower, or click Add payee for a seller, dealer, school or other payee. The amounts must add up exactly to the payout.',
        },
        {
          target: 'disb-execute',
          title: 'Step 3: execute',
          body: 'Pay through your bank or cash process first, enter its External reference, then click Execute disbursement when you are ready. The person who prepared it cannot execute it.',
        },
        {
          title: 'What happens next',
          body: 'The loan becomes ACTIVE and the disbursement is posted to the ledger. Clicking Execute twice never pays twice.',
        },
      ],
    },
    {
      id: 'post-repayment',
      title: 'Post a repayment',
      summary:
        'Record money the borrower paid, then check how it was allocated in Financial events.',
      startPath: '/lending/loans',
      pages: ['/lending/loans'],
      demoAccount: 'ops.maker',
      steps: [
        {
          target: 'loan-list-status-filter',
          title: 'Active loans only',
          body: 'Choose ACTIVE here. Repayments can only be posted on an active loan.',
        },
        {
          target: 'loan-list-row-link',
          title: 'Open the loan',
          body: 'Click the loan reference to open the loan screen.',
          action: 'click',
        },
        {
          target: 'loan-servicing-actions',
          title: 'Post repayment',
          body: 'Click Post repayment in Servicing actions.',
          action: 'click',
        },
        {
          target: 'repay-amount-fields',
          title: 'Amount and dates',
          body: 'Enter the Amount (the box next to it picks the currency paid), an optional Value date, and the receipt or bank reference as External reference.',
        },
        {
          target: 'repay-amount-fields',
          title: 'Money beyond what is due',
          body: 'If the borrower pays more than is due, choose Hold as advance or Prepay principal. Prepayment strategy then decides between a lower instalment and an earlier maturity.',
        },
        {
          target: 'repay-payer-fields',
          title: 'Someone else paying',
          body: 'If a guarantor, relative or employer paid, record their name and relationship here. It is optional.',
        },
        {
          target: 'repay-post-button',
          title: 'Post it',
          body: 'When the details are right, click Post repayment. Clicking twice does not post the payment twice.',
        },
        {
          target: 'loan-event-expand',
          title: 'See the allocation',
          body: 'In Financial events, click the arrow on the newest row to see the journal lines and how the money was allocated to each instalment.',
          action: 'click',
        },
        {
          title: 'Allocation order',
          body: 'Money is allocated in the order the product defines, for example penalties, fees, interest, then principal. Money held on advance is used first.',
        },
      ],
    },
    {
      id: 'payoff-closure',
      title: 'Payoff letters, settlement and closure',
      summary:
        'Issue a payoff letter, get an early settlement quote, and print a closure letter once the loan is closed.',
      startPath: '/lending/loans',
      pages: ['/lending/loans'],
      demoAccount: 'ops.maker',
      steps: [
        {
          target: 'loan-list-status-filter',
          title: 'Pick the loan',
          body: 'Choose ACTIVE to settle or quote a running loan, or CLOSED to print a closure letter.',
        },
        {
          target: 'loan-list-row-link',
          title: 'Open the loan',
          body: 'Click the loan reference to open the loan screen.',
          action: 'click',
        },
        {
          target: 'loan-servicing-actions',
          title: 'Payoff letters',
          body: 'Click Payoff letters. They state how much will close the loan on each day up to a date.',
          action: 'click',
        },
        {
          target: 'payoff-letter-form',
          title: 'Issue a letter',
          body: 'Choose For (The borrower or Another lender (takeover)), Valid for (days) from 1 to 30, the addressee or acquiring lender, then click Issue letter.',
        },
        {
          target: 'payoff-letter-view',
          title: 'View and print',
          body: 'Click View to open a letter’s text, then Print to give it to the borrower or the other lender.',
        },
        {
          target: 'payoff-settle-letter',
          title: 'Settle against the letter',
          body: 'When the money arrives, enter the Payment reference when settling and click Settle on an ISSUED letter. The letter becomes USED and the loan CLOSED.',
        },
        {
          target: 'loan-servicing-actions',
          title: 'Early settlement',
          body: 'To settle today without a letter, click Early settlement.',
          action: 'click',
        },
        {
          target: 'payoff-settlement-quote',
          title: 'Get a quote',
          body: 'Leave Quote as of blank and click Get quote. Tell the borrower the Payable amount; settlement is always posted on the business date.',
        },
        {
          target: 'payoff-statements-letters',
          title: 'Statements and letters',
          body: 'Here you can produce a Statement for any period. Once the loan is CLOSED a Closure letter button appears; nothing is posted when you generate these.',
        },
      ],
    },
    {
      id: 'collections-queue',
      title: 'Work the collections queue',
      summary:
        'Claim a collection task, record its outcome, copy borrower notices and find the worst past-due loans.',
      startPath: '/lending/collections',
      pages: ['/lending/collections'],
      demoAccount: 'collections',
      steps: [
        {
          target: 'coll-business-date',
          title: 'Business date & end-of-day',
          body: 'Delinquency is worked out by the end-of-day batch, not as you type. Finance (or a loan operations maker) runs it here; until it runs, the figures are as of the last run.',
        },
        {
          target: 'coll-queue-filters',
          title: 'Your queue',
          body: 'Pick your Queue and a Status. Open tasks are calls, visits and legal reviews waiting for a collector.',
        },
        {
          target: 'coll-task-row',
          title: 'A collection task',
          body: 'Each row shows the loan, the borrower and phone, the task with its stage and queue, DPD and the overdue amount.',
        },
        {
          target: 'coll-task-claim',
          title: 'Claim it',
          body: 'Click Claim to make the task yours, so no other collector can complete it.',
          action: 'click',
        },
        {
          target: 'coll-task-outcome',
          title: 'Record outcome',
          body: 'After the call or visit, click Record outcome.',
          action: 'click',
        },
        {
          target: 'coll-outcome-form',
          title: 'Outcome and note',
          body: 'Pick the outcome, for example promise to pay, and type a Note with the date and amount promised. Click Save to mark the task DONE.',
        },
        {
          target: 'coll-notices',
          title: 'Borrower notices',
          body: 'Choose Falling due (reminder) or Overdue and click Copy message to paste into your SMS tool. Nothing is sent from this card.',
        },
        {
          target: 'coll-past-due-link',
          title: 'Past-due loans',
          body: 'Every loan with DPD above 0, worst first. Click a reference to open the loan and act on it.',
        },
      ],
    },
  ],

  lessons: [
    {
      id: 'disbursement-four-eyes',
      title: 'Disbursement: prepare, approve, execute',
      summary:
        'How a booked loan is paid out in three steps by at least two people, and what it posts.',
      minutes: 8,
      objectives: [
        'Name the three steps of a disbursement and who does each',
        'Explain why the maker cannot approve or execute their own disbursement',
        'Check the prerequisites: conditions precedent, down payment, open period',
        'Read the journal a disbursement posts',
      ],
      explainer: {
        kind: 'handoff',
        actors: ['Ops maker', 'Ops checker'],
        stages: [
          {
            actor: 0,
            label: 'Prepare',
            caption:
              'The maker opens the BOOKED loan, sets the value date and clicks Prepare disbursement. A PENDING task is created.',
          },
          {
            actor: 1,
            label: 'Approve',
            caption:
              'A different person approves it, signed in with an authenticator code and within their approval limit. The task is APPROVED.',
          },
          {
            actor: 1,
            label: 'Pay by bank or cash',
            caption:
              'The system does not send money itself. The checker pays through the usual bank or cash process and notes the reference.',
          },
          {
            actor: 1,
            label: 'Execute',
            caption:
              'The checker names any payees, enters the External reference and clicks Execute disbursement. The loan becomes ACTIVE.',
          },
          {
            actor: 0,
            label: 'Rejected? Prepare again',
            caption:
              'If the checker rejects the task, the maker can prepare a new one, for example with a corrected value date.',
          },
        ],
      },
      tourId: 'disbursement',
      guide: { chapter: '06-disbursement', anchor: 'step-1--prepare-the-disbursement' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'disb-q1',
            prompt: 'Who can execute (pay out) a disbursement?',
            options: [
              'Anyone with the execute permission, including the person who prepared it',
              'A checker who did not prepare it; the person who approved it may execute it',
              'Only the borrower’s loan officer',
              'Only a finance officer',
            ],
            answer: 1,
            explanation:
              'The person who prepared the disbursement cannot execute it. A checker executes it, and the approver is allowed to.',
          },
          {
            id: 'disb-q2',
            prompt: 'What do you need to approve a disbursement?',
            options: [
              'Nothing beyond the approve permission',
              'A second approver from finance',
              'An authenticator (MFA) sign-in, an approval limit that covers the amount, and not being its maker',
              'The borrower’s signature on the screen',
            ],
            answer: 2,
            explanation:
              'Approval needs a multi-factor sign-in, an amount within your approval limit, and you must not have prepared it.',
          },
          {
            id: 'disb-q3',
            prompt: 'Your connection drops after you click Execute disbursement, and you click it again. What happens?',
            options: [
              'The system recognises the repeat and does not pay out twice',
              'The loan is paid out twice and must be reversed',
              'The loan is cancelled',
            ],
            answer: 0,
            explanation:
              'A repeat of the same execution is recognised; no second payout is posted.',
          },
          {
            id: 'disb-q4',
            prompt: 'Execution is refused with "Conditions precedent outstanding". What do you do?',
            options: [
              'Execute again with a different external reference',
              'Ask finance to reopen the month',
              'Reject the task and prepare a new one',
              'Have the conditions satisfied or waived on the application',
            ],
            answer: 3,
            explanation:
              'All conditions precedent on the application must be SATISFIED or WAIVED before a disbursement can be executed.',
          },
        ],
      },
    },
    {
      id: 'disbursement-journal',
      title: 'What a disbursement posts',
      summary: 'The journal entry a disbursement writes to the lending ledger.',
      minutes: 5,
      objectives: [
        'Read the journal lines of a DISBURSEMENT event',
        'Explain why cash paid out can be less than the booked principal',
        'Find the journal under Financial events on the loan',
      ],
      explainer: {
        kind: 'ledger',
        stages: [
          {
            label: 'Principal receivable',
            caption:
              'Example: a 1,000.00 loan with a 20.00 fee deducted from the proceeds. Executing debits Loans receivable with the full booked principal: the borrower now owes it.',
            entries: [{ account: 'Loans receivable', side: 'DR', amount: '1,000.00' }],
          },
          {
            label: 'Cash paid out',
            caption:
              'Cash is credited with the net amount actually paid: the principal less fees deducted from the proceeds.',
            entries: [{ account: 'Cash', side: 'CR', amount: '980.00' }],
          },
          {
            label: 'Fee earned',
            caption:
              'The deducted fee is credited to Fee income (any tax on it goes to Tax payable). Debits and credits balance.',
            entries: [{ account: 'Fee income', side: 'CR', amount: '20.00' }],
          },
        ],
      },
      guide: { chapter: '06-disbursement', anchor: 'step-3--execute-pay-out' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'disb-j-q1',
            prompt: 'Which account is debited with the booked principal when a disbursement is executed?',
            options: ['Cash', 'Loans receivable', 'Fee income'],
            answer: 1,
            explanation: 'The borrower now owes the principal, so Loans receivable is debited.',
          },
          {
            id: 'disb-j-q2',
            prompt: 'Why can the cash paid out be less than the booked principal?',
            options: [
              'Fees can be deducted from the proceeds',
              'Interest for the first month is kept back',
              'The system rounds payouts down to whole dollars',
            ],
            answer: 0,
            explanation:
              'The disbursement task is for the net amount: principal less any fees deducted from the proceeds.',
          },
          {
            id: 'disb-j-q3',
            prompt: 'Where do you see the journal lines of the disbursement?',
            options: [
              'In the Open tasks card',
              'On the Schedule card',
              'In Financial events: click the arrow on the DISBURSEMENT row',
            ],
            answer: 2,
            explanation: 'Each event row in Financial events expands to show its journal lines.',
          },
        ],
      },
    },
    {
      id: 'posting-repayments',
      title: 'Posting a repayment',
      summary: 'Record a borrower’s payment and read how it was allocated and posted.',
      minutes: 8,
      objectives: [
        'Post a repayment on an ACTIVE loan with its value date and reference',
        'Choose what happens to money beyond what is due',
        'Explain the allocation order and that advance money is used first',
        'Read the REPAYMENT journal under Financial events',
      ],
      explainer: {
        kind: 'ledger',
        stages: [
          {
            label: 'Money received',
            caption:
              'Example: the borrower pays 120.00 when 5.00 penalty, 15.00 interest and 100.00 principal are due. Cash is debited with what was received.',
            entries: [{ account: 'Cash', side: 'DR', amount: '120.00' }],
          },
          {
            label: 'Penalties and fees',
            caption:
              'The product’s allocation order applies, for example penalties and fees first. Here the penalty is cleared.',
            entries: [{ account: 'Penalty receivable', side: 'CR', amount: '5.00' }],
          },
          {
            label: 'Then interest',
            caption: 'Next the interest due is cleared from Interest receivable.',
            entries: [{ account: 'Interest receivable', side: 'CR', amount: '15.00' }],
          },
          {
            label: 'Then principal',
            caption:
              'What is left reduces the principal owed. Overpayments go to Customer advances or prepay principal, as you chose.',
            entries: [{ account: 'Loans receivable', side: 'CR', amount: '100.00' }],
          },
        ],
      },
      tourId: 'post-repayment',
      guide: { chapter: '07-repayments-and-payments', anchor: '2-posting-a-repayment' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'repay-q1',
            prompt: 'A loan is BOOKED. Where is the Post repayment button?',
            options: [
              'It is in Servicing actions as usual',
              'It is under Open tasks',
              'It does not appear: repayments are posted only on ACTIVE loans',
            ],
            answer: 2,
            explanation: 'The Post repayment button only appears for ACTIVE loans.',
          },
          {
            id: 'repay-q2',
            prompt: 'The borrower has money held on advance and pays again. What is used first?',
            options: [
              'The money held on advance',
              'The new payment',
              'Whichever is larger',
            ],
            answer: 0,
            explanation: 'Money held on advance is always used first, before new money.',
          },
          {
            id: 'repay-q3',
            prompt: 'The borrower wants to repay the whole loan today. What do you use?',
            options: [
              'Post repayment with the full balance',
              'Post repayment and choose Prepay principal',
              'A fee waiver',
              'Early settlement',
            ],
            answer: 3,
            explanation:
              'An ordinary repayment of the same amount would not close the loan correctly; always use Early settlement.',
          },
          {
            id: 'repay-q4',
            prompt: 'How do you see how a repayment was split across instalments?',
            options: [
              'Download Export CSV from the loans list',
              'Expand the REPAYMENT row in Financial events and read Allocation',
              'Open the Agreement versions card',
            ],
            answer: 1,
            explanation:
              'Expanding the event row shows the journal lines and the allocation by instalment and component.',
          },
        ],
      },
    },
    {
      id: 'payoff-and-closure',
      title: 'Payoff letters, settlement and closure',
      summary: 'Close a loan early with a settlement quote or a payoff letter, then give the closure letter.',
      minutes: 8,
      objectives: [
        'Get an early settlement quote and settle on the business date',
        'Issue a payoff letter for the borrower or a taking-over lender',
        'Settle against an ISSUED payoff letter',
        'Print a closure letter for a CLOSED loan',
      ],
      explainer: {
        kind: 'flow',
        stages: [
          {
            label: 'ACTIVE loan',
            caption:
              'The borrower, or another bank taking the loan over, asks how much it takes to close the loan.',
          },
          {
            label: 'Quote or letter',
            caption:
              'Early settlement gives today’s Payable amount. A payoff letter states the amount for each day up to 30 days ahead.',
          },
          {
            label: 'Money received',
            caption:
              'Settle under the quote, or click Settle on the ISSUED letter. If anything was posted since the letter, issue a new one.',
          },
          {
            label: 'CLOSED',
            caption:
              'A SETTLEMENT event is posted and the loan becomes CLOSED. A letter settled against becomes USED.',
          },
          {
            label: 'Closure letter',
            caption:
              'In Statements and letters, click Closure letter, then Print. Nothing is posted when you generate it.',
          },
        ],
      },
      tourId: 'payoff-closure',
      guide: { chapter: '07-repayments-and-payments', anchor: '5-payoff-letters-good-through-quotes' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'payoff-q1',
            prompt: 'You got a settlement quote for next Friday, then click Settle today. What happens?',
            options: [
              'The loan settles at Friday’s amount',
              'You are told the settlement amount on the business date; get the quote again with Quote as of blank',
              'The settlement is scheduled for Friday',
            ],
            answer: 1,
            explanation:
              'Settlement is always posted on the business date. To promise an amount for a future date, issue a payoff letter.',
          },
          {
            id: 'payoff-q2',
            prompt: 'For how long can a payoff letter be valid?',
            options: ['1 to 7 days', '1 to 90 days', 'Until the loan matures', '1 to 30 days'],
            answer: 3,
            explanation: 'Valid for (days) accepts 1 to 30.',
          },
          {
            id: 'payoff-q3',
            prompt: 'Settling against a letter is refused because "The balance has changed since letter X was issued". What now?',
            options: [
              'Issue a new payoff letter',
              'Reverse the latest repayment',
              'Settle with a different payment reference',
            ],
            answer: 0,
            explanation:
              'Something was posted after the letter was issued (for example a repayment or penalty). Issue a new letter.',
          },
          {
            id: 'payoff-q4',
            prompt: 'When does the Closure letter button appear?',
            options: [
              'As soon as a payoff letter is issued',
              'For any ACTIVE loan',
              'Once the loan is CLOSED, in Statements and letters',
            ],
            answer: 2,
            explanation:
              'The closure letter is available once the loan is CLOSED, by settlement or final repayment.',
          },
        ],
      },
    },
    {
      id: 'dpd-buckets-stages',
      title: 'Days past due, buckets and stages',
      summary: 'How the end-of-day batch ages a loan into delinquency buckets and collection stages.',
      minutes: 6,
      objectives: [
        'Explain how days past due are counted',
        'Name the standard delinquency buckets',
        'Name the standard collection stages and when a loan reaches them',
        'Explain how tasks are escalated or cured',
      ],
      explainer: {
        kind: 'ageing',
        buckets: [
          { label: 'CURRENT', fromDays: 0, toDays: 0 },
          { label: 'DPD 1 30', fromDays: 1, toDays: 30 },
          { label: 'DPD 31 60', fromDays: 31, toDays: 60 },
          { label: 'DPD 61 90', fromDays: 61, toDays: 90 },
          { label: 'DPD 90 PLUS', fromDays: 91 },
        ],
        stages: [
          {
            days: 0,
            label: 'Current',
            caption:
              'Every instalment due has been paid. The standard product templates show the bucket CURRENT.',
          },
          {
            days: 1,
            label: 'REMINDER',
            caption:
              'One unpaid instalment is enough. At the end-of-day batch the loan reaches the REMINDER stage and a task is created.',
          },
          {
            days: 31,
            label: 'FIELD_FOLLOW_UP',
            caption:
              'At 31 DPD the loan moves to FIELD_FOLLOW_UP. The open reminder task is closed as CANCELLED, outcome ESCALATED.',
          },
          {
            days: 91,
            label: 'RECOVERY',
            caption:
              'From 91 DPD the loan is in bucket DPD 90 PLUS and the RECOVERY stage. Your products may use other bands and stages.',
          },
          {
            days: 0,
            label: 'Cured',
            caption:
              'When the borrower catches up, DPD returns to 0 and every open task is closed as CANCELLED, outcome CURED.',
          },
        ],
      },
      guide: { chapter: '11-collections-and-recovery', anchor: '1-days-past-due-buckets-and-collection-stages' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'dpd-q1',
            prompt: 'When are days past due, buckets and stages updated?',
            options: [
              'As soon as a payment is posted',
              'During the end-of-day batch',
              'Once a month at period close',
            ],
            answer: 1,
            explanation:
              'The figures are worked out by the end-of-day batch; until it runs, they are as of the last run.',
          },
          {
            id: 'dpd-q2',
            prompt: 'In the standard templates, which stage does a loan reach at 31 days past due?',
            options: ['REMINDER', 'RECOVERY', 'FIELD_FOLLOW_UP', 'WRITE_OFF'],
            answer: 2,
            explanation: 'The standard ladder is REMINDER from 1, FIELD_FOLLOW_UP from 31 and RECOVERY from 91 DPD.',
          },
          {
            id: 'dpd-q3',
            prompt: 'What happens to open collection tasks when the borrower catches up?',
            options: [
              'They are closed automatically as CANCELLED with outcome CURED',
              'They stay open until a collector records an outcome',
              'They move to the next stage',
            ],
            answer: 0,
            explanation: 'When DPD returns to 0, every open task on the loan is closed with outcome CURED.',
          },
        ],
      },
    },
    {
      id: 'collections-work-queue',
      title: 'Working the collections queue',
      summary: 'Claim collection tasks, record outcomes and use notices and the past-due list.',
      minutes: 8,
      objectives: [
        'Filter the Collector work queues by queue and status',
        'Claim a task and record its outcome with a note',
        'Record a promise to pay and know what the system does and does not track',
        'Copy borrower notices and find the worst past-due loans',
      ],
      explainer: {
        kind: 'flow',
        stages: [
          {
            label: 'End of day',
            caption:
              'The batch creates one task per stage for each arrears episode. SMS and notice tasks are DONE at once; calls, visits and legal reviews wait.',
          },
          {
            label: 'OPEN in the queue',
            caption: 'The task appears in its stage’s queue under Collector work queues.',
          },
          {
            label: 'Claim',
            caption: 'A collector clicks Claim. Now only they can complete it.',
          },
          {
            label: 'Call or visit',
            caption:
              'Make contact. A promise to pay is recorded as the outcome with a note of the date and amount.',
          },
          {
            label: 'DONE',
            caption:
              'Record outcome, then Save. The task shows the outcome and note.',
          },
        ],
      },
      tourId: 'collections-queue',
      guide: { chapter: '11-collections-and-recovery', anchor: '22-collector-work-queues' },
      quiz: {
        passMark: 4,
        questions: [
          {
            id: 'coll-q1',
            prompt: 'What does clicking Claim on a task do?',
            options: [
              'Marks the task DONE',
              'Makes the task yours so other collectors cannot complete it',
              'Sends an SMS to the borrower',
            ],
            answer: 1,
            explanation: 'Claiming takes the task; only the collector who claimed it can then complete it.',
          },
          {
            id: 'coll-q2',
            prompt: 'A borrower promises to pay 50 next Tuesday. How is that recorded?',
            options: [
              'In a separate Promises to pay screen that tracks kept and broken promises',
              'As a repayment with a future value date',
              'As the outcome promise to pay, with the date and amount in the Note',
              'It cannot be recorded',
            ],
            answer: 2,
            explanation:
              'The platform records a promise only as a task outcome with a note. It does not track the date or amount, or mark it kept or broken.',
          },
          {
            id: 'coll-q3',
            prompt: 'What does Copy message on the Borrower notices card do?',
            options: [
              'Copies the ready-made message so you can paste it into your SMS or messaging tool',
              'Sends the message to the borrower by SMS',
              'Creates a collection task',
            ],
            answer: 0,
            explanation: 'Nothing is sent from this card; you copy the message and send it yourself.',
          },
          {
            id: 'coll-q4',
            prompt: 'You see "Another collector holds this task." Why?',
            options: [
              'The loan was cured',
              'Your role cannot record outcomes',
              'The end-of-day batch is running',
              'Another collector claimed it; only they can complete it',
            ],
            answer: 3,
            explanation: 'Only the collector who claimed a task can complete it.',
          },
          {
            id: 'coll-q5',
            prompt: 'How is the Past-due loans list ordered?',
            options: [
              'By loan reference',
              'Worst first, by days past due',
              'By branch',
            ],
            answer: 1,
            explanation: 'Every loan with DPD above 0 is listed worst first.',
          },
        ],
      },
    },
  ],

  pathLessons: {
    'loan-operations': [
      'disbursement-four-eyes',
      'disbursement-journal',
      'posting-repayments',
      'payoff-and-closure',
    ],
    collections: ['posting-repayments', 'dpd-buckets-stages', 'collections-work-queue'],
    finance: ['disbursement-journal', 'posting-repayments'],
    'loan-officer': ['posting-repayments'],
    'risk-compliance': ['dpd-buckets-stages'],
    auditor: ['disbursement-four-eyes', 'disbursement-journal', 'posting-repayments'],
  },
};
