// supabase/functions/navi-chat/plan.ts
//
// NAVI v21 — Goal Planner.
//
// "Give me steps to start a business." "Help me plan my first EP."
// "How do I start a YouTube channel?" NAVI now answers goals with a real,
// numbered ACTION PLAN — domain-aware step banks for the goals its people
// actually chase (business, content, music, apps, fitness, money, learning,
// writing, events), plus a first-principles scaffold for any other goal.
//
// Deterministic, zero-I/O, returns '' when the message isn't a plan ask.

interface Domain {
  rx: RegExp;
  steps: string[];
}

const DOMAINS: Domain[] = [
  {
    rx: /\b(business|company|brand|side ?hustle|startup|shop|store)\b/,
    steps: [
      'Get specific: write one sentence — who you serve, what you solve, and what they pay. If you can\'t say it in one sentence, you\'re not ready to spend money on it.',
      'Talk to 5 real potential customers this week. Not friends being nice — people who\'d actually pay. Their objections are your homework.',
      'Build the smallest sellable version — one product, one service, one offer. No logo debates, no perfect website. Sellable beats polished.',
      'Make your first sale on foot or online — WhatsApp, Instagram, word of mouth. The first sale proves the idea; the tenth proves the business.',
      'Track money from day one: what comes in, what goes out, in a simple sheet. A business that doesn\'t know its numbers is a hobby with expenses.',
      'Only then formalise — registration, bank account, branding. Paperwork follows proof, not the other way around.',
    ],
  },
  {
    rx: /\b(youtube|channel|tiktok|instagram|content|podcast|vlog|streaming|social media)\b/,
    steps: [
      'Pick ONE lane and one platform. The algorithm rewards a clear promise — "this channel gives you X" — not variety.',
      'Study 5 creators one level ahead of you (not the giants). Note their hooks, their video length, what their comments beg for.',
      'Make your first 10 pieces without judging the numbers. Those 10 are tuition — you\'re learning speed, voice, and workflow.',
      'Lock a schedule you can actually keep — once a week beats daily-for-two-weeks-then-gone. Consistency is the strategy.',
      'After 10 posts, double down on what worked: check which one held attention longest and make 3 more like it.',
      'Engage like a human — reply to every early comment. Your first 100 true fans are recruited one at a time.',
    ],
  },
  {
    rx: /\b(song|album|ep\b|mixtape|music|beat|track|single)\b/,
    steps: [
      'Define the project: how many tracks, what feeling, who it\'s for. An EP with a theme beats a folder of loose songs.',
      'Block recording sessions in the calendar like appointments — inspiration shows up for people who are already working.',
      'Finish rough versions of everything BEFORE polishing anything. Done demos reveal which songs deserve the mix budget.',
      'Get outside ears at 80% done — two or three people whose taste you trust. Fix what they agree on; ignore what only one person says.',
      'Mix, master, and lock the final files. Set a hard release date so the tweaking has a deadline.',
      'Plan the release like a second project: cover art, distribution, one teaser per week for 3 weeks, and a launch-day push to everyone you know.',
    ],
  },
  {
    rx: /\b(app|website|web ?app|game|software|coding project|saas)\b/,
    steps: [
      'Write the one-line job of the app: "It helps [who] do [what]." Every feature that doesn\'t serve that line gets cut from version one.',
      'Sketch the 3 core screens on paper first. If it needs more than 3 screens to prove the idea, shrink the idea.',
      'Build the smallest working loop end-to-end — ugly is fine, broken is not. A thin slice that works beats a wide slice that doesn\'t.',
      'Put it in front of 5 real users within 2 weeks and watch them use it silently. Where they get stuck is your real to-do list.',
      'Ship, then iterate weekly: one improvement, one fix, every week. Momentum compounds; big rewrites kill projects.',
    ],
  },
  {
    rx: /\b(fit|fitness|gym|weight|muscle|run(?:ning)?|marathon|shape|healthy|health)\b/,
    steps: [
      'Set a target you can measure in 12 weeks — a number on the scale, a distance, a weight on the bar. "Get fit" isn\'t a target; "run 5K" is.',
      'Schedule 3 fixed training days a week. Put them in the calendar and treat them like work meetings — non-negotiable.',
      'Start at 60% of what you think you can do. The goal of month one is showing up 12 times, not being sore 12 times.',
      'Fix the food with ONE rule at a time — protein at every meal first, then water, then sugar. Stacked habits stick; overhauls collapse.',
      'Track every session in your phone — what you did, how it felt. Progress you can see is motivation you don\'t have to manufacture.',
      'Every 4 weeks, add a little — distance, weight, or a fourth day. Small progressive overload is the whole secret.',
    ],
  },
  {
    rx: /\b(save|saving|money|budget|debt|invest(?:ing)?|financ)\b/,
    steps: [
      'Know your real number: write down every rand in and out for one month. You can\'t fix what you refuse to look at.',
      'Pay yourself first — move a fixed amount to savings the day money lands, before anything else touches it. Even a small amount; the habit is the asset.',
      'Kill the most expensive debt first while paying minimums on the rest. Interest is a hole in the bucket — plug it before filling the bucket.',
      'Build a starter emergency fund — one month of expenses. That fund is what stops one bad surprise from restarting the whole journey.',
      'Automate everything you can: debit orders for savings and bills. Discipline you don\'t have to re-decide daily is discipline that lasts.',
      'Then grow: once the base is set, learn one investment vehicle properly before putting real money in it.',
    ],
  },
  {
    rx: /\b(learn|study|studying|language|skill|course|exam|matric|degree)\b/,
    steps: [
      'Define "done": what will you be able to DO in 90 days? "Hold a 5-minute conversation" beats "learn Spanish".',
      'Find one primary resource and commit to it — one course, one book, one teacher. Resource-hopping feels productive and teaches nothing.',
      'Practise daily in small blocks — 25 focused minutes beats a 3-hour Sunday binge. Frequency builds the wiring.',
      'Use it before you\'re ready: speak the language badly, build the small project, write the test essay. Retrieval is where learning actually happens.',
      'Test yourself weekly and keep an error list. Reviewing your own mistakes is the highest-yield studying there is.',
      'Find one person to learn with or report to. Accountability roughly doubles follow-through — that\'s free performance.',
    ],
  },
  {
    rx: /\b(book|novel|write a|writing|blog|devotional)\b/,
    steps: [
      'Write the premise in two sentences and the ending in one. Knowing where you\'re going turns writing into travelling instead of wandering.',
      'Outline the skeleton — 10 to 12 chapter beats. Each beat is one sentence: what changes in this chapter.',
      'Set a daily word count you can hit on your worst day — 300 words daily is a book in under a year.',
      'Draft forward only: no editing until the draft is DONE. The inner editor is banned from the first pass.',
      'Rest it for two weeks, then revise in full passes — structure first, then scenes, then sentences.',
      'Get 3 readers before you publish, and ask each one the same question: where were you bored?',
    ],
  },
  {
    rx: /\b(event|party|wedding|launch|conference|concert|show)\b/,
    steps: [
      'Lock the three anchors first: date, budget, venue. Everything else negotiates around those three.',
      'List every workstream — guests, food, sound, programme, decor — and give each ONE owner. Shared ownership is how things fall through.',
      'Work backwards from the date: what must be booked 8 weeks out, confirmed 4 weeks out, printed 1 week out.',
      'Confirm everything twice — once at booking, once 72 hours before. Vendors who were "sorted" months ago are where event day goes wrong.',
      'Plan day-of like a show: a run sheet with times, names, and phone numbers, printed in more than one pocket.',
      'Build in slack — 10% of budget unassigned and 30 empty minutes in the programme. Something WILL move; slack is what absorbs it.',
    ],
  },
];

