import {
  connectionsTable,
  constellationsTable,
  labelsTable,
  notesTable,
  starsTable,
  type db as Db,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

const LABELS = [
  { key: "work", name: "Work", color: "#8FB3E8" },
  { key: "ideas", name: "Ideas", color: "#B9A6E8" },
  { key: "personal", name: "Personal", color: "#E8A6BC" },
  { key: "goals", name: "Goals", color: "#E8CF8F" },
] as const;

type LabelKey = (typeof LABELS)[number]["key"];

interface DemoStar {
  key: string;
  title: string;
  label: LabelKey | null;
  x: number;
  y: number;
  /** Days before now the star was created. */
  daysAgo: number;
  /** [hours after star creation, body, edited hours later?] */
  notes: Array<[number, string, number?]>;
}

const STARS: DemoStar[] = [
  // Launch Season (work)
  {
    key: "roadmap",
    title: "Q1 roadmap",
    label: "work",
    x: -520,
    y: -260,
    daysAgo: 58,
    notes: [
      [1, "Three themes for the quarter: faster onboarding, calmer notifications, and fixing search. Everything else waits."],
      [26, "Talked with Priya. She thinks search should go first because support tickets are piling up there.", 2],
      [170, "Final order: search, onboarding, notifications. Writing it down so I stop re-deciding."],
      [400, "Halfway check: search shipped a week early. Onboarding is the risky one now."],
    ],
  },
  {
    key: "onboarding",
    title: "Onboarding redesign",
    label: "work",
    x: -330,
    y: -120,
    daysAgo: 52,
    notes: [
      [3, "New users drop off at step three. The form asks for too much before they've seen anything useful."],
      [50, "Idea: let people try the product with sample data first, ask for details later."],
      [210, "Prototype tested with five people. Four finished without help. Keeping it."],
    ],
  },
  {
    key: "interviews",
    title: "Customer interviews",
    label: "work",
    x: -610,
    y: -40,
    daysAgo: 45,
    notes: [
      [2, "Recurring theme: people want fewer, quieter notifications, not more settings."],
      [74, "Maya (design agency) said the weekly summary email is the only one she reads."],
    ],
  },
  {
    key: "offsite",
    title: "Team offsite",
    label: "work",
    x: -420,
    y: 80,
    daysAgo: 30,
    notes: [
      [5, "Two days, no laptops in the morning sessions. Afternoons for planning."],
      [96, "Booked the cabin by the lake. Need to sort food and a rainy-day plan."],
    ],
  },
  // The Garden Plan (personal)
  {
    key: "garden",
    title: "Spring garden",
    label: "personal",
    x: 360,
    y: -300,
    daysAgo: 50,
    notes: [
      [1, "This year: fewer plants, better soil. Three raised beds instead of five."],
      [30, "Measured the yard. The back corner gets six hours of sun, the side bed barely three."],
      [200, "Ordered seeds: cherry tomatoes, basil, snap peas, marigolds."],
      [420, "First sprouts on the windowsill this morning."],
      [600, "Moved the seedlings outside for an hour a day to harden them off."],
    ],
  },
  {
    key: "tomatoes",
    title: "Tomatoes & basil",
    label: "personal",
    x: 540,
    y: -180,
    daysAgo: 40,
    notes: [
      [4, "Plant basil between the tomatoes; supposedly it helps both."],
      [140, "Stake them early this time. Last year's collapsed in July."],
    ],
  },
  {
    key: "compost",
    title: "Compost bin",
    label: "personal",
    x: 300,
    y: -110,
    daysAgo: 36,
    notes: [
      [2, "Greens and browns, roughly one to three. Turn it every week or two."],
    ],
  },
  {
    key: "herbs",
    title: "Balcony herbs",
    label: "personal",
    x: 500,
    y: -10,
    daysAgo: 21,
    notes: [
      [6, "Rosemary, thyme, mint (in its own pot so it doesn't take over)."],
      [80, "The mint is already taking over its own pot."],
    ],
  },
  // Learning Japanese (goals)
  {
    key: "hiragana",
    title: "Hiragana",
    label: "goals",
    x: 80,
    y: 300,
    daysAgo: 34,
    notes: [
      [1, "Goal: all 46 characters by the end of the month."],
      [120, "Twenty-five down. The ones that look alike (ぬ and め) still trip me up."],
      [360, "All 46. Reading slowly, but reading."],
    ],
  },
  {
    key: "practice",
    title: "Daily practice",
    label: "goals",
    x: 260,
    y: 380,
    daysAgo: 26,
    notes: [
      [2, "Fifteen minutes after coffee, every day. Small enough that I can't talk myself out of it."],
      [170, "Twelve-day streak. Missed Sunday, started again Monday. That's the whole trick."],
      [300, "Started a tiny vocabulary deck: food words first, since I'll need those most."],
    ],
  },
  {
    key: "kyoto",
    title: "Trip to Kyoto",
    label: "goals",
    x: -60,
    y: 440,
    daysAgo: 14,
    notes: [
      [3, "Late autumn, for the leaves. Ten days, one base, day trips out."],
      [40, "Want to be able to order food and ask directions without pointing."],
    ],
  },
  // Loose stars
  {
    key: "books",
    title: "Book ideas",
    label: "ideas",
    x: -180,
    y: -400,
    daysAgo: 48,
    notes: [
      [2, "A short book about lighthouses and the people who kept them."],
      [300, "Or: letters between two strangers who only meet once, at the very end."],
    ],
  },
  {
    key: "tideclock",
    title: "App idea: tide clock",
    label: "ideas",
    x: 40,
    y: -180,
    daysAgo: 18,
    notes: [
      [1, "A clock face that shows the tide instead of the hour. Calm, glanceable, nothing else."],
    ],
  },
  {
    key: "morning",
    title: "Morning pages",
    label: null,
    x: -320,
    y: 300,
    daysAgo: 9,
    notes: [
      [2, "Three pages, longhand, before checking my phone. Mostly noise, sometimes a good thought."],
      [50, "Today's good thought: I don't need to finish everything I start."],
    ],
  },
  {
    key: "smiles",
    title: "Things that made me smile",
    label: null,
    x: 680,
    y: 260,
    daysAgo: 4,
    notes: [
      [1, "A dog on the bus wearing a tiny raincoat."],
      [30, "The neighbour's kid waving at every single car."],
      [60, "Finding a note from last year in a coat pocket: \"you're doing fine\"."],
    ],
  },
];

const CONNECTIONS: Array<[string, string]> = [
  ["roadmap", "onboarding"],
  ["roadmap", "interviews"],
  ["onboarding", "offsite"],
  ["interviews", "offsite"],
  ["garden", "tomatoes"],
  ["garden", "compost"],
  ["tomatoes", "herbs"],
  ["hiragana", "practice"],
  ["hiragana", "kyoto"],
];

const CONSTELLATIONS: Array<[string, string]> = [
  ["Launch Season", "roadmap"],
  ["The Garden Plan", "garden"],
  ["Learning Japanese", "hiragana"],
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Seeds a fresh sample sky for a (guest) user inside a transaction. */
export async function seedDemoSky(tx: Tx, userId: string) {
  const now = Date.now();

  const labelRows = await tx
    .insert(labelsTable)
    .values(
      LABELS.map((l, i) => ({
        userId,
        name: l.name,
        color: l.color,
        createdAt: new Date(now - 60 * DAY + i * HOUR),
      })),
    )
    .returning();
  const labelId = new Map<LabelKey, number>(
    LABELS.map((l, i) => [l.key, labelRows[i]!.id]),
  );

  const starIds = new Map<string, number>();
  for (const s of STARS) {
    const createdAt = new Date(now - s.daysAgo * DAY);
    const [row] = await tx
      .insert(starsTable)
      .values({
        userId,
        title: s.title,
        x: s.x,
        y: s.y,
        labelId: s.label ? labelId.get(s.label)! : null,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: starsTable.id });
    starIds.set(s.key, row!.id);

    const notes = s.notes
      .map(([h, body, editedAfter]) => {
        const at = createdAt.getTime() + h * HOUR;
        return {
          userId,
          starId: row!.id,
          body,
          createdAt: new Date(Math.min(at, now - HOUR)),
          editedAt:
            editedAfter !== undefined
              ? new Date(Math.min(at + editedAfter * HOUR, now - 30 * 60 * 1000))
              : null,
        };
      });
    if (notes.length) await tx.insert(notesTable).values(notes);
  }

  await tx.insert(connectionsTable).values(
    CONNECTIONS.map(([a, b]) => {
      const [from, to] = [starIds.get(a)!, starIds.get(b)!].sort((x, y) => x - y);
      return { userId, fromStarId: from!, toStarId: to! };
    }),
  );

  await tx.insert(constellationsTable).values(
    CONSTELLATIONS.map(([name, anchor]) => ({
      userId,
      name,
      anchorStarId: starIds.get(anchor)!,
    })),
  );
}
