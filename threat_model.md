# Threat Model

## Project Overview

Starlog is a personal journaling app that renders each topic as a "star" in a private
night-sky constellation. It is a pnpm monorepo:

- **Web** (`artifacts/starlog`): React + Vite SPA, canvas-rendered sky.
- **API** (`artifacts/api-server`): Express 5, Replit Auth (OIDC) with opaque session
  IDs stored in PostgreSQL. Routes under `/api`.
- **DB** (`lib/db`): PostgreSQL + Drizzle ORM. Tables: users/sessions (`auth.ts`),
  labels/stars/notes/connections/constellations (`sky.ts`).
- **Design mockup** (`artifacts/mockup-sandbox`): dev-only canvas prototype served at
  `/__mockup`.

Users are individuals keeping a private sky. There is also an unauthenticated "Try the
demo" flow that creates a temporary guest user (id prefixed `guest-`, `is_guest = true`)
with a real session and seeded sky, exercising the same API as a signed-in user.

## Assets

- **User session IDs** — 32-byte random opaque tokens in `sessions` table, sent via `sid`
  cookie or `Authorization: Bearer`. Compromise means account takeover.
- **OIDC tokens** — access/refresh tokens stored inside the session row.
- **Journal data** — stars, notes, labels, connections, constellations. All private PII.
- **Application secrets** — `DATABASE_URL`, `REPL_ID`, `ISSUER_URL` (env only).

## Trust Boundaries

- **Browser → API** — every `/api/*` request. Client is untrusted; all authorization is
  server-side.
- **API → PostgreSQL** — Drizzle with parameterized queries throughout.
- **API → Replit OIDC** — login/callback/logout and mobile token exchange.
- **Public → Authenticated** — only `/api/healthz`, `/api/auth/user`, `/api/login`,
  `/api/callback`, `/api/logout`, `/api/demo/start`, `/api/demo/end`, and
  `/api/mobile-auth/*` are reachable without a session. All sky/star/label/connection/dev
  routes require `requireAuth`.

## Scan Anchors

- Production entry points: `artifacts/api-server/src/routes/` (`auth.ts`, `sky.ts`,
  `stars.ts`, `labels.ts`, `connections.ts`, `demo.ts`, `dev.ts`, `health.ts`).
- Auth plumbing: `src/lib/auth.ts`, `src/middlewares/authMiddleware.ts`,
  `src/middlewares/requireAuth.ts`. App wiring/CORS: `src/app.ts`.
- Ownership scoping helpers: `src/lib/sky.ts` (`starBelongsTo`, `labelBelongsTo`,
  `loadStars`/`loadLabels` all filter by `userId`).
- Access control is consistently enforced: every read/write/delete query includes
  `eq(table.userId, userId)` or an ownership precheck. No IDOR found across sky resources.
- `/api/dev/*` is a "hidden" stress-test tool but is a real authenticated route scoped to
  the caller's own sky (bounded at 3000 stars); not dev-only in the build sense.
- `artifacts/mockup-sandbox` (served at `/__mockup`) is a dev-only design prototype; ignore
  unless proven production-reachable.
- Note rendering (`artifacts/starlog/src/lib/note-format.tsx`) builds React elements from a
  tiny Markdown subset — no `dangerouslySetInnerHTML`, no XSS sink for note bodies.

## Threat Categories

### Spoofing / Authentication

Authentication uses Replit OIDC with PKCE, state, and nonce verification
(`routes/auth.ts`). Sessions are opaque 32-byte random IDs, httpOnly + secure + sameSite
lax cookies, with server-side expiry and refresh. This is sound. Watch the open-redirect
in the login/logout `returnTo` flow (see findings): it enables phishing that abuses the
app's trusted domain.

### Tampering / Elevation of Privilege

All mutating routes require a valid session and scope every query to the caller's
`userId`, including ownership prechecks for cross-referenced objects (labels on stars,
stars on connections/constellations). No mass-assignment of `userId`/`role` is possible —
`userId` is always taken from the session, never the request body.

### Information Disclosure

Read/list/search/export endpoints all filter by `userId`; no cross-tenant leakage found.
CORS is configured to reflect any origin with credentials (`app.ts`), which is a
misconfiguration, but sameSite=lax cookies blunt credentialed cross-site reads (see
findings).

### Denial of Service

`/api/demo/start` is unauthenticated and creates a guest user plus a fully seeded sky on
each call with no rate limiting, relying only on opportunistic 2-day cleanup. Bounded
abuse risk; see findings.
