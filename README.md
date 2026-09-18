# Darkpools

A personal trading journal, deployed to https://darkpools.deeapps.net on an existing AWS server
that already hosts two other applications.

## Overview

Darkpools is a private journal for logging trades, reviewing execution and seeing whether the
numbers add up. One server holds a few accounts, each with its own journal that nobody else sees. It is built for a phone first and a desktop second: a dark, restrained
interface with green and red reserved for the sign of P&L.

### Features

- **Two-tap capture**: `/trades/new` is prefilled from the last trade with size presets and the
  planned stop up front; one tap saves an open trade and the details can wait. Notes take
  dictation where the browser supports it.
- **Trades**: stocks, options, futures, forex and crypto; long or short; quantity, entry and exit,
  multiplier, fees, stop and target, rating, markdown notes, a mistakes log, tags and screenshots.
  Net P&L, planned risk and the R-multiple are recomputed on every save.
- **R first**: results read in R-multiples with currency one tap away (or the other way round, per
  the setting); trades without a stop say so and stay out of R statistics.
- **Rules and the Tilt Ledger**: daily trade caps, daily loss caps in R or currency, time windows,
  stop required, max loss per trade, max size and hand-checked custom rules, evaluated on every
  save. Breaking one needs a one-line justification, and every break lands in the ledger.
- **Today**: pre-market check-in (plan, mood, sleep, focus, energy), a plan budget bar that turns
  amber at 70% and red at 100%, trades so far, rule events and the end-of-day review.
- **Dashboard**: KPI tiles, equity curve, daily bars, calendar heatmap, Edge Score with a radar and
  trend, the three-curve "what mistakes cost" chart, mistake costs, top symbols, results by tag,
  process streak and recent trades. Every chart has a table view.
- **Reports**: the leak finder with one-tap "Add rule", adherence by week, results split by rules
  followed versus broken, cost per rule, edge decay per setup, breakdowns by hour, weekday, hold
  time, size, R distribution, instrument, side and account, results by pre-open state, and a
  weekly review card with a share image.
- **Installable**: a PWA with shortcuts, offline shell and a share target that turns a screenshot
  from the phone's share sheet into a draft trade.
- **Sharing and ownership**: revocable read-only links for a trade or a week, saved CSV import
  mappings per broker, and full exports as JSON and CSV.
- **Accounts**: the first visit to `/setup` creates the admin account; there is no self-enrollment.
  The admin creates users under `/admin/users` with a temporary password shown once, resets
  passwords, deactivates, reactivates and deletes accounts. Users sign in by username, must
  replace a temporary password before anything else, and see only their own records; the admin
  manages accounts, never other people's journals.

The full scope is described in [`docs/product-spec.md`](docs/product-spec.md).

### Stack

Next.js (App Router, TypeScript), Tailwind CSS, Prisma with PostgreSQL, Zod, Recharts,
papaparse, bcryptjs + jose for sessions, vitest for unit tests and Playwright for the
end-to-end smoke test. The Docker image runs the standalone Next.js server.

## Local development

Requirements: Node.js 20.19 or newer (22 recommended), npm 10 and a PostgreSQL 16 server. The
runtime uses no native Node add-ons.

```bash
# 1. Install dependencies (also generates the Prisma client)
npm install

# 2. Configure the environment
cp .env.example .env            # then edit DATABASE_URL and SESSION_SECRET

# 3. Create the database schema
npx prisma migrate dev

# 4. Optional: sixty sample trades with tags for a demo owner
npm run seed                    # prints the demo credentials; never runs in production

# 5. Start the dev server
npm run dev                     # http://localhost:3000 -> /setup on first run
```

`next build` fetches the two Google Fonts once and self-hosts them. Behind a proxy that Node's
`fetch` does not pick up automatically, run the build with `NODE_USE_ENV_PROXY=1`.

A local PostgreSQL role can be created with
`createuser -P darkpools && createdb -O darkpools darkpools`, matching the default `DATABASE_URL`.

Useful scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Generate the Prisma client and build the production bundle |
| `npm start` | Serve the production build (Docker uses the standalone server instead) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Next.js type generation followed by `tsc --noEmit` |
| `npm test` | vitest unit tests |
| `npm run e2e` | Playwright smoke test against a running app |
| `npm run db:migrate` | `prisma migrate dev` (create and apply migrations) |
| `npm run db:deploy` | `prisma migrate deploy` (apply committed migrations) |
| `npm run db:studio` | Prisma Studio |
| `npm run seed` | Development seed data |

## Environment variables

