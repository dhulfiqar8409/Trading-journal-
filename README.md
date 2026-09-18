# Darkpools

A personal trading journal, deployed to https://darkpools.deeapps.net on an existing AWS server
that already hosts two other applications.

## Overview

Darkpools is a single-owner journal for logging trades, reviewing execution and seeing whether
the numbers add up. It is built for a phone first and a desktop second: a dark, restrained
interface with green and red reserved for the sign of P&L.

### Features

- **Trades**: stocks, options, futures, forex and crypto; long or short; quantity, entry and exit,
  multiplier (point value or contract size), fees, stop and target, rating, markdown notes and a
  mistakes log. Net P&L and the R-multiple are recomputed on every save.
- **Dashboard**: net P&L, win rate, profit factor, expectancy, average win and loss, max drawdown,
  trade count and streak, with a 7d / 30d / 90d / YTD / all-time / custom range selector; an
  equity curve, daily P&L bars, a monthly calendar heatmap, top symbols, P&L by tag and recent
  trades. Every chart has a table view.
- **Trade list**: filter by date range, symbol, side, status, tag and account; sort by any column;
  paginated.
- **Tags**: strategy, setup, mistake and custom tags with colours, attached to any trade.
- **Screenshots**: image attachments per trade, stored on disk outside the web root and served
  only to the signed-in owner.
- **CSV import**: upload a broker export, map columns (auto-detected from common headers), preview
  the parsed rows and import with a report of inserted rows, duplicates skipped and row errors.
- **Accounts**: several broker accounts with their own currency; one is the default.
- **Settings**: name, time zone, password change and a CSV export of every trade.
- **Single owner**: the first visit to `/setup` creates the only account; afterwards the page
  redirects to sign-in. Every record is still scoped by user id.

### Stack

Next.js (App Router, TypeScript), Tailwind CSS, Prisma with PostgreSQL, Zod, Recharts,
papaparse, bcryptjs + jose for sessions, vitest for unit tests and Playwright for the
end-to-end smoke test. The Docker image runs the standalone Next.js server.

## Local development

Requirements: Node.js 22, npm 10 and a PostgreSQL 16 server.

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
| `POSTGRES_PASSWORD` | compose | Password of the `darkpools` database role created by the `db` service and used to build the app's `DATABASE_URL`. |
| `APP_PORT` | compose | Host port (bound to 127.0.0.1) that docker compose publishes the app on. Defaults to 3300. |
| `SEED_EMAIL`, `SEED_PASSWORD` | seed only | Credentials of the demo owner created by `npm run seed`. |

Sessions are JWTs signed with `SESSION_SECRET`, stored in an HttpOnly, SameSite=Lax cookie
(Secure in production) that expires after 30 days.

## Tests

```bash
npm run lint
npm run typecheck
npm test                        # pure P&L, statistics, date, time-zone and CSV parsing modules
npx prisma validate
npm run build
```

The end-to-end smoke test drives the real application: first-run setup (or sign-in when the owner
exists), creating a trade, the trade list and detail pages, the dashboard and its charts, a CSV
import with a duplicate row, a 390px-wide layout check and the sign-out lock-out. Start the app
against a database first, then:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e
```

`E2E_EMAIL` / `E2E_PASSWORD` set the credentials (defaults exist), `E2E_SHOTS_DIR` changes where
screenshots are written and `PW_CHROMIUM_PATH` points Playwright at a preinstalled Chromium.
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
published port; the compose file deliberately contains no proxy) and create the owner account at
`/setup`.

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
- Daily P&L and the calendar bucket trades by exit time in the owner's time zone (Settings).
  Trade times are entered and shown in that zone; CSV dates without an offset are read as UTC
  unless the import is told to use the owner's zone.
- CSV imports are de-duplicated by a hash of symbol, side, quantity, entry price and entry time;
  a file that only carries a P&L column gets its exit price derived so the stored figures stay
  consistent with the formula above.

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
