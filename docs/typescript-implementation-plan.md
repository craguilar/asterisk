# Asterisk — TypeScript implementation plan

Status: proposed implementation; no runtime or deployment is claimed complete.

## Ownership
- **engineering-agent-kit**: language-neutral reusable agent specifications, contracts, evaluation guidance and templates only. It is not an executable runtime dependency.
- **asterisk**: owns all executable code, agent loop, tool registry, provider adapters, persistence, domain prediction engine, Kalshi clients, deployment and tests.
- Asterisk is the first reference implementation. Feed generic lessons back to the kit as documentation, without moving executable runtime there.

## Technology decision
- TypeScript strict mode on Node.js 22+, Fastify for HTTP, Zod for contracts, Vitest for tests.
- PostgreSQL with migrations for sessions, audit, ledger and predictions; Render-managed database is the proposed production persistence.
- A Render web service serves authenticated on-demand agent consultations. A separate scheduled job runs daily ingestion/analysis with overlap protection.
- Model provider behind an adapter interface; do not couple the agent loop to a particular model SDK.
- Keep all prediction and risk arithmetic deterministic. Port the existing Python-oriented OpenSpec numerical design to TypeScript using tested numerical routines; validate Dixon–Coles optimization and backtest parity before relying on results. Do not silently drop model requirements.

## Delivery phases
1. **Architecture and contracts:** reconcile existing OpenSpec Python decisions with TypeScript; define module boundaries, typed market data, agent response schemas, storage, identity and error contracts. Preserve the mathematical behavior.
2. **Foundations:** project scaffold, lint/typecheck/test/build, configuration, secret handling, database migrations, health endpoint and Dockerfile.
3. **Read-only Kalshi integration:** typed public market endpoints; optional authenticated private account reads for orders, fills and positions with minimal scopes; pagination, retries, rate limits, timestamps and fixtures. Do not enable order placement.
4. **Prediction pipeline:** match/news providers, market snapshots, Dixon–Coles, capped rules, fee-aware edge, no-bet decisions, ledger and calibration/CLV evaluation.
5. **Local agent runtime:** bounded tool-calling loop, typed tool registry, input/output guards, authenticated principal, sessions, memory, audit, quotas and fake-provider tests. Follow the versioned agent-runtime skill spec without importing a runtime from the kit.
6. **Asterisk analyst:** read-only tools for market listings, current pick cards, explanations, run freshness, performance and—when authenticated—personal positions/fills. Responses include sources, freshness, uncertainty and a clear distinction between simulated and actual data.
7. **Consultation and daily report:** authenticated POST agent endpoint plus CLI; scheduled daily opportunity summary, position review and no-bet outcomes. Delivery method for daily reports is a separate decision.
8. **Render readiness:** managed Postgres, migrations, deployment config, secrets, scheduled job, health checks, observability, cost limits, backups, rollback and staging smoke tests.
9. **Release gates:** walk-forward backtest, paper-trade matchday, deterministic/agent evals, account-isolation tests and explicit manual go-live approval. Trading remains disabled.

## First implementation milestone
A TypeScript Fastify service with /health, a typed read-only Kalshi market client, recorded fixtures, and a read-only analyst agent endpoint using a locally implemented bounded loop and fake model tests. The endpoint must not invent opportunities when live data is missing.

## Non-goals for v1
- Automatic order placement or changes to existing bets.
- Promises of profitability or unsupported confidence estimates.
- Moving agent runtime code into engineering-agent-kit.
- Requiring a Python microservice unless benchmarked numerical parity makes it necessary.

## Open decisions
- Which authenticated Kalshi account read endpoints and scopes are actually available and suitable.
- Daily schedule, report delivery channel and preferred time zone.
- Model provider and cost ceilings.
- Exact Render service topology and retention period.

See [launch checklist](launch-checklist.md) and [prediction engine tasks](../openspec/changes/add-prediction-engine/tasks.md). The earlier Python 3.12 choice in the prediction-engine design is superseded by this TypeScript decision for implementation; the model requirements remain binding until explicitly revised.
