# Operations Runbook — Chirawa (Bringly)

The one document to open when production needs attention. Deep dives live in
[DEPLOYMENT.md](DEPLOYMENT.md), [ROLLBACK_DRILL.md](ROLLBACK_DRILL.md), and
[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) — this runbook tells you which of
those to reach for, and handles everything they don't.

**Food Delivery incidents** (stuck food payments, restaurant no-shows, food
refunds, rider pickups) have their own playbook: [FOOD_RUNBOOK.md](FOOD_RUNBOOK.md).

## 1. Topology — what is running where

One Hetzner VPS. Everything below lives on it; the only external services are
Cloudflare R2 (backups + images), Razorpay (payments), Fast2SMS (OTP/SMS),
FCM (push), and Sentry (errors).

| Component | What | How it runs |
|---|---|---|
| nginx | TLS, rate limiting, reverse proxy for `api.chirawa.in` | systemd; config source of truth: `scripts/nginx/chirawa.conf` |
| api | Fastify on :3000 | PM2 cluster ×4, `dist/index.js`, cwd `/opt/chirawa/apps/api` |
| worker | BullMQ jobs (settlements, reconciliation, assignment, cleanup, enrichment) | PM2 fork ×1, `dist/worker/index.js` |
| PostgreSQL | orders/payments source of truth | systemd, local |
| Redis | queues, cache, pub/sub event bus, socket adapter | systemd, local |

Logs: `/var/log/chirawa/{api,worker}-{out,error}.log` (JSON lines; rotation:
`scripts/logrotate/chirawa`, see DEPLOYMENT.md §9). Deploy audit trail:
`/var/log/chirawa/deploy-history.log` (never rotated).

## 2. Health & monitoring — how you find out something is wrong

Three signals, all of which should be wired to a monitor that pages:

| Signal | Endpoint / mechanism | Healthy looks like | Monitor setup |
|---|---|---|---|
| API liveness | `GET https://api.chirawa.in/health` | 200, `"status":"ok"` | uptime monitor (UptimeRobot/healthchecks.io/Pingdom), 1 min interval |
| API readiness | `GET https://api.chirawa.in/ready` | 200, `checks.database` and `checks.redis` both `true` | uptime monitor, 1–5 min; a 503 here means the process is up but DB/Redis is not |
| Worker liveness | worker pings `WORKER_HEARTBEAT_URL` every 60 s | monitor stays green | healthchecks.io-style check, **~3 min grace**; set its ping URL as `WORKER_HEARTBEAT_URL` in the server `.env` (DEPLOYMENT.md §8) |

Both health routes carry a 300 req/min rate-limit carve-out, so monitors can't
trip the global limiter. Production boot **warns** if `WORKER_HEARTBEAT_URL` is
unset — don't ignore that warning.

**Sentry** (errors, not liveness): both processes init with `SENTRY_DSN` set
(no-op otherwise), tagged `component: api|worker`. Alert rules to create once
in the Sentry project:

1. *Any event with tag `component:worker` and tag `jobName` (any value)* →
   notify. This fires only when a job has exhausted all 5 retries — it is the
   "money stopped moving" page.
2. *Any new issue with tag `component:api`* → notify. API 500s are captured
   with request context (reqId/method/url/userId) by the global error handler.

## 3. Restart procedures

```bash
pm2 status                      # always look before you touch
pm2 reload api                  # zero-downtime rolling reload of the 4 API workers
pm2 restart worker              # worker is fork-mode: restart, not reload (brief gap is fine —
                                #   BullMQ re-delivers; repeatable jobs re-arm on boot)
pm2 restart all                 # both, if in doubt
```

- **After `ecosystem.config.js` script/exec_mode changes**: `pm2 reload` does NOT
  apply those — run `pm2 delete api worker && pm2 start apps/api/ecosystem.config.js
  --env production && pm2 save` (DEPLOYMENT.md §4 step 4).
- **After changing `.env`**: PM2 does not re-read env files on reload —
  `pm2 restart api worker --update-env`.
