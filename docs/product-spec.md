# Darkpools product spec

Darkpools is a personal, phone-first trading journal for a single owner. This document is the
shipped scope: phase 1 (the consensus core) and phase 2 (what makes it different), with notes on
how each part behaves in the product. Where the phase 2 brief and the implementation differ, the
implemented behaviour is described.

Guiding rules:

- Logging must be fast: two taps from the home screen to a prefilled trade form, defaults from the
  last trade, size presets and dictated notes.
- Process over outcome: the app rewards rule-following and complete reviews, never green streaks.
- R first: every result can be read in R-multiples with currency one tap away.
- No market-data feed: everything is computed from logged trades only.
- Single user, small server: everything is computed on demand, there are no background workers,
  no polling, and reads are server components.
- Nothing is gated, everything exports.

## Phase 1: the core

- **Trades**: stocks, options, futures, forex and crypto; long or short; quantity, entry and exit
  prices, multiplier, fees, stop and target, rating, markdown notes, a mistakes field, tags and
  screenshots. Net P&L, planned risk (the size of 1R) and the R-multiple are recomputed on every
  save. Screenshots live on disk under `UPLOAD_DIR` and are served only through an authenticated
  route.
- **Tags**: strategy, setup, mistake and custom kinds with colours.
- **Accounts**: several broker accounts with their own currency; one is the default.
- **CSV import**: header auto-detection, a column mapping step, a preview with per-row errors, and
  de-duplication by a hash of symbol, side, quantity, entry price and entry time.
- **Dashboard**: net result hero, KPI tiles, equity curve, daily bars, calendar heatmap, top
  symbols, results by tag and recent trades over a 7d / 30d / 90d / YTD / all / custom range.
- **Auth**: email and password, a signed session cookie, a first-run `/setup` page.

## Phase 2A: discipline and analytics

### Rules and adherence

- `Rule`: title, kind, numeric or time parameter, active flag. Kinds:
  `MAX_TRADES_PER_DAY`, `MAX_DAILY_LOSS_R`, `MAX_DAILY_LOSS_USD`, `NO_TRADES_BEFORE`,
  `NO_TRADES_AFTER`, `STOP_REQUIRED`, `MAX_RISK_PER_TRADE_R`, `MAX_POSITION_SIZE`, `CUSTOM`.
- Deterministic rules are evaluated when a trade is saved (against the other trades of the same
  calendar day in the owner's zone) and again on demand with "Re-check rules" on Today. Daily loss
  rules break when a trade is *opened* after the day's realised loss reached the limit; the trade
  that caused the loss is not blamed. `MAX_RISK_PER_TRADE_R` reads as "never lose more than N R on
  a trade": it breaks when a closed trade lost more than N times its planned risk (the stop was not
  honoured). `CUSTOM` rules are checkboxes on the trade form.
- `RuleEvent`: one per trade and rule with status `FOLLOWED`, `BROKEN` or `OVERRIDDEN` (a broken
  rule the owner marked as a deliberate exception) plus a justification. Saving a trade that
  breaks an active rule is refused until a one-line justification is given; the form keeps what
  was typed.
- Reports: adherence per ISO week, results split by "all rules followed" versus "at least one
  broken", the cost of each rule broken, and the Tilt Ledger listing every broken rule with the
  reason given at the time.

### Daily check-in (`Day`)

- One record per owner and calendar day: pre-market plan (max trades, max loss in R, allowed
  setups, focus note), state before the open (mood, sleep hours, focus, energy on 1-5 scales),
  end-of-day review (what went right, what went wrong, one change) and day tags.
- The plan powers the Plan-Lock budget bar on Today and on the trade form: trades used against the
  plan (falling back to a `MAX_TRADES_PER_DAY` rule) and loss used against the plan (falling back
  to the daily loss rules). Amber from 70%, red at 100%.
- Reports: expectancy and win rate bucketed by sleep, mood, focus and energy, and planned versus
  unplanned days.

### Mistake cost and the three-curve chart

- Cost per mistake tag: count, net and average result of the trades carrying it, ranked most
  costly first.
- Three equity curves on one phone-width chart: actual; mistakes removed (trades carrying any
  mistake tag dropped); stops honoured (every loss capped at the planned stop, i.e. -1R). The
  crosshair tooltip is the scrubber and lists the three values at a point in time; the curves are
  available in currency and in R and as a table.

### Edge Score

- A 0-100 composite over the last 50 closed trades (minimum 10): win rate, profit factor, payoff
  ratio (average win / average loss), drawdown control (max drawdown as a share of gross profit),
  recovery factor (net / max drawdown) and consistency (share of net from the best day). Anchors:
  win rate 20→70%, profit factor and payoff 0.5→3, drawdown 100%→0% of gross profit, recovery 0→5,
  best-day share 60%→10%. The score is the mean of the six factor scores.
