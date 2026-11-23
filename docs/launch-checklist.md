# Asterisk launch checklist — agent-first, Render candidate

Status: release tracking. Verified code and retrospective evidence are documented in README.md and data/FOOTBALL.md. Prospective paper observation and hosted staging are pending. The Asterisk repository owns **all executable code**, including the agent runtime. `craguilar/engineering-agent-kit` is a **specification/template source only**; it is not a runtime dependency.

## Architecture and ownership

- [x] Pin a commit/version of `engineering-agent-kit/skills/agent-runtime` as the implementation specification; record deviations in an ADR.
- [ ] Implement the provider-neutral model port, bounded loop, tool registry, guards, session store, approval gate, quotas, audit and eval harness **inside Asterisk**.
- [x] Define `asterisk-analyst` with versioned prompt, typed output, budget, read-only tools and principal scope.
- [x] Keep the deterministic prediction pipeline independent of the LLM/agent; the agent calls domain services rather than recalculating odds.
- [x] Provide an on-demand API or CLI for independent consultations, plus an optional scheduled daily pipeline.

## Prediction engine readiness

- [ ] Complete the OpenSpec `add-prediction-engine` tasks and offline tests.
- [ ] Choose and verify Kalshi market coverage and a football data provider for Liga MX.
- [ ] Ingest markets and matches with source timestamps, freshness thresholds, liquidity and missing-data states.
- [x] Implement Dixon-Coles, market prior, capped rules, fee-aware edge and risk sizing with deterministic tests.
- [ ] Build append-only prediction/decision/settlement ledger and Brier, log loss, calibration and CLV reporting.
- [ ] Run walk-forward backtests and a full matchday of paper trading; record evidence and no-bet cases.
- [x] Keep `trading.enabled=false`; exclude order-placement tools from the initial agent registry.

## Read-only agent contract

- [x] Implement `list_markets`, `get_pick_card`, `explain_prediction`, `get_performance`, `get_run_status` against Asterisk services.
- [x] Return provenance, model version, as-of time, and real/simulated indicator in tool responses.
- [x] Add fake-model and fixture-based evals for stale data, missing providers, unsafe requests, prompt injection, cross-user isolation and hallucinated probabilities.
- [x] Validate output against deterministic calculations; model cannot override risk caps or generate new probabilities.
- [x] Add authenticated session continuation and a user-accessible CLI or HTTP endpoint.

## Render deployment candidate (validate against current Render documentation before provisioning)

- [x] Decide service topology: Render web service for the API/agent; scheduled job or worker for daily ingestion/model runs.
- [x] Choose durable storage: Render-compatible managed Postgres for shared state/ledger, or explicitly assess SQLite persistent disk limitations and backup/recovery. Do not rely on ephemeral filesystem for the ledger.
- [ ] Create a reproducible build and start command, Python runtime pin, health endpoint and graceful shutdown.
- [ ] Configure environment-specific secrets (model API, Kalshi read-only access, football/news provider), never commit credentials.
- [ ] Define authentication, TLS, allowed origins, rate limits, outbound network restrictions, audit retention and secret rotation.
- [ ] Establish scheduled-job overlap protection, idempotency, migrations, backup and restore drills.
- [ ] Add observability: structured logs, traces, model cost/tokens, ingestion freshness, failures and alerting.
- [ ] Test restart, cold start, concurrency, deadlines and provider outages.
- [ ] Estimate monthly Render/database/model/provider costs and set spending alerts.

## Release gates

- [ ] CI passes unit, integration, schema, security and offline agent eval tests.
- [ ] Staging run produces an explainable card with data freshness and no-bet default.
- [ ] Manual end-to-end consultation works through deployed API/CLI with no write tools.
- [ ] Paper-trading evidence and documented risk review are complete before any consideration of real trades.
- [ ] Record deployment URL, rollback plan, operator runbook, and final explicit go-live approval.

## Open decisions

1. Render web service only vs web service plus scheduled job/worker.
2. Persistent storage and retention requirements.
3. Model provider and per-run budget.
4. Who may consult the agent and whether sessions are single-user or multi-user.
5. How often to ingest markets and refresh predictions.

This checklist complements, rather than replaces, `openspec/changes/add-prediction-engine/tasks.md`.