- **Dependency order**: if Postgres/Redis were down, restore them first
  (`systemctl status postgresql redis`), then restart the app processes. The
  API will boot but report 503 on `/ready` until both are reachable.
- **Verify after any restart**: `curl -s localhost:3000/health`, then `/ready`,
  then `pm2 status` (watch the restart counter — climbing means crash-looping;
  go to §6).

## 4. Deployment & rollback (pointers — the detail lives elsewhere)

- **Deploy** = push/merge to `main` → CI (typecheck, tests, image build) →
  exact-SHA release on the server via `scripts/server-release.sh` (install →
  build → env:check → backup-guarded migrate → reload → health gates).
  Full flow + gates: [DEPLOYMENT.md](DEPLOYMENT.md) §2–3. Actions down:
  manual path in §5. **Merging `eng/p0-hardening` requires the one-time server
  migration in §4 first.**
- **Rollback** = re-release of a previous known-good SHA, migrations
  deliberately skipped: one-click `rollback.yml` workflow, or
  `scripts/rollback.sh` on the server. Decision guide (roll back vs fix
  forward vs restore) and verification: [ROLLBACK_DRILL.md](ROLLBACK_DRILL.md).
- **Bad migration / data damage** = database territory, not rollback:
  [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) (nightly verified backups in R2,
  restore drill, break-glass).

## 5. Payments operations

Background truth: payment state is reconciled automatically — the worker runs
`payment-reconcile` every 15 min (checks orders stuck `pending_payment` >30 min
against Razorpay and marks them paid), `payout-reconcile` every 30 min, and the
daily settlement at 11:00 IST. Razorpay's dashboard is the external source of
truth; Postgres `payments`/`orders` the internal one; amounts are integer paise
(ADR 002).

| Situation | What to do |
|---|---|
| Customer paid but order stuck `pending_payment` | Wait one reconcile cycle (≤15 min) first — it self-heals captured payments. Still stuck: check worker logs `grep reconciliation /var/log/chirawa/worker-out.log`, and the payment in the Razorpay dashboard. Reconciliation failures log `svc:"payments"` with the orderId and go to Sentry after retries. |
| Webhooks failing | Razorpay dashboard → Webhooks shows delivery attempts. Signature failures mean `RAZORPAY_WEBHOOK_SECRET` mismatch (never disable verification; the dev skip only activates on a `placeholder` secret). nginx throttles the webhook path at 60 r/m — Razorpay retries, so brief 503s self-heal. Missed webhooks are covered by reconciliation. |
| Refund needed | Cancellations of prepaid orders auto-refund the captured payment (logged, customer notified with the amount). Manual/partial cases: initiate in the Razorpay dashboard, then verify the order's payment rows match. Refunds take 1–3 days customer-side — that's Razorpay, not us. |
| COD disputes | The recorded amount is server-derived from the order total; a rider-client mismatch is logged as a warning (`COD amount mismatch`, svc:"orders") but never written. The order history table records who flipped the status and when. |
| Settlement didn't reach a seller | Check Sentry for a `jobName:daily-settlement`/payout event, then `grep settlement /var/log/chirawa/worker-out.log` (structured fields carry settlementId/amounts). RazorpayX payouts are a designed degradation — if unconfigured, settlements are recorded but money moves manually. |

Smoke test after payment-related changes: `scripts/test-payments.sh`.

## 6. Worker recovery

The heartbeat monitor fired, or `pm2 status` shows the worker down/looping:

1. `pm2 restart worker`, then `pm2 logs worker --lines 100 --nostream`. Boot is
   fail-fast: env validation and PG/Redis connectivity problems print exactly
   what's wrong.
2. Crash-looping on boot → usually env (run `pnpm --filter @chirawa/api
   env:check` on the server) or Redis/Postgres down (§3 dependency order).
3. **Restarts are always safe**: every queue has retry (5 attempts, exponential
   backoff) and jobs are idempotent; repeatable schedules re-arm on boot
   (deduplicated by job key); interrupted jobs re-deliver.
