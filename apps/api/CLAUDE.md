# apps/api — backend engineering rules

## Context7: consult latest docs BEFORE writing backend code

**Standing rule:** before writing or modifying any backend code in this folder,
pull the latest official documentation for the relevant library via the
**Context7 MCP server** (configured in the repo root `.mcp.json`). A PreToolUse
hook in `.claude/settings.json` reminds on every `Write`/`Edit`/`MultiEdit`
under `apps/api/`.

Workflow each time:

1. `resolve-library-id` for the library you're about to use.
2. `get-library-docs` with that ID, pinned to the **installed major version**
   (see table below) and a `topic` describing what you're doing
   (e.g. `topic: "queue workers"`, `topic: "route schema validation"`).
3. Write code against what the docs say for that version — not from memory.

If Context7 is unreachable, say so explicitly and fall back to the official docs
site; do not silently write version-guessed code.

## Pinned versions (source of truth: `apps/api/package.json`)

Always request docs for the version actually installed here — not the latest release.

| Library    | Installed (`package.json`) | Doc version to request | Context7 ID (resolve to confirm) |
|------------|----------------------------|------------------------|----------------------------------|
| Fastify    | `^4.27.0`                  | **v4**                 | `/fastify/fastify`               |
| BullMQ     | `^5.7.0`                   | **v5**                 | `/taskforcesh/bullmq`            |
| Socket.IO  | `^4.7.5`                   | **v4**                 | `/socketio/socket.io`            |
| Prisma     | `^5.13.0`                  | **v5**                 | `/prisma/prisma`                 |
| Razorpay   | `^2.9.2`                   | **latest (node SDK)**  | `/razorpay/razorpay-node`        |

> The IDs above are the expected matches — always run `resolve-library-id`
> first and use whatever it returns, since IDs can change.

## Version gotchas to verify against the docs

- **BullMQ v5** — `QueueScheduler` was **removed**; delayed/repeatable jobs are
  handled by `Worker` directly. Do not reintroduce `QueueScheduler` (a v4 API).
  Confirm connection/options shapes against v5 docs.
- **Fastify v4** — plugin/encapsulation and `@fastify/*` plugin major versions
  are v4-aligned (already in deps: `@fastify/cors@9`, `@fastify/helmet@11`,
  `@fastify/rate-limit@9`, `@fastify/multipart@8`). Don't pull v5 plugin APIs.
- **Socket.IO v4** — verify server/adapter and CORS API against v4.
- **Prisma v5** — client generation, migration commands, and query API per v5.
- **Razorpay** — verify order/payment/webhook-signature APIs against the
  installed node SDK before touching payment flows.

## Notes

- This rule and the version pins exist to keep generated backend code
  production-ready and runnable against the exact dependencies installed.
- If you bump a major version in `package.json`, update this table in the same
  change so the docs lookups stay correct.
