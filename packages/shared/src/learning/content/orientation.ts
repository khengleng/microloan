import type { LearningModule } from '../types.js';

/** Finding your way around the portal (manual chapter 01) and the Learning centre itself. */
export const ORIENTATION_MODULE: LearningModule = {
  tours: [
    {
      id: 'portal-orientation',
      title: 'Find your way around the portal',
      summary: 'The menu, your work queues, search, status chips, language, Help and the Learning centre.',
      startPath: '/home',
      pages: ['/home'],
      demoAccount: 'officer.pnh',
      steps: [
        {
          title: 'Welcome to the portal',
          body: 'This two-minute tour shows where things are. Use Next and Back, or the arrow keys; Esc ends the tour at any time.',
        },
        {
          target: 'nav-menu',
          title: 'The menu',
          body: 'Sections such as Customers, Origination, Loans and Finance. You only see the pages your roles allow, so a colleague may see a different menu.',
          placement: 'right',
        },
        {
          target: 'home-queues',
          title: 'Your work queues',
          body: 'Each tile is a queue of work waiting for you: You prepare (maker), You approve (checker) or For information. Click a tile to open the page where the work is done.',
        },
        {
          target: 'global-search',
          title: 'Search',
          body: 'Find borrowers, loans, applications and cases by name, phone, ID or reference. Press / or Ctrl+K anywhere to jump here.',
          placement: 'bottom',
        },
        {
          target: 'status-chips',
          title: 'Status chips',
          body: 'The business date postings use, your branch scope, your approval limit and whether you signed in with your authenticator code (MFA).',
          placement: 'bottom',
        },
        {
          target: 'language-switch',
          title: 'English or Khmer',
          body: 'Switch language here; you stay on the same page.',
          placement: 'bottom',
        },
        {
          target: 'help-link',
          title: 'Help',
          body: 'Opens the user guide. Lending pages also have a Help link to the chapter for that screen.',
          placement: 'bottom',
        },
        {
          target: 'nav-learn',
          title: 'Learning centre',
          body: 'Lessons, quizzes and guided tours for your role. Screens with a tour show a Take the tour button.',
          placement: 'right',
        },
      ],
    },
  ],
  lessons: [
    {
      id: 'portal-orientation',
      title: 'Finding your way around',
      summary: 'Where the menu, your work queues, search, the status chips and Help are, and what they tell you.',
      minutes: 8,
      objectives: [
        'Find a page through the menu and know why menus differ between colleagues',
        'Read your work queues on Home: You prepare, You approve, For information',
        'Search for a borrower, loan or application from anywhere',
        'Read the status chips: business date, scope, limit and MFA',
        'Switch between English and Khmer and open the user guide',
      ],
      explainer: {
        kind: 'screen',
        stages: [
          { area: 'menu', label: 'Menu', caption: 'Grouped by section. Items appear only when one of your roles allows them; a number shows work waiting for you there.' },
          { area: 'queues', label: 'My work', caption: 'Home lists your queues, oldest first and within your scope. Work you prepared yourself never appears in your own approval queue.' },
          { area: 'search', label: 'Search', caption: 'Type two or more characters of a name, phone, ID or reference. Only records you may open, in your scope, are found.' },
          { area: 'language', label: 'EN | KM', caption: 'Switches the language and keeps you on the same page.' },
          { area: 'help', label: 'Help', caption: 'The user guide, searchable, with a link from each lending page to its chapter.' },
          { area: 'content', label: 'The page', caption: 'Lending pages have tabs across the top that follow the same permission rules as the menu.' },
        ],
      },
      tourId: 'portal-orientation',
      guide: { chapter: '01-getting-started', anchor: '7-finding-your-way-around' },
      quiz: {
        passMark: 3,
        questions: [
          {
            id: 'menu-differs',
            prompt: 'A colleague sees a Period close item in the menu and you do not. Why?',
            options: [
              'Your browser has not loaded the page yet',
              'The menu only shows pages your roles allow',
              'Period close is only shown in Khmer',
              'Menus are chosen at random per branch',
            ],
            answer: 1,
            explanation: 'Menus come from your roles. Ask your administrator if you need a page you cannot see.',
          },
          {
            id: 'own-work',
            prompt: 'You prepared a disbursement. Where does it appear for approval?',
            options: [
              'In your own "to approve" queue',
              'Nowhere until you refresh twice',
              'In the queue of a checker, not in yours',
              'Only in the audit trail',
            ],
            answer: 2,
            explanation: 'Queues never include work you created yourself where a second person must act (maker-checker).',
          },
          {
            id: 'search-shortcut',
            prompt: 'Which keys jump to the search box from anywhere?',
            options: ['/ or Ctrl+K (⌘K on Mac)', 'F1', 'Ctrl+S', 'Shift+Enter'],
            answer: 0,
            explanation: 'Press / or Ctrl+K (⌘K on Mac). Esc closes the result list.',
          },
          {
            id: 'business-date',
            prompt: 'Which date are repayments and disbursements posted with?',
            options: [
              "Today's calendar date on your computer",
              'The date of your last sign-in',
              'The business date shown in the status chips',
            ],
            answer: 2,
            explanation: "Postings are dated by the organisation's business date, which finance moves forward at end of day.",
          },
        ],
      },
    },
  ],
  pathLessons: {
    'loan-officer': ['portal-orientation'],
    'credit-analyst': ['portal-orientation'],
    'credit-approver': ['portal-orientation'],
    'loan-operations': ['portal-orientation'],
    collections: ['portal-orientation'],
    finance: ['portal-orientation'],
    'product-team': ['portal-orientation'],
    'risk-compliance': ['portal-orientation'],
    auditor: ['portal-orientation'],
    'tenant-admin': ['portal-orientation'],
  },
};