- A radar of the six factors, a trend sparkline of the score after every fifth closed trade, and
  a table twin with the raw values and anchors.

### Edge decay per setup

- For every setup tag: rolling 20-trade expectancy in R with a 95% band (mean ± 1.96·sd/√n) as
  small multiples. A setup whose rolling expectancy crossed below zero is flagged with the
  suggestion to paper-trade it for the next 10 trades.

### Leak finder

- Deterministic checks over closed trades, each with a sample size, a money and R impact
  (the group's expectancy minus the rest's, times the group size) and a suggested rule that the
  "Add rule" button pre-fills: revenge trading (opened within 30 minutes of a loss closing),
  trading on after two consecutive losses, worst hour of day, worst day of week, oversized
  trades (top 20% by planned risk), overtrading days (above the plan, or the busiest fifth of
  days without one), holding losers longer than winners, best-setup neglect (traded in under 20%
  of trades; reported as an opportunity), the Friday effect and the last-hour effect. A finding
  needs at least five trades on each side; findings are ranked by impact.

### Breakdowns

- Result, expectancy, win rate and count by hour of day, day of week, hold duration, position size
  (tertiles by planned risk, or by notional value when stops are rare), instrument, side and
  account, plus a histogram of realised R-multiples. Every table switches units on tap.

### R-first mode

- Setting: show results in R or in currency (default R). Every result figure flips to the other
  unit on tap or click; trades without a stop show "no stop" and stay out of R statistics.
  Planned risk = |entry − stop| × quantity × multiplier is stored on the trade.

### Process streaks

- A session is a day with at least one trade. It counts when it was fully journaled (check-in,
  review, a tag on every trade) and rule-compliant, whatever the P&L. The streak is the run of
  such sessions ending with the latest one; the card explains what the latest session is missing.
  Badges are quiet counts at 5 / 10 / 25 / 50 / 100: red days fully reviewed, sessions on plan,
  sessions fully journaled. There is no green-day streak anywhere.

## Phase 2B: phone-first capture and sharing

### Installable app

- Web app manifest (name, dark theme colour, maskable icons, `start_url` on Today), a service
  worker that caches the shell and the last copy of visited pages, an `/offline` page and an
  offline banner while the device has no connection.
- Shortcuts: New trade, Check-in, Dashboard.
- Web Share Target: sharing a screenshot from the phone's share sheet posts it to `/share-target`,
  which stores it as a pending upload and opens `/trades/new` with the image attached as a draft;
  saving the trade turns the draft into an attachment. Drafts older than two days are removed.
- Notes, the focus note and the review questions offer dictation through the Web Speech API when
  the browser supports it; the button is absent otherwise.

### Two-tap capture

- `/trades/new` is prefilled from the last trade (symbol, account, asset class, size, multiplier),
  offers size presets (the most used sizes for that symbol plus half and double the last size),
  puts the planned stop next to the entry, and folds every other field behind "More details".
  Saving needs symbol, size, entry and time; the trade is open until an exit is added.

### Today

- Check-in, the plan budget bar, trades so far with their rule status, the day's rule events with
  justifications and a re-check button, the process streak and the end-of-day review, with
  navigation to previous days.

### Weekly review card

- `/reports/week/[isoWeek]`: net R, Edge Score as of the week's end, adherence, win rate, top
  setup, biggest leak, journaling counts, best and worst day and the latest "one change". A
  server-rendered share image (Next.js `ImageResponse`) can be downloaded, and a toggle hides
  dollar amounts.
- Share links: tokenised read-only pages for one trade or one week (`/share/[token]`), optionally
  hiding dollars, listed and revocable in Settings and on the source page. Screenshots of a shared
  trade are served only through the link's own route.

### Import presets and ownership

- Column mappings can be saved under a broker name and applied to the next file; header aliases
  cover common broker exports (contract / B/S / qty / price / timestamp and similar).
- Exports from Settings: everything as one JSON document (accounts, tags, rules, days, trades with
  tags, attachments and rule events), plus CSVs for trades, days, rules and tags.

## Quality bar

- Every calculation is a pure module under `src/lib` with vitest coverage, including edge cases
  (no stop, no plan, empty window, one trade).
- Every page works at 390px wide with no horizontal scroll; the Playwright smoke test checks the
  dashboard, trades, Today, Rules, Reports and the weekly review at that width.
- No feature needs an external API, a paid service, a background worker or polling.
