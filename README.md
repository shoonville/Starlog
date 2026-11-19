# Starlog

[Try Starlog](https://starlog.replit.app)

Starlog is a visual journal for projects, goals, habits, and everyday thoughts. Each one is a star in a personal night sky, with notes and tasks inside. Connect related stars into constellations and use the Today panel to see what is due.

## Features

- A pan-and-zoom night sky for organizing the parts of your life
- Timestamped, editable notes and task lists inside each star
- Constellations that connect related stars
- A Today panel for due and overdue tasks, plus a daily log
- Search, timeline, labels, themes, and Markdown or JSON export
- A separate demo sky for trying the app without mixing demo data with personal skies

## Getting started

The easiest way to run Starlog is in its Replit workspace. Click **Run** to start the configured web and API workflows.

For development, use Node.js 24 and pnpm:

```sh
pnpm install
pnpm run typecheck
PORT=3000 BASE_PATH=/ pnpm run build
```

The API requires a PostgreSQL database URL (`DATABASE_URL`). Replit supplies the app's runtime port and authentication configuration. Keep database connection strings and other secrets out of source control.

If you change the Drizzle schema, `pnpm --filter @workspace/db run push` applies it to the development database. Review production schema changes through Replit's publishing flow rather than using that command against production.

To regenerate the API client and validation schemas from the OpenAPI contract:

```sh
pnpm --filter @workspace/api-spec run codegen
```

## Project structure

- `artifacts/starlog` — React and Vite web app
- `artifacts/api-server` — Express API and authentication routes
- `lib/api-spec/openapi.yaml` — API contract
- `lib/api-zod` — generated request and response schemas
- `lib/db` — PostgreSQL schema and database client

Starlog uses Replit Auth and PostgreSQL. Signed-in users have separate skies. Demo visitors receive isolated guest skies that are automatically removed after 24 hours.

## License

MIT
