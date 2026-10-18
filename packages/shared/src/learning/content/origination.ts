import type { LearningModule } from '../types.js';

/**
 * Customers and origination: registering a borrower (manual chapter 03),
 * creating and submitting an application, reading the assessment and the
 * credit score, and the recommend / approve decisions (chapters 05 and 24).
 */
export const ORIGINATION_MODULE: LearningModule = {
  tours: [
    {
      id: 'create-borrower',
      title: 'Register a new borrower',
      summary: 'Find a borrower, then register a new one with the details the credit assessment needs.',
      startPath: '/borrowers',
      pages: ['/borrowers'],
      demoAccount: 'officer.pnh',
      steps: [
        {
          target: 'borrower-search',
          title: 'Search first',
          body: 'Check the customer is not registered already. A name matches any part of the first or last name; a phone or ID number must be typed in full, exactly as registered.',
          placement: 'bottom',
        },
        {
          target: 'borrower-row',
          title: 'The borrower register',
          body: 'Each row is a borrower. Hover over a row and click View to open the profile, with the Documents button and the Identity Verification (KYC) card.',
        },
        {
          target: 'borrower-new-button',
          title: 'Add a borrower',
          body: 'Click New Borrower to open the Add New Borrower form.',
          action: 'click',
          placement: 'bottom',
        },
        {
          target: 'borrower-form-name',
          title: 'Name',
          body: 'First Name and Last Name are required. Use made-up details when you practise.',
        },
        {
          target: 'borrower-form-phone',
          title: 'Phone number',
          body: 'Enter the full number, e.g. +855 …. The customer signs in to the borrower portal with it, and staff can only find them by the whole number.',
        },
        {
          target: 'borrower-form-id',
          title: 'National ID / Passport',
          body: 'Required. Like the phone number it is stored encrypted, so search needs the complete value.',
        },
        {
          target: 'borrower-form-income',
          title: 'Monthly income',
          body: 'Optional on this form, but the assessment uses it for the debt-service ratio. If a product limits that ratio and the income is blank, approval is refused.',
        },
        {
          target: 'borrower-form-save',
          title: 'Save the borrower',
          body: 'When you are ready, click Add Borrower. The borrower is placed in your branch with KYC Pending review; KYC must be Verified before an application for a product with a KYC check can be submitted.',
          placement: 'top',
        },
      ],
    },
    {
      id: 'create-application',
      title: 'Create and submit an application',
      summary: 'Start a draft for a borrower and product, enter the terms, check the schedule and send it for credit review.',
      startPath: '/lending/applications',
      pages: ['/lending/applications'],
      demoAccount: 'officer.pnh',
      steps: [
        {
          target: 'app-new-button',
          title: 'Start an application',
          body: 'Click New application to open the form above the list.',
          action: 'click',
          placement: 'bottom',
        },
        {
          target: 'app-find-borrower',
          title: 'Find the borrower',
          body: 'Type a name, or the full phone or ID number, and click Search. In the demo, search for Sokha, whose KYC is already verified.',
        },
        {
          target: 'app-borrower-select',
          title: 'Choose the borrower',
          body: 'Pick the borrower from the Borrower list. You can instead paste the borrower ID in …or paste borrower UUID.',
        },
        {
          target: 'app-product-select',
          title: 'Choose the product',
          body: 'Only products with an active version are listed. The terms you enter must fit this product\'s limits.',
        },
        {
          target: 'app-terms',
          title: 'Enter the terms',
          body: 'Principal and Disbursement date are required. Leave Number of instalments and Annual rate (%) blank to use the product defaults.',
          placement: 'top',
        },
        {
          target: 'app-create-draft',
          title: 'Create the draft',
          body: 'Click Create draft application. It opens in DRAFT with a reference such as APP-…, and the product\'s conditions precedent are added.',
          action: 'click',
          placement: 'top',
        },
        {
          target: 'app-simulate',
          title: 'Check the schedule',
          body: 'Simulate shows the repayment schedule, fees and effective rate for the current terms. Nothing is saved.',
          placement: 'bottom',
        },
        {
          target: 'app-required-docs',
          title: 'Required documents',
          body: 'The product\'s document list: ticked when on file, amber when mandatory and missing. Add files with Upload document.',
        },
        {
          target: 'app-actions',
          title: 'Complete and submit',
          body: 'Upload documents and add collateral or guarantees here. When the draft is complete, click Submit and confirm; the terms can no longer be edited after that.',
          placement: 'bottom',
        },
      ],
    },
    {
      id: 'read-assessment',
      title: 'Read the assessment and credit score',
      summary: 'Open a submitted application and read the Credit score card and the assessment stored with each decision.',
      startPath: '/lending/applications',
      pages: ['/lending/applications/'],
      demoAccount: 'analyst',
      steps: [
        {
          target: 'app-status-filter',
          title: 'Pick a scored application',
          body: 'Drafts are not scored yet. Filter on SUBMITTED, RECOMMENDED or APPROVED to find one that has a score.',
          placement: 'bottom',
        },
        {
          target: 'app-list-reference',
          title: 'Open the application',
          body: 'Click the Reference to open the application page.',
          action: 'click',
        },
        {
          target: 'app-score-card',
          title: 'The Credit score card',
          body: 'It sits under the Application card. The score is a recommendation only: the decision still goes through the normal recommendation and approvals.',
          placement: 'top',
        },
        {
          target: 'app-score-header',
          title: 'Score, grade and outcome',
          body: 'The score, the grade (A to D on the standard scorecard) and the outcome: Recommend approve, Refer or Recommend decline. Scorecard and Stage show which version scored it and when.',
          placement: 'bottom',
        },
        {
          target: 'app-score-factors',
          title: 'Factors',
          body: 'One bar per characteristic: points earned out of the most it could earn, with the reason underneath. "missing" means the data or the consent was not there. Input snapshot, below, lists every value the score used.',
        },
        {
          target: 'app-score-adverse',
          title: 'Adverse reasons',
          body: 'The main reasons the score is lower than it could be, biggest first. What the customer is told shows the plain reasons you may give, never points or cut-offs.',
          placement: 'left',
        },
        {
          target: 'app-score-challenger',
          title: 'Challenger (shadow)',
          body: 'If the product runs a challenger scorecard, its score is shown here for comparison. It does not affect the decision.',
          placement: 'top',
        },
        {
          target: 'app-score-rerun',
          title: 'Re-run score',
          body: 'Credit analysts and approvers can re-score a DRAFT, SUBMITTED or RECOMMENDED application, e.g. after collateral is added or alternative data is verified. It records no decision.',
          placement: 'left',
        },
        {
          target: 'app-decision-row',
          title: 'The assessment behind each decision',
          body: 'Credit decisions lists every recommendation and approval. Open assessment on a row to see the affordability, loan-to-value, guarantor and score figures stored with it.',
          placement: 'top',
        },
      ],
    },
    {
      id: 'recommend-approve',
      title: 'Recommend and approve an application',
      summary: 'The credit analyst recommends a submitted application; a different person, the credit approver, approves or rejects it.',
      startPath: '/lending/applications',
      pages: ['/lending/applications/'],
      demoAccount: 'analyst',
      steps: [
        {
          target: 'app-status-filter',
          title: 'Find your work',
          body: 'As an analyst, filter on SUBMITTED; as an approver, on RECOMMENDED. Your Home page shows the same work as Applications to assess and Waiting for your credit decision.',
          placement: 'bottom',
        },
        {
          target: 'app-list-reference',
          title: 'Open the application',
          body: 'Click the Reference to open it. Review the documents, collateral, guarantees and the Credit score card before you decide.',
          action: 'click',
        },
        {
          target: 'app-actions',
          title: 'Your decision buttons',
          body: 'An analyst sees Recommend on a SUBMITTED application; an approver sees Approve on a RECOMMENDED one. A greyed-out button shows why when you hover; Why can\'t I… lists every reason. Click Recommend or Approve to open the form.',
          action: 'click',
          placement: 'bottom',
        },
        {
          target: 'app-decision-recommendation',
          title: 'Recommendation',
          body: 'Choose APPROVE or REJECT. Either way the status becomes RECOMMENDED and the approver makes the final decision.',
        },
        {
          target: 'app-decision-rationale',
          title: 'Rationale',
          body: 'Explain your reasoning in at least 3 characters. It is kept with the decision and its assessment for the next person and for audit.',
        },
        {
          target: 'app-decision-submit',
          title: 'Record the decision',
          body: 'When you are ready, click the button to record it. To approve you must not have created or recommended the application, the amount must be within your approval limit, and you must have signed in with your authenticator code.',
          placement: 'top',
        },
        {
          target: 'app-decision-row',
          title: 'Credit decisions',
          body: 'Each RECOMMEND, APPROVE and REJECT is listed here, oldest first. With multi-level approval the status stays RECOMMENDED until every required approver, each a different person, has approved.',
          placement: 'top',
        },
      ],
    },
  ],

  lessons: [
    {
      id: 'loan-lifecycle',
      title: 'The loan lifecycle',
      summary: 'How a loan moves from a draft application to a closed account, and who acts at each step.',
      minutes: 5,
      objectives: [
        'Name the application statuses from DRAFT to BOOKED',
        'Say which role acts at each status',
        'Explain why each credit decision needs a different person',
        'Know that booking opens a loan account but moves no money',
      ],
      explainer: {
        kind: 'flow',
        stages: [
          {
            label: 'Draft application',
            caption: 'The relationship officer creates the application, uploads documents and adds collateral or guarantees. Terms can still change.',
          },
          {
            label: 'Submitted',
            caption: 'On Submit the system checks KYC, documents and age rules, then assesses and scores the application. Terms are frozen.',
          },
          {
            label: 'Recommended',
            caption: 'A credit analyst, not the creator, recommends APPROVE or REJECT with a rationale. The assessment is stored with it.',
          },
          {
            label: 'Approved',
            caption: 'A credit approver, a different person, approves within their limit and signed in with their authenticator. Some amounts need several approvers.',
          },
          {
            label: 'Booked',
            caption: 'A loan operations maker books the agreement. A loan account opens in BOOKED with the schedule fixed; no money moves yet.',
          },
          {
            label: 'Disbursed to closed',
            caption: 'After conditions precedent are met the loan is paid out and becomes ACTIVE, is repaid, and is CLOSED when fully repaid or settled.',
          },
        ],
      },
      guide: { chapter: '05-applications-and-credit-decisions', anchor: 'the-application-pipeline' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'loan-lifecycle-q1',
            prompt: 'What does an analyst\'s recommendation of REJECT do to the application\'s status?',
            options: [
              'It becomes REJECTED',
              'It becomes RECOMMENDED; the approver decides',
              'It goes back to DRAFT',
              'It stays SUBMITTED',
            ],
            answer: 1,
            explanation: 'The status becomes RECOMMENDED whichever way the analyst recommends. The approver makes the final decision; use Reject to stop an application.',
          },
          {
            id: 'loan-lifecycle-q2',
            prompt: 'What happens when an approved application is booked?',
            options: [
              'The loan is paid out to the borrower',
              'The first repayment is collected',
              'A loan account opens in BOOKED; no money moves',
            ],
            answer: 2,
            explanation: 'Booking creates the agreement and a loan account with the schedule fixed. The money is paid out later, at disbursement.',
          },
          {
            id: 'loan-lifecycle-q3',
            prompt: 'Who may approve an application created by a relationship officer and recommended by an analyst?',
            options: [
              'A credit approver who is neither of them, within their limit',
              'The analyst who recommended it',
              'The relationship officer who created it',
              'Anyone with access to Applications',
            ],
            answer: 0,
            explanation: 'Maker-checker: the approver must be a different person from the creator and the recommender, and the amount must be within their approval authority.',
          },
          {
            id: 'loan-lifecycle-q4',
            prompt: 'Until when can the terms of an application be edited?',
            options: [
              'Until it is approved',
              'Until it is booked',
              'While it is DRAFT',
              'At any time before disbursement',
            ],
            answer: 2,
            explanation: 'Terms can only change while the application is a draft. Submitting freezes them.',
          },
        ],
      },
    },
    {
      id: 'onboard-a-borrower',
      title: 'Register a borrower',
      summary: 'Register a new customer with the details that identity checks and the credit assessment rely on.',
      minutes: 6,
      tourId: 'create-borrower',
      objectives: [
        'Search the borrower register before adding a customer',
        'Fill in the required fields of Add New Borrower',
        'Explain why Monthly Income matters for the assessment',
        'Know the KYC status a new borrower starts with',
      ],
      explainer: {
        kind: 'flow',
        stages: [
          {
            label: 'Search the register',
            caption: 'Search by name, or the full phone or ID number, so the same customer is not registered twice.',
          },
          {
            label: 'New Borrower',
            caption: 'Fill in name, phone, National ID / Passport and address, plus monthly income and expenses.',
          },
          {
            label: 'Add Borrower',
            caption: 'The borrower is saved in your branch. A borrower without a branch cannot have a loan application.',
          },
          {
            label: 'KYC Pending review',
            caption: 'Every new borrower starts with KYC Pending review. Staff check the identity documents and verify or reject.',
          },
          {
            label: 'Ready to apply',
            caption: 'Once KYC is Verified, an application can be submitted for products that check KYC.',
          },
        ],
      },
      guide: { chapter: '03-customers-and-documents', anchor: 'register-a-new-borrower' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'onboard-a-borrower-q1',
            prompt: 'You search for a borrower by the last four digits of their phone number and find nothing. Why?',
            options: [
              'The borrower does not exist',
              'Phone and ID numbers are stored encrypted, so only the full number matches',
              'Search only works on names',
            ],
            answer: 1,
            explanation: 'Phone and ID numbers must be typed in full, exactly as registered. Part of a phone number finds nothing.',
          },
          {
            id: 'onboard-a-borrower-q2',
            prompt: 'What KYC status does a newly registered borrower have?',
            options: ['Verified', 'Rejected', 'Pending review'],
            answer: 2,
            explanation: 'A new borrower starts with KYC Pending review until staff check the identity documents.',
          },
          {
            id: 'onboard-a-borrower-q3',
            prompt: 'Why should you fill in Monthly Income even though the form does not require it?',
            options: [
              'It is used for the debt-service ratio; approval can be refused without it',
              'The borrower cannot sign in to the portal without it',
              'It sets the borrower\'s branch',
              'It is printed on the loan agreement',
            ],
            answer: 0,
            explanation: 'If a product limits the debt-service ratio and the income is blank, approval is refused with "Monthly income is needed to assess affordability."',
          },
          {
            id: 'onboard-a-borrower-q4',
            prompt: 'A product has an age rule. What happens when you submit an application for a borrower with no date of birth?',
            options: [
              'The age rule is skipped',
              'Submission is refused: the date of birth is required for this product',
              'The system estimates the age from the ID number',
            ],
            answer: 1,
            explanation: 'The Add New Borrower form has no date of birth field; ask your administrator / IT team to record it, otherwise submission is refused.',
          },
        ],
      },
    },
    {
      id: 'create-an-application',
      title: 'Create and submit an application',
      summary: 'Start a draft for a borrower and product, complete it and send it for credit review.',
      minutes: 8,
      tourId: 'create-application',
      objectives: [
        'Create a draft application for a borrower and product',
        'Enter the terms and check them with Simulate',
        'Upload the documents the product requires',
        'Submit the application and know what the system checks',
      ],
      explainer: {
        kind: 'flow',
        stages: [
          {
            label: 'New application',
            caption: 'Find the borrower and choose a product that has an active version.',
          },
          {
            label: 'Enter the terms',
            caption: 'Principal and disbursement date are required; blank instalments and rate use the product defaults.',
          },
          {
            label: 'Draft created',
            caption: 'The application opens in DRAFT with a reference such as APP-…, and the product\'s conditions precedent are added.',
          },
          {
            label: 'Complete the file',
            caption: 'Upload documents, add collateral and guarantees, and use Simulate to check the schedule and cost.',
          },
          {
            label: 'Submit',
            caption: 'The system checks KYC, required documents, age and minimum income. If all pass, the status becomes SUBMITTED.',
          },
          {
            label: 'Analyst queue',
            caption: 'The application is scored and appears in the credit analysts\' Applications to assess queue.',
          },
        ],
      },
      guide: { chapter: '05-applications-and-credit-decisions', anchor: 'create-an-application' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'create-an-application-q1',
            prompt: 'Which products appear in the Product list of a new application?',
            options: [
              'Every product in the catalogue',
              'Only products with an active version',
              'Only products the borrower has used before',
            ],
            answer: 1,
            explanation: 'Only products with an active version can take applications. If yours is missing, ask the product team to activate a version.',
          },
          {
            id: 'create-an-application-q2',
            prompt: 'You leave Annual rate (%) blank. What rate is used?',
            options: ['Zero', 'The rate of the borrower\'s last loan', 'The product default', 'The form refuses a blank rate'],
            answer: 2,
            explanation: 'Blank Number of instalments and Annual rate (%) mean the product defaults are used.',
          },
          {
            id: 'create-an-application-q3',
            prompt: 'What does Simulate do?',
            options: [
              'Shows the schedule, fees and effective rate; nothing is saved',
              'Submits the application for a test approval',
              'Re-runs the credit score',
            ],
            answer: 0,
            explanation: 'Simulate shows the repayment schedule, fees and effective rate for the current terms without saving anything.',
          },
          {
            id: 'create-an-application-q4',
            prompt: 'Submit is refused with "The borrower\'s KYC must be verified." What do you do?',
            options: [
              'Edit the terms and submit again',
              'Ask an approver to override it',
              'Create a new application for another product',
              'Have the borrower\'s identity verified, then submit again',
            ],
            answer: 3,
            explanation: 'When the product\'s workflow has a KYC check, the borrower must be Verified before the application can be submitted.',
          },
          {
            id: 'create-an-application-q5',
            prompt: 'Can you change the principal after you submit?',
            options: [
              'Yes, with Edit terms',
              'No, terms can only change while the application is a draft',
              'Yes, until it is approved',
            ],
            answer: 1,
            explanation: 'Submission freezes the terms. The confirmation says so: "Terms can no longer be edited after submission."',
          },
        ],
      },
    },
    {
      id: 'read-the-credit-assessment',
      title: 'Read the assessment and credit score',
      summary: 'Understand the affordability checks and the Credit score card an approver relies on.',
      minutes: 8,
      tourId: 'read-assessment',
      objectives: [
        'Name what the assessment checks: affordability, coverage, loan-to-value, guarantors and score',
        'Read the score, grade and outcome on the Credit score card',
        'Use the factors, adverse reasons and Input snapshot to explain a score',
        'Know that Recommend approve is only a recommendation',
      ],
      explainer: {
        kind: 'points',
        attributes: [
          { name: 'Base score', value: 'Everyone starts here', points: 450 },
          { name: 'Affordability', value: 'Instalments 38% of income', points: 80 },
          { name: 'Conduct with us', value: 'Example: past loans repaid', points: 60 },
          { name: 'Age', value: 'Example: 41 years', points: 40 },
          { name: 'Credit bureau', value: 'missing (not connected)', points: 0 },
        ],
        grades: [
          { grade: 'D', min: 0 },
          { grade: 'C', min: 550 },
          { grade: 'B', min: 620 },
          { grade: 'A', min: 700 },
        ],
        stages: [
          {
            label: 'Base score',
            caption: 'Everyone starts with the scorecard\'s base score. All figures here are an example.',
          },
          {
            label: 'Characteristics',
            caption: 'Each characteristic adds or takes away points for its band, e.g. instalments up to 45% of income earn +80.',
          },
          {
            label: 'Missing data',
            caption: 'When data is not available or there is no consent, the "when missing" points are given and the factor is labelled missing.',
          },
          {
            label: 'Grade',
            caption: 'The total falls in a grade band: here 630 is grade B on the example bands (A 700+, B 620–699, C 550–619, D below 550).',
          },
          {
            label: 'Outcome',
            caption: 'The product\'s strategy turns the grade into Recommend approve, Refer or Recommend decline. People still recommend and approve.',
          },
        ],
      },
      guide: { chapter: '24-scorecards-and-alternative-data', anchor: '4-reading-the-credit-score-card-on-an-application' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'read-the-credit-assessment-q1',
            prompt: 'The Credit score card says "This application has not been scored yet." What is the most likely reason?',
            options: [
              'The application is still a DRAFT',
              'The borrower has no credit bureau record',
              'The approver has not signed in with MFA',
            ],
            answer: 0,
            explanation: 'Applications are scored at submission, so the card stays empty while the application is a draft (unless someone clicks Re-run score).',
          },
          {
            id: 'read-the-credit-assessment-q2',
            prompt: 'The outcome is Recommend approve. What happens next?',
            options: [
              'The application is approved automatically',
              'It skips the analyst and goes to booking',
              'It still needs the analyst\'s recommendation and every required approval',
              'Only the approval limit check is skipped',
            ],
            answer: 2,
            explanation: 'There is no automatic approval. The recommendation, every approval level, approval limits and authenticator sign-in still apply.',
          },
          {
            id: 'read-the-credit-assessment-q3',
            prompt: 'How is the debt-service ratio worked out?',
            options: [
              'Loan amount ÷ collateral value',
              'Average monthly repayment ÷ the borrower\'s monthly income',
              'Annual net operating income ÷ annual debt service',
            ],
            answer: 1,
            explanation: 'Affordability compares the average monthly repayment with the borrower\'s monthly income. The other two are loan-to-value and debt-service coverage.',
          },
          {
            id: 'read-the-credit-assessment-q4',
            prompt: 'What is the dashed Challenger box for?',
            options: [
              'It is the score the approver must use',
              'It replaces the score when the customer is thin-file',
              'It decides the rate add-on',
              'It shows how another scorecard would judge the customer; it does not affect the decision',
            ],
            answer: 3,
            explanation: 'The challenger is a shadow score for comparison. Do not use it to decide the application.',
          },
        ],
      },
    },
    {
      id: 'recommend-and-approve',
      title: 'Recommend and approve',
      summary: 'Make a credit decision as analyst or approver under the four-eyes rule.',
      minutes: 7,
      tourId: 'recommend-approve',
      objectives: [
        'Record a recommendation with a rationale',
        'Approve within your approval limit with an authenticator sign-in',
        'Explain the four-eyes rule for credit decisions',
        'Know what happens with multi-level approval',
      ],
      explainer: {
        kind: 'handoff',
        actors: ['Credit analyst', 'Credit approver'],
        stages: [
          {
            actor: 0,
            label: 'Review SUBMITTED',
            caption: 'The analyst, who did not create the application, reviews documents, collateral, guarantees and the score.',
          },
          {
            actor: 0,
            label: 'Recommend',
            caption: 'The analyst chooses APPROVE or REJECT and writes a rationale. The status becomes RECOMMENDED.',
          },
          {
            actor: 1,
            label: 'Read the case',
            caption: 'The approver reads the Credit score card, the recommendation and its assessment in Credit decisions.',
          },
          {
            actor: 1,
            label: 'Approve or reject',
            caption: 'A different person approves within their limit, signed in with their authenticator code; or rejects, which is final.',
          },
          {
            actor: 1,
            label: 'APPROVED',
            caption: 'When every required approval is recorded the status becomes APPROVED, ready for loan operations to book.',
          },
        ],
      },
      guide: { chapter: '05-applications-and-credit-decisions', anchor: 'recommend' },
      quiz: {
        passMark: 4,
        questions: [
          {
            id: 'recommend-and-approve-q1',
            prompt: 'You click Approve but see "This action requires signing in with multi-factor authentication". What do you do?',
            options: [
              'Ask the analyst to approve instead',
              'Sign out and sign in again with your authenticator code',
              'Re-run the score',
              'Reject and recreate the application',
            ],
            answer: 1,
            explanation: 'Approvals need a sign-in with your authenticator code. Sign out and sign in again with the code.',
          },
          {
            id: 'recommend-and-approve-q2',
            prompt: 'The amount is above your approval authority. What happens?',
            options: [
              'Approval is refused; an approver with a higher limit must decide',
              'You can approve if you write a longer rationale',
              'The system splits the loan',
            ],
            answer: 0,
            explanation: '"The amount exceeds your approval authority": pass it to an approver with a higher limit.',
          },
          {
            id: 'recommend-and-approve-q3',
            prompt: 'The product needs two approvals at this amount. You approve first. What is the status?',
            options: ['APPROVED', 'BOOKED', 'RECOMMENDED, waiting for the next approver', 'SUBMITTED'],
            answer: 2,
            explanation: 'With multi-level approval the status stays RECOMMENDED until the required number of approvals, each from a different person, is reached.',
          },
          {
            id: 'recommend-and-approve-q4',
            prompt: 'Which of these people may recommend an application?',
            options: [
              'The relationship officer who created it',
              'The approver who will approve it',
              'Anyone who can see the application',
              'A credit analyst who did not create it',
            ],
            answer: 3,
            explanation: 'The recommender must not be the creator, and the approver must be different from both.',
          },
          {
            id: 'recommend-and-approve-q5',
            prompt: 'Approval is refused with "Approval requirements are not met." Why can this happen even after a recommendation?',
            options: [
              'Approval re-runs the assessment, and a rule such as debt-service ratio or loan-to-value is not met',
              'Recommendations expire after one hour',
              'The analyst recommended REJECT',
            ],
            answer: 0,
            explanation: 'The system re-runs the assessment at approval. Recommending does not stop on assessment problems; they are recorded for the approver.',
          },
        ],
      },
    },
  ],

  pathLessons: {
    'loan-officer': ['onboard-a-borrower', 'loan-lifecycle', 'create-an-application'],
    'credit-analyst': ['loan-lifecycle', 'read-the-credit-assessment', 'recommend-and-approve'],
    'credit-approver': ['read-the-credit-assessment', 'recommend-and-approve'],
    'loan-operations': ['loan-lifecycle'],
    'risk-compliance': ['read-the-credit-assessment'],
  },
};
