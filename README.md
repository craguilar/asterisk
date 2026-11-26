# Asterisk

A read-only Liga MX analyst for Kalshi. Asterisk discovers public contracts, matches them to fixtures, fits time-decayed Dixon–Coles team ratings, compares probabilities with the exchange price, and records a decision for each contract. Its Fastify web service, CLI, calculation engine, model adapters and analyst runtime are implemented here in TypeScript.

## Open the demo

Use Node 24. From a source checkout run:

```sh
npm ci
npm run build
npm run demo
```

Open **http://127.0.0.1:4317**. A distributed runnable ZIP already contains the compiled service and production dependencies. Extract it and run `node dist/main.js demo`, or double-click `Start Asterisk.cmd` on Windows. The default demo replays actual Toluca–Monterrey market observations from **November 7, 2026 at 16:00 UTC**, nine hours before kickoff. Official outcomes are stored separately. The card explains the price, model probability, blend and no-bet reason. Open the settlement panel, ask the analyst about Toluca, or download the Markdown card. The local router needs no internet or API key. The demo keeps its embedded PostgreSQL database under `.asterisk/pg`. One process owns that directory. Set `PORT` or `ASTERISK_DEMO_DIR` to run another instance.

For current public markets, open `Start Live Asterisk.cmd` on Windows. The live launcher uses port 4318 and a separate local ledger. Keep it open to refresh prices and poll for official results every 15 minutes.

## Data modes

| ASTERISK_MODE | Market observations | Use |
| --- | --- | --- |
| replay | Archived public Kalshi candles, factual match time and historical fitted ratings | Repeatable offline demo |
| live | Kalshi open Liga MX markets and ESPN fixtures, fetched at runtime | Scheduled analysis and authenticated consultations |
| demo | Explicit synthetic prices, availability and venue inputs | Exercise paper allocation and limits |

The demo command defaults to replay. Other commands default to live. A live provider error or an empty market day is recorded explicitly. Read-only discovery and private account access use fixed GET routes. There are no exchange order functions. Sources, as-of times, provider availability and simulation status travel with the card. Risk parameters live in `config/paper.json`; fee assumptions are configurable and should be checked for the series before interpreting paper sizing. Replay quotes omit depth, so the historical card allocates zero contracts.

## Run with PostgreSQL

Supply `DATABASE_URL` for a dedicated database. The web service, migration command and daily job apply the same versioned migration under a database lock. Tables preserve the observation, constituent probabilities, model version and decision. Outcomes are written separately, with a normalized pre-kick closing price when available. Concurrent daily runs for the same day and mode share a transaction lock. Recent completed cards are reused. In live mode, run npm run daily -- --refresh to record a new observation immediately. The daily and match limits include previously allocated paper exposure. Each independent snapshot stays in the ledger. Empty or incomplete responses can be checked again after one minute.

Set `ASTERISK_USERS` to a JSON object mapping each analyst ID to a unique, randomly generated bearer token of at least 32 characters. Set secrets in the environment manager. Run:

```sh
npm run migrate
npm run daily
npm start
```

Open the service and enter the token in the login form. For a shell consultation, set `ASTERISK_URL` and `ASTERISK_TOKEN` and run `npm run consult -- "Explain the Toluca prediction"`. The daily job writes human-readable Markdown and machine-readable JSON under `reports/` or `ASTERISK_REPORT_DIR`. PostgreSQL holds the durable source. On Render, files created by cron runs are ephemeral.

Public `GET /health` checks the database. The authenticated routes are `GET /api/card`, `GET /api/card.md`, `GET /api/performance?from=YYYY-MM-DD&to=YYYY-MM-DD`, `POST /api/consult`, and `GET /api/sessions/:id`. A consultation accepts `{"question":"Show run status"}`. Continue by including the returned `sessionId` and `revision`. An obsolete revision returns HTTP 409. Session ownership is checked using the authenticated principal. Sessions expire after 30 days. The local demo issues a loopback-only same-site session cookie. Hosted mode requires explicit tokens.

## Optional integrations

- The built-in router selects from six read-only analyst tools. Set `ANALYST_PROVIDER=anthropic`, `ANTHROPIC_MODEL` and `ANTHROPIC_API_KEY` for hosted model selection. The model cannot assign probabilities or stakes. See [analyst runtime](docs/analyst-runtime.md).
- Supply articles and confirmed lineups through the [match-news input format](docs/match-news.md). A missing source stays visible. News processing verifies source text, publication times and independent domains.
- Private holdings and recent fills require a separately issued read-only Kalshi key for each configured analyst. In the hosted live service, set `KALSHI_READ_ACCOUNTS` to a secret JSON object mapping the same analyst ID to an object with `id` (exchange key ID) and `pem` (private PEM). Startup and each private consultation verify that the exchange reports **exactly** the read scope. A mismatched or unverifiable key prevents access. The account tool returns up to 100 positions and 100 recent fills and flags a truncated result. Demo and replay modes have no account access.

## Evaluation

```sh
npm run build
npm test
npm run eval
npm run backtest
npm run backtest -- --exchange
```

The offline suite covers the numerical examples, quote validation, settlement, news, the analyst, persistent embedded PostgreSQL, and the HTTP session workflow. Set `TEST_DATABASE_URL` to a **dedicated disposable PostgreSQL database** to run the same persistence, isolation, concurrent-write and restart checks against a server. The CI workflow supplies PostgreSQL 18. The ordinary suite makes no external requests. The final command explicitly accesses public historical feeds.

The [captured exchange comparison](data/backtest-exchange.json) covers 21 matched games from Apertura 2025 and 167 from Clausura 2026. Lower multiclass log loss is better.

| Tournament | Market | Dixon–Coles | Combined |
| --- | ---: | ---: | ---: |
| Apertura 2025 | 1.0045 | 1.0487 | 1.0156 |
| Clausura 2026 | 1.0194 | 1.0358 | 1.0212 |

The market leads both samples. This comparison uses pre-kickoff prices, excludes unmatched events, and estimates no returns. The offline 2024–25 archive comparison uses a league-frequency baseline because the CC0 results file has no market quotes. The production ledger records prospectively observed paper decisions. Replays and retrospective evaluations never qualify a live trading gate.

## Prospective paper matchday

The November 26 [pregame capture](data/paper/2026-11-26-pregame.json) contains the six first forecasts recorded for Pachuca–Guadalajara and León–Cruz Azul. The capture preserves its original timestamps and decisions. Consult the live ledger for subsequent official outcomes using `node dist/main.js paper-day 2026-11-26` or the dashboard’s settlement panel.

## Render

The [Blueprint](render.yaml) defines a Node web service, a scheduled refresh every 15 minutes, and shared managed PostgreSQL. Import it from the implementation branch or merged default branch. Provide `ASTERISK_USERS` for the web service and select database and service plans in the Render preview. The Oregon staging estimate is about $14/month before taxes and overages. Review the [cost breakdown and deployment steps](docs/render-staging.md) before provisioning. The API and cron use internal database credentials, and inbound public database connections are disabled. Expose the web service over HTTPS. After provisioning, check `/health`, run the cron once, authenticate, and inspect the run status and the card. Restore a database backup into a separate service for a recovery drill. Roll back application code to a tested build with a compatible schema. This repository includes deployment configuration; it does not contain credentials or a hosted deployment.

The [implementation plan](docs/typescript-implementation-plan.md), [release checklist](docs/launch-checklist.md) and [task ledger](openspec/changes/add-prediction-engine/tasks.md) distinguish shipped behavior from outstanding research and operational gates. All runtime code belongs to Asterisk.