4. **After recovery, sweep for casualties**: failed jobs are retained in Redis
   for 7 days. `redis-cli keys 'bull:*:failed'` for counts, or point any BullMQ
   UI (e.g. `npx taskforce-connector`) at Redis to inspect/retry from the
   `failed` set. A job that exhausted its 5 attempts does NOT retry on restart —
   re-run it from the UI or wait for the next scheduled run (reconciliation
   passes are self-healing for payment state).
5. If the worker was down long: the next `payment-reconcile` catches stuck
   payments; `pending-payouts`/settlement runs pick up from persisted state.
   Verify money jobs specifically: `grep -E 'settlement|reconcil' worker-out.log`.

## 7. Incident response

**First five minutes, in order:**

```bash
curl -s https://api.chirawa.in/health        # 1. is the edge serving?
curl -s https://api.chirawa.in/ready         # 2. are DB/Redis reachable?
pm2 status                                   # 3. processes up? restart counters climbing?
df -h && free -m                             # 4. disk/memory (full disk breaks PG first)
pm2 logs api --lines 50 --nostream           # 5. what do the errors say?
pm2 logs worker --lines 50 --nostream
```

Plus Sentry (new issues, by `component` tag) and the heartbeat monitor's status
page. Cross-check: did a deploy just happen? (`tail /var/log/chirawa/deploy-history.log`).

| Symptom | Likely cause → action |
|---|---|
| `/health` down, `pm2 status` fine | nginx/TLS/DNS layer — `nginx -t && systemctl status nginx`, cert expiry, Cloudflare/DNS |
| `/health` ok, `/ready` 503 | Postgres or Redis — `systemctl status postgresql redis`, check `checks` in the /ready body for which |
| API up, errors spiking right after a deploy | bad release → rollback (§4); it's one click and skips migrations by design |
| Worker heartbeat stopped | §6 |
| Disk full | logs are the usual suspect if rotation isn't installed (DEPLOYMENT.md §9); also old backups — `du -sh /var/log/chirawa /opt/chirawa` |
| OTP/SMS not arriving | Fast2SMS dashboard/credits; failures are non-fatal and logged `svc:"otp"`/`svc:"sms"` — login is blocked only if Fast2SMS is down entirely |
| Push notifications silent | FCM is a designed degradation when unconfigured (boot warning). Configured: grep `svc:"fcm"` for send failures/invalid tokens |

**Severity guide**: money paths (payments, settlements, COD state) and
order flow are SEV-1 — act now, communicate to sellers if >15 min. Push/SMS/
enrichment are degradations the system is designed to survive — fix in hours,
not minutes.

**After any incident**: one short note in the team channel — what broke, how it
was detected, what fixed it, and the one thing that would have caught it sooner.
If detection was a customer report instead of a monitor, add the missing monitor
(§2) before closing the incident.

## 8. Routine operations calendar

| Cadence | Task | Reference |
|---|---|---|
| Monthly | Backup restore verification drill (non-destructive) | DISASTER_RECOVERY.md §3a |
| Quarterly | Rollback drill on a no-op release | ROLLBACK_DRILL.md §5 |
| Quarterly | Verify TLS cert auto-renewal, Fast2SMS balance, and R2 credential validity | — |
| After every deploy | The post-deploy checklist | DEPLOYMENT.md §10 |

## 9. Log field cheat-sheet

All production logs are JSON lines (pino). Useful grep keys:

- `svc` — subsystem: `payments`, `orders`, `otp`, `sms`, `fcm`, `event-bus`,
  `razorpay`, `distance`, `off-source`, `off-live`
- `proc:"worker"` — worker process lines; `jobName`/`jobId` — BullMQ jobs
- `orderId`, `settlementId`, `batchId`, `reqId` — correlation ids
- Request logs (API) are Fastify/pino with `reqId` matching the Sentry context

Example: every payment reconciliation failure today —
`grep '"svc":"payments"' /var/log/chirawa/api-out.log /var/log/chirawa/worker-out.log | grep -i reconcil`
