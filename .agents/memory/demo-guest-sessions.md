---
name: Demo guest sessions
description: How "Try the demo" works and why it reuses the real API instead of a client-only store
---
"Try the demo" creates a real guest user (id prefix `guest-`, users.is_guest) with a real session and a seeded sky.

**Why:** one code path for demo and signed-in users; every hook and endpoint works identically, nothing to keep in sync.

**How to apply:** any new sky feature needs no special demo handling. Ownership checks must stay per-user. Before logging a guest in, the frontend ends the demo (deletes guest data). Stale guests (>24h, per the publishing requirements) are purged at startup, hourly and on each demo start. Per-account UI state (theme, seen tips) is never sent to the server for demo guests; it stays in localStorage.
