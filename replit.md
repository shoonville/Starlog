# Starlog

A calm journal where each thought or topic is a glowing star in your own night-sky constellation, holding a thread of timestamped notes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React + Vite (`artifacts/starlog`), sky rendered on HTML canvas
- API: Express 5 (`artifacts/api-server`), Replit Auth (OIDC) with sessions in Postgres
- DB: PostgreSQL + Drizzle ORM; Zod validation; Orval codegen from OpenAPI

## Where things live

- API contract: `lib/api-spec/openapi.yaml`
- DB schema: `lib/db/src/schema/` (`auth.ts` users/sessions, `sky.ts` labels/stars/notes/connections/constellations/tasks)
- API routes: `artifacts/api-server/src/routes/`
- Demo sky content: `artifacts/api-server/src/lib/demoSeed.ts`
- Browser auth hook: `lib/replit-auth-web`

## Architecture decisions

- "Try the demo" creates a temporary guest user (id prefixed `guest-`, `is_guest = true`) with a real session and a freshly seeded sky, so the demo uses the exact same API as signed-in users. Guests older than 2 days are deleted on the next demo start; ending the demo deletes the guest immediately (cascade).
- A constellation is stored as a name + anchor star; its members are the connected component containing the anchor, computed on the client. Deleting an anchor star re-anchors the name to a neighbour.
- Connections are stored normalized (`from_star_id < to_star_id`) with a unique pair index.
- `GET /api/sky` returns the whole sky in one call; notes are loaded per star when its card opens.
- Deletes (stars and notes) are deferred on the client for 5 s so they can be undone; the item is hidden meanwhile and the DELETE is sent when the timer ends (or immediately on page close via keepalive fetch). See `artifacts/starlog/src/lib/pending-deletes.ts`.
- Note bodies are stored as plain text with a tiny Markdown subset (`**bold**`, `*italic*`, `- ` bullets), rendered in the card and stripped for search/"On this day" snippets.
- A star's `updatedAt` means "last written/edited": note add/edit/delete, rename and relabel bump it; moving a star does not. The recent panel sorts by it.
- "On this day" matches notes by day-of-month in the viewer's time zone (`tz` query param). The demo seeds one note dated this day last month using the tz sent to `/demo/start`.
- Tasks ship inside `GET /api/sky` (not a separate endpoint) so the client can patch them optimistically. "Today"/"overdue" are computed on the client from the viewer's local date; `PATCH /tasks/{id}` takes `today` so a checked-off repeating task spawns its next copy dated after today (once only, guarded by `spawnedNext`). A star's `task_order` is `auto` (overdue → date → priority) until the user drags a task, then `manual` until "Sort by date".
- Quick add parsing lives in `artifacts/starlog/src/lib/tasks.ts`: a `#tag` matches a star title, then the newest star with that label, then a title prefix, else an "Inbox" star (created on demand). The Today panel's "How did today go?" note goes to a "Daily log" star.
- Old pastel label colors are converted to the current palette when the API starts (`artifacts/api-server/src/lib/legacyColors.ts`).
- Hidden developer panel: press Shift+D in the sky (or add `?dev` to the URL) to add/remove 300 random "Stress test N" stars and watch fps.

## Product

- Pan/zoom night sky; create, drag, label and connect stars; journal card with timestamped, editable notes; color-label legend with highlight; named constellations; search; timeline replay; Markdown/JSON export; keyboard shortcuts (N, /, R, Ctrl+Z, Esc); recent-stars panel; "On this day"; undo for deletes; formatted notes with word count; private skies per account plus a demo sky.
- Tasks on each star (Notes/Tasks tabs in the card, with switcher chips for the other stars in the constellation), a faint progress ring around stars with tasks, a Today panel (badge on the Today button counts due/overdue tasks) and a quick-add box (`A`, `T` shortcuts on desktop).
- On phones the toolbar is Today, Search, + (quick add) and More. The star card opens as a bottom sheet at 90% height (drag down to half, further to close); the Today panel opens at about two-thirds and drags to full. Sheets stay above the keyboard; tap targets are at least 44px. The card's title row holds the star dot (opens label/color), the title, connect and a ⋯ menu (find a star to connect, delete); note formatting expands on focus.
- Phone connecting: hold a star ~0.5 s without moving to pick it; each tap on another star draws a line and moves the selection on (A → B → C), tapping an already-connected star removes that line, and tapping empty sky or Cancel ends it. A one-time tip ("Hold a star to connect it") is remembered in localStorage. Desktop keeps the halo-drag and toolbar connect flow.
- Card header: a constellation line (name tinted like on the sky, ▾ lists all constellations to fly to, plus Rename/Name and Remove name, edited in place) above compact star chips, both hidden for unconnected stars; a round color dot that opens the label picker; the active tab underline uses the star's color. On phones the close X sits at the right of the constellation line, the "Lit …" date is the first line of the notes thread, tabs are full-width with counts, there is no footer, and the constellation line and chips hide while the keyboard is open. Desktop keeps the label chips, date line and constellation footer.
- Visual theme: true-black (#000) sky for OLED, soft off-white text, lavender-purple accent for buttons/highlights, panels in #111114 with a thin border. The background starfield (mostly small faint dots, some medium, a few brighter, with slight cool/warm white tints) is pre-rendered once into offscreen tiles (two parallax layers moving slower than journal stars) plus a few slow twinklers drawn per frame; dots stay well under journal-star size with no glow, and are never hit-tested.
- Newly created connection strokes draw in softly. Canvas connection strokes and previews are clipped around constellation-name labels so the names remain unobstructed.

## Gotchas

- `lib/api-client-react` needs `dom.iterable` in its tsconfig `lib` because the auth spec has header parameters (generated code calls `Headers.entries()`).
- Don't use "Replit" in user-facing login text.
- In the web app, don't write JSX with explicit type arguments (`<Comp<T> ...>`): the dev server's Babel metadata plugin fails to parse it even though `tsc` passes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
