# LeadLock — every lead has exactly one accountable owner

A multi-tenant business platform for 5–30 person sales teams: customizable CRM, guaranteed lead ownership with automatic escalation, and real integrations (WhatsApp via Twilio, Stripe test-mode payments, Google Calendar, Telegram alerts), with every action audited.

## Stack
- **Next.js 15** (App Router, TypeScript) — UI + REST API in one service
- **PostgreSQL** (Neon free tier) + **Drizzle ORM** (SQL migrations in `drizzle/`)
- **Background worker** inside the same Node process (`src/server/worker.ts`, started from `src/instrumentation.ts`): every second it escalates due leads and delivers the outbox. All timers are database rows, so they survive restarts.
- Hosting: **Render** free web service (+ cron-job.org pinging `/api/health` every 5 min to keep it awake)

## Architecture (Q14)
```
src/app/(pages)        presentation (server components) + src/components (client UI)
src/app/api/**         HTTP layer: auth, validation (zod), permission checks via api() wrapper
src/server/leads.ts    business rules: assignment, acknowledgement, escalation, recovery
src/server/crm.ts      CRM rules: custom fields, required stage fields, value masking, filters
src/server/payments.ts payment rules (provider-agnostic; Stripe is one adapter)
src/server/integrations/{twilio,stripe,google,telegram}.ts  provider adapters
src/server/worker.ts   timers + outbox with retry/backoff
src/db/schema.ts       data model
```

## Run locally
```bash
cp .env.example .env          # fill DATABASE_URL, ENCRYPTION_KEY (openssl rand -hex 32)
npm install
npm run db:migrate            # applies drizzle/*.sql, incl. the append-only audit trigger
npm run seed                  # demo workspace "Sunrise Solar" + 300 contacts
npm run dev                   # http://localhost:3000
```
Demo logins (password `demo12345`): `owner@sunrise.demo`, `manager@sunrise.demo`, `atta@sunrise.demo`, `adeen@sunrise.demo`. Public lead form: `/f/sunrise-solar`.

## Deploy (free)
1. Neon → create project → copy the **pooled** connection string.
2. Render → New → Web Service → this repo. Build `npm ci && npm run build`, start `npm start` (runs migrations first). Env: `DATABASE_URL`, `APP_URL` (the onrender.com URL), `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NODE_VERSION=22`.
3. `npm run seed` once against the Neon URL (optional demo data).
4. cron-job.org → GET `$APP_URL/api/health` every 5 minutes.
5. In the app → Integrations: connect Twilio, Stripe (webhook endpoint is created automatically), Telegram (webhook set automatically). Paste the shown Twilio webhook URL into the Twilio sandbox settings.
6. Google Cloud: OAuth client (Web) with redirect URI `$APP_URL/api/integrations/google/callback`; add demo Gmail accounts as test users.

## Requirements map — where to verify each item
| ID | Where / how |
|---|---|
| F1.1 | `/signup` creates workspace + Owner; session cookie (httpOnly, 7-day sliding) survives refresh; Log out ends it |
| F1.2 | Team & roles → invite (temp password), levels; Owner row is locked; only Owner edits Admins |
| F1.3 | Team & roles → permission matrix per role (view/create/edit/delete/export, rules, integrations, audit…) |
| F1.4 | Log in as `atta@` (Sales role lacks `crm.view_value`): values show “hidden” on board, contact page, dashboard, CSV export |
| F1.5 | Every API route goes through `api(perm, …)` → 403 JSON. e.g. `PUT /api/rules` as atta → 403 |
| F1.6 | All queries filter by session workspace; guessed IDs from another workspace → 404 |
| F2.1 / F2.8 | Contact page: company, opportunities, leads, WhatsApp conversation, payments, appointments, owner, activity |
| F2.2 / F2.3 | Pipelines & rules → contact fields + per-pipeline opportunity fields (Residential vs Commercial differ) |
| F2.4 | Residential “Proposal” requires Value + System size: move a card without them → blocked with message |
| F2.5 | Pipelines & rules → add / rename / reorder / delete stages (delete with opportunities asks where to move them); Pipeline board |
| F2.6 | Contacts → combine search, tag, stage, owner, source, dates, custom field → “Save list”; lists re-evaluate live |
| F2.7 | Activity history on contact page (notes, stage changes, assignments, edits, messages, payments, appointments) |
| F3.1 | `/f/<slug>` web form, inbound WhatsApp, Leads → manual entry; source badge on every lead |
| F3.2 | Team / My profile → Available, Busy, On leave, Offline |
| F3.3 | Pipelines & rules → round-robin among Available employees under “max open leads” |
| F3.4 | Live countdown on Leads, lead page, contact page; Telegram + in-app banner on assignment |
| F3.5 | Escalation chain editor: any number of levels (next available / backup / manager) with seconds per level |
| F3.6 | Set someone On leave → unacknowledged leads move instantly; acknowledged stay + flagged in Recovery (policy shown on Team page) |
| F3.7 | Recovery queue with reason badges |
| F3.8 | Per-workspace advisory lock + version check + deadline re-check in `escalateLead()` |
| F3.9 / I4 | Telegram alert to new owner with lead, source, reason, link; per-user linking via deep link; failures retried and listed on Integrations |
| F4.x | Audit log page (filters: type, user, date); Postgres trigger rejects UPDATE/DELETE/TRUNCATE on `audit_logs` |
| F5.x | Dashboard: 8 figures per Section 7 definitions, drill-down links, personal view for Users, customize (saved per user) |
| I1.x | Twilio webhook `/api/webhooks/twilio/<ws>` (signature-verified, idempotent on MessageSid), status callbacks, outbox retries, retry button, opt-out (incl. customer “STOP”) |
| I2.x | Payment link from opportunity (optionally sent on WhatsApp); Stripe webhook verified on raw body, de-duplicated by event id; paid / failed / expired / refunded; collected vs projected on Payments page |
| I3.x | My profile → Connect Google (OAuth, offline refresh); busy check + “Proceed anyway”; reschedule/cancel update Google; times stored UTC + IANA zone |
| I5.x | Integrations page: status, last worked, recent errors, limits, sync history with filters; secrets AES-256-GCM encrypted, masked |
| Q1–Q14 | bcrypt(12) passwords; login lockout after 5 failures/15 min; Origin-check CSRF; zod validation; React escaping; optimistic locking (409 on concurrent edit); pagination; loading/success/error on every action; 2.5 s live refresh |
