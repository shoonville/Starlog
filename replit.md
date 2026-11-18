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
- DB schema: `lib/db/src/schema/` (`auth.ts` users/sessions, `sky.ts` labels/stars/notes/connections/constellations)
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
- Hidden developer panel: press Shift+D in the sky (or add `?dev` to the URL) to add/remove 300 random "Stress test N" stars and watch fps.

## Product

- Pan/zoom night sky; create, drag, label and connect stars; journal card with timestamped, editable notes; color-label legend with highlight; named constellations; search; timeline replay; Markdown/JSON export; keyboard shortcuts (N, /, R, Ctrl+Z, Esc); recent-stars panel; "On this day"; undo for deletes; formatted notes with word count; private skies per account plus a demo sky.

## Gotchas

- `lib/api-client-react` needs `dom.iterable` in its tsconfig `lib` because the auth spec has header parameters (generated code calls `Headers.entries()`).
- Don't use "Replit" in user-facing login text.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