All variables are documented in [`.env.example`](.env.example).

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string used by Prisma. In docker compose the app service always connects to the bundled `db` service, so this value only matters outside Docker. |
| `SESSION_SECRET` | yes | Secret that signs session cookies. At least 32 characters; `openssl rand -base64 48` makes a good one. |
| `UPLOAD_DIR` | no | Directory for trade screenshots. Defaults to `./uploads`; the Docker image uses `/app/uploads`. |
| `SETUP_TOKEN` | no | When set, the first-run page `/setup` (which creates the admin account) answers 403 unless the request carries `?token=<value>` (the value is compared in constant time and passed through the form). Once any account exists, `/setup` redirects to sign-in regardless. Unset keeps `/setup` open until the admin account is created. |
| `POSTGRES_PASSWORD` | compose | Password of the `darkpools` database role created by the `db` service and used to build the app's `DATABASE_URL`. |
| `APP_PORT` | compose | Host port (bound to 127.0.0.1) that docker compose publishes the app on. Defaults to 3300. |
| `SEED_USERNAME`, `SEED_EMAIL`, `SEED_PASSWORD` | seed only | Credentials of the demo admin created by `npm run seed` (the username defaults to the email's local part). |

### Accounts and sessions

Usernames are 3-32 characters (letters, digits, dot, underscore, hyphen), case-insensitive and
stored in lowercase; an email is optional and can be typed instead of the username at sign-in.
Roles are `ADMIN` and `USER`. Admin actions are checked on the server, an admin cannot deactivate,
demote or delete their own account, and the last active admin cannot be removed. Deleting an
account removes its trades, days, rules, tags, share links, import presets, attachments and the
screenshot files on disk.

Sessions are JWTs signed with `SESSION_SECRET`, stored in an HttpOnly, SameSite=Lax cookie
(Secure in production) that expires after 30 days. The token carries the account's session
version, so a password change or reset, a deactivation or a deletion rejects every existing
session at its next request; an account created or reset with a temporary password is sent to
`/change-password` before anything else. Sign-in is rate limited: five failed attempts within
fifteen minutes for a username (or email) or for a client address (taken from `X-Real-IP`, then
the first `X-Forwarded-For` entry, as set by the reverse proxy) block further attempts for the
rest of the window with the same generic message; a successful sign-in clears the counter.

## Tests

```bash
npm run lint
npm run typecheck
npm test                        # pure P&L, statistics, date, time-zone and CSV parsing modules
npx prisma validate
npm run build
```

The end-to-end smoke test drives the real application: first-run setup (or sign-in when the admin
exists), creating a trade, the trade list and detail pages, the dashboard and its charts, a CSV
import with a duplicate row, the Today check-in and budget bar, a rule-breaking trade with its
justification and ledger entry, the PWA assets and two-tap capture, the weekly review with a share
link, import presets and exports, the admin creating a user who signs in with the temporary
password, is made to replace it and then sees an empty journal and no admin pages, 390px-wide
layout checks on every page and the sign-out lock-out. Start the app against a database first, then:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e
```

`E2E_USERNAME` / `E2E_EMAIL` / `E2E_PASSWORD` set the admin credentials (defaults exist),
`E2E_SHOTS_DIR` changes where screenshots are written and `PW_CHROMIUM_PATH` points Playwright at
a preinstalled Chromium.
The CI workflow (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, `prisma validate`,
the production build and a Docker image build on every push and pull request.

## Docker

The multi-stage `Dockerfile` builds the standalone Next.js server, runs as a non-root user, applies
pending Prisma migrations on start-up and exposes a `HEALTHCHECK` against `/api/health`.
`docker-compose.yml` runs the app together with PostgreSQL 16 tuned for a small server.

```bash
cp .env.example .env            # set POSTGRES_PASSWORD, SESSION_SECRET and (optionally) APP_PORT
docker compose up -d --build    # app on 127.0.0.1:${APP_PORT:-3300}, database on an internal network
docker compose logs -f app      # migrations run before the server starts
```

Then open the app through the reverse proxy that already runs on the server (it forwards to the
published port; the compose file deliberately contains no proxy) and create the admin account at
`/setup`.

Production migrations do not use the Prisma CLI: the image and the host deployment run
`prisma/deploy-migrations.mjs`, a small script that applies `prisma/migrations/*/migration.sql`
in order and records them in `_prisma_migrations` in the same format as `prisma migrate deploy`,
each migration inside one transaction. New migrations are still generated locally with
`npx prisma migrate dev`; a migration that cannot run inside a transaction (such as
`CREATE INDEX CONCURRENTLY`) would need special handling.

- Uploads live in the `uploads` named volume, the database in the `pgdata` volume.
- `scripts/backup-db.sh` writes a timestamped `pg_dump` of the running database to `./backups`
  (`BACKUP_DIR` and `BACKUP_KEEP` override the location and retention). Restore with
  `gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -U darkpools -d darkpools`.
- `docker compose exec app node prisma-cli/node_modules/prisma/build/index.js migrate status`
  shows the migration state of the running container.

## How the numbers are computed

- Net P&L = (exit − entry) × quantity × multiplier × (+1 long / −1 short) − fees.
- R-multiple = net P&L ÷ (|entry − stop| × quantity × multiplier), only when a stop is recorded.
- Statistics only count closed trades; open trades are listed but never enter the P&L figures.
  Win rate uses all closed trades in its denominator, expectancy is net P&L per closed trade,
  profit factor is gross profit ÷ |gross loss|, and max drawdown is the largest peak-to-trough
  decline of cumulative P&L from a starting equity of zero.
- Daily P&L and the calendar bucket trades by exit time in the account's time zone (Settings).
  Trade times are entered and shown in that zone; CSV dates without an offset are read as UTC
  unless the import is told to use the account's zone.
- CSV imports are de-duplicated by a hash of symbol, side, quantity, entry price and entry time;
  a file that only carries a P&L column gets its exit price derived so the stored figures stay
  consistent with the formula above.
- Planned risk = |entry − stop| × quantity × multiplier is the size of 1R. The Edge Score, the
  leak finder, edge decay and the three-curve chart are documented in
  [`docs/product-spec.md`](docs/product-spec.md).

## Server setup

Run these on the server as the user that will own the deployment
(for example through EC2 Instance Connect in the AWS console).

1. Survey the server. Read-only and prints no secrets; paste the output back to Claude.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/dhulfiqar8409/Trading-journal-/claude/trading-journal-aws-pnsmv4/scripts/survey.sh | bash
   ```

2. Create the deploy key. It installs a dedicated public key on the server and prints the
   private key once. Store that private key as the GitHub Actions secret `SSH_PRIVATE_KEY`
   (repository Settings, then Secrets and variables, then Actions). Never paste it into the chat.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/dhulfiqar8409/Trading-journal-/claude/trading-journal-aws-pnsmv4/scripts/add-deploy-key.sh | bash
   ```

Deployments run from GitHub Actions over SSH using that key.