const GENERIC_STEPS = (goal: string): string[] => [
  `Make it concrete: define what "done" looks like for "${goal}" — a number, a date, or a finished thing you can point at.`,
  'Break it into 3–4 milestones, each one small enough to finish inside two weeks.',
  'Pick the very first physical action — something you could do in the next 24 hours — and do it before the excitement fades.',
  'Put repeating time in your calendar for it. What has a time slot happens; what "you\'ll get to" doesn\'t.',
  'Track it visibly — a note, a checklist, a wall calendar with crosses. Seen progress feeds motivation.',
  'Tell one person who\'ll actually ask you about it. Accountability is the cheapest performance boost there is.',
];

const PLAN_RX: RegExp[] = [
  /^(?:please\s+|can you\s+|could you\s+)?(?:give me|make me|write me|draw up|create)\s+(?:a\s+|the\s+)?(?:plan|roadmap|game ?plan|action plan)\s+(?:to|for)\s+(.+)$/,
  /^(?:please\s+)?help me plan\s+(?:to\s+|for\s+)?(.+)$/,
  /^(?:please\s+|can you\s+)?(?:give me|show me|list)\s+(?:the\s+)?steps\s+(?:to|for)\s+(.+)$/,
  /^what are the steps\s+(?:to|for)\s+(.+)$/,
  /^how do i start\s+(.+)$/,
  /^i want to start\s+(.+?)\s*[—-]?\s*(?:help me plan(?: it)?|where do i start|give me a plan)$/,
];

/** Pull the goal out of an explicit plan ask, or null. */
export function parsePlanGoal(message: string): string | null {
  const t = message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 120) return null;
  for (const rx of PLAN_RX) {
    const m = t.match(rx);
    if (m) {
      // Articles and "my" are kept — "start a business" / "my first EP" read
      // naturally in the plan header. "how do i start X" becomes "start X".
      let goal = m[1].trim();
      if (rx.source.includes('how do i start') && !/^start\b/.test(goal)) {
        goal = `start ${goal}`;
      }
      if (goal && goal.split(/\s+/).length <= 8) return goal;
    }
  }
  return null;
}

const CLOSERS = [
  'Start with step 1 today — small and real beats big and imaginary.',
  'Don\'t try to do it all this week. Step 1, done properly, is the whole assignment.',
  'Read it once, then close it and go do step 1. Plans reward starters.',
];

/** A numbered, domain-aware action plan for an explicit goal ask, or ''. */
export function tryPlan(message: string): string {
  const goal = parsePlanGoal(message);
  if (!goal) return '';

  const domain = DOMAINS.find(d => d.rx.test(goal));
  const steps = domain ? domain.steps : GENERIC_STEPS(goal);
  const numbered = steps.map((s, i) => `${i + 1}. ${s}`).join('\n\n');
  const closer = CLOSERS[message.trim().length % CLOSERS.length];
  // "plan to start a business" but "plan for investing" / "plan for my first EP".
  const connector =
    /^(start|build|launch|make|create|write|learn|save|get|become|grow|finish|record|release|read|run|open|quit|lose)\b/.test(goal)
      ? 'to' : 'for';
  return `Here's your plan ${connector} ${goal}:\n\n${numbered}\n\n${closer}`;
}
