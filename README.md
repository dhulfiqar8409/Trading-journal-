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
- **Closing trades**: every open trade offers "Close" (list rows and cards, the detail page, Today's
  open positions; the dashboard's open-positions tile leads to the open filter). The sheet takes
  the exit price and time, extra fees, an exit note and the quantity to close; closing less than
  the position splits it into a closed trade and an open remainder, and rules are checked as on a
  save. Options add "Expired worthless".
- **Options**: calls and puts with strike and expiration on the underlying's symbol, shown as
  "SPY 450C Sep 20" everywhere, 100-share contracts by default, CSV import that reads OCC and
  broker-style contract symbols, and reports by call/put, options vs shares and days to expiration.
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
- **Imports that match the broker**: a CSV can hold one row per trade or one row per execution;
  fills are matched into round trips per contract, a thinkorswim Account Statement is recognised
  and only its Account Trade History is read, and importing the same file twice adds nothing.
- **Cleaning up**: every import is a batch that can be undone from the Import page, the trades
  list has checkboxes with "Delete selected" (a page or the whole filter), and an admin can wipe
  one account's trades after typing the username.
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
| `SETUP_TOKEN` | production | The first-run page `/setup` (which creates the admin account) answers 403 unless the request carries `?token=<value>` (the value is compared in constant time and passed through the form). In production the token is required and must be at least 16 characters: without one `/setup` answers 503 with a message naming the missing token, the setup action refuses, and the server logs one line at start-up. In development an unset token keeps `/setup` open. Once any account exists, `/setup` redirects to sign-in regardless. |
| `APP_ORIGIN` | production | The origin (scheme and host) browsers must present on state-changing requests to the API routes and the share target; `https://darkpools.deeapps.net` in production. Unset, the app derives it from the request's `Host` and `X-Forwarded-Proto` headers. |
| `ATTACHMENT_QUOTA_MB` | no | Screenshot storage allowed per account in megabytes, attached and pending shares together. Defaults to 200; an upload or share beyond it is refused with a message. |
| `POSTGRES_PASSWORD` | compose | Password of the `darkpools` database role created by the `db` service and used to build the app's `DATABASE_URL`. |
| `APP_PORT` | compose | Host port (bound to 127.0.0.1) that docker compose publishes the app on. Defaults to 3300. |
| `SEED_USERNAME`, `SEED_EMAIL`, `SEED_PASSWORD` | seed only | Credentials of the demo admin created by `npm run seed` (the username defaults to the email's local part). |

### Importing executions

Broker statements often list fills rather than trades. The Import page has two modes. "A trade"
expects entry and exit on one row, as before. "An execution" expects one row per fill with side
(BUY/SELL, or a signed quantity), quantity, an optional position effect (TO OPEN / TO CLOSE),
price, time, symbol, and for options expiration, strike and type, plus optional fees and spread
columns; the mapping UI auto-detects them. Fills are matched per contract (symbol, expiration,
strike, type) in time order: opens build a position with a quantity-weighted average entry (a
BUY opens long, a SELL opens short), closes take from it and become a closed trade with the
weighted average exit of that burst of fills, the entry time of the first open and the exit time
of the last close, fees summed from the fees column and the entry fees split like a partial
close. A close beyond the open quantity, or one with no open in the file, is an *unmatched
close*: the preview explains that the position was opened before the statement window and
suggests exporting a wider range; such closes are skipped unless ticked, in which case they
become closed trades whose entry is copied from the exit and marked unknown in the notes. Legs
of a multi-leg spread are separate trades with the spread kind in the notes. Without a position
effect column the effect is inferred from the running position (a sell while long closes, a sell
while flat opens short). Close fills of one exit more than two minutes apart count as separate
partial closes. The matched trades use the same de-duplication key as a trade import, so
re-importing a statement adds nothing.

A thinkorswim (Schwab) Account Statement is recognised by its "Account Trade History" section:
only that section is parsed (leading empty column, `9/17/26 09:31:05` times read in your zone,
`20 SEP 26` expirations, legs of a spread taking the first leg's time), everything else in the
file is ignored, and the executions mode is selected automatically.

### Cleaning up

Every import creates a batch (file name, mode, inserted, skipped and error counts). The Import
page lists the last 25 under "Import history" with "Undo import", which deletes the trades that
batch created together with their screenshots and rule events, after a confirmation that states
the count. The trades list has a checkbox on every row and card, "Select all on this page", and
when the filter spans more pages "Select all N matching this filter"; "Delete selected" confirms
with the number of trades. On `/admin/users` an admin can delete all trades of one account
(checked server-side for the admin role): the username has to be typed to confirm, and the
account's screenshots, files and import history go with the trades while its days, rules and
tags stay.

### Closing trades and options

Closing an open trade (from the trades list, the detail page or Today) asks for the exit price,
the exit time (now by default, never before the entry), any extra fees, an optional exit note
appended to the notes, and the quantity to close, which defaults to the whole position. A full
close sets the exit, recomputes P&L, planned risk and the R-multiple and evaluates the active
rules the way a save does; a broken rule needs the same one-line justification. Closing less than
the open quantity splits the trade inside one transaction: a new closed trade carries the closed
quantity with the same entry, tags, account, stop and target, a proportional share of the entry
fees plus the closing fees, and a note "Partial close of <trade>: closed N of M"; the original
keeps the remainder open, its screenshots and a note "Closed N of M". Option trades also offer
"Expired worthless": exit price 0 at 16:00 on the expiration day in the account's time zone.

Option trades keep the underlying as the symbol and add call/put, strike and expiration; the form
switches the multiplier to 100 and labels the quantity "contracts", and a trade of any other
asset class cannot carry those fields. Expirations are calendar days (stored at 12:00 UTC).
Everywhere a symbol appears an option shows as "SPY 450C Sep 20" (with the year when it differs
from the current one). P&L, planned risk and R use contracts x multiplier; a short is sell to open.
CSV imports read contract symbols such as `SPY240920C00450000`, `SPY 09/20/2024 450 C` or
`SPY 20SEP24 450 P` (asset class OPTION and multiplier 100 unless the row has its own) and
auto-detect call/put, strike and expiration columns. Reports add calls vs puts, options vs shares
and days to expiration at entry (0, 1 to 7, 8 to 30, 31 or more); the dashboard's top symbols group
options by underlying; exports carry the new fields.

### Accounts and sessions

Usernames are 3-32 characters (letters, digits, dot, underscore, hyphen), case-insensitive and
stored in lowercase; an email is optional and can be typed instead of the username at sign-in.
Roles are `ADMIN` and `USER`. Admin actions are checked on the server, an admin cannot deactivate,
demote or delete their own account, and the last active admin cannot be removed. Deleting an
account removes its trades, days, rules, tags, share links, import presets, attachments and the
screenshot files on disk.

Sessions are JWTs signed with `SESSION_SECRET`, stored in an HttpOnly, SameSite=Lax cookie that
expires after 30 days; in production the cookie is Secure and named with the `__Host-` prefix, so
it is only ever sent over HTTPS to this host and cannot be planted by a sibling subdomain. The
token carries the account's session version, so a password change or reset, a deactivation, a
deletion or logging out rejects every existing session at its next request (logging out signs the
account out on every device, and a copied cookie dies with it); an account created or reset with
a temporary password is sent to `/change-password` before anything else. Passwords are 10
characters to 72 bytes (the hash reads no further). Sign-in is rate limited per client address
(taken from `X-Real-IP`, then the first `X-Forwarded-For` entry, as set by the reverse proxy):
five failed attempts within fifteen minutes for a username (or email) from that address, or five
from the address for any name, block further attempts from it for the rest of the window with the
same generic message; failures from other addresses never lock the account's owner out, and a
successful sign-in clears that name's failures from that address.

State-changing API routes (CSV import, screenshot uploads, import presets) and the share target
refuse requests whose `Origin` header (or, failing that, the `Referer`) is not the app's own
origin, because the other applications on sibling subdomains are same-site for cookie purposes.
Server actions get the same check from the framework. Screenshots are served with
`Cache-Control: private, no-store`, CSV exports escape formula-like cells, and each account may
store `ATTACHMENT_QUOTA_MB` of screenshots; shared screenshots that were never attached are
removed after a day.

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
link, import presets and exports, foreign-origin requests to the API routes and the share target
being refused, the admin creating a user who signs in with the temporary password, is made to
replace it and then sees an empty journal and no admin pages, 390px-wide layout checks on every
page and the sign-out lock-out (a copy of the cookie taken before logging out is dead too). Start
the app against a database first, then:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e
```

`E2E_USERNAME` / `E2E_EMAIL` / `E2E_PASSWORD` set the admin credentials (defaults exist),
`E2E_SETUP_TOKEN` passes the server's `SETUP_TOKEN` to the first-run step (a production build
needs one), `E2E_SHOTS_DIR` changes where screenshots are written and `PW_CHROMIUM_PATH` points
Playwright at a preinstalled Chromium. To run it against a production build:

```bash
npm run build
SETUP_TOKEN=local-setup-token-0123456789 npm start          # plus DATABASE_URL and SESSION_SECRET from .env
E2E_SETUP_TOKEN=local-setup-token-0123456789 npm run e2e
```

The production setup guard has a spec of its own, skipped unless asked for: start a production
build without `SETUP_TOKEN` against an empty database and run
`E2E_SETUP_GUARD=1 npx playwright test e2e/setup-guard.spec.ts`, which checks that `/setup`
answers 503 and names the missing token.
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
