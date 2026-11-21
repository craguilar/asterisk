# Design

## Context

The repository is empty. The only prior art is a hand-run process from the 2026 World Cup: read news, apply a rulebook, compare with the market, pick. Its lessons, captured in docs/rules-catalog.md, drive this design:

- The market beat rule-based overrides about half the time, so the market price must be the prior.
- Single-source injury reports were wrong more than once, so absences need two sources.
- Rules promoted to "law" from small samples broke (for example, "underdogs never win in 90"), so rule weights must be learned and capped.
- Knockout games decided in stoppage time count as 90 minutes, which mattered for most method-of-victory picks.

## Goals / Non-Goals

**Goals:**
- A daily CLI run that produces a pick card for Liga MX matches listed on Kalshi.
- Every probability traceable to market, model and named rule adjustments.
- A ledger that can answer "is there an edge?" with Brier, log loss and CLV.
- Pluggable leagues and data providers.

**Non-Goals:**
- Placing orders (a later change, gated by the ledger).
- Live/in-play modeling.
- A web dashboard.
- Using an LLM as a forecaster.

## Decisions

### D1. Language and tooling: Python 3.12 with uv and pytest
The modeling stack (numpy, scipy, pandas, scikit-learn, statsmodels) is far stronger in Python. Alternative considered: .NET to match the day-job stack. Rejected for the core because Dixon-Coles fitting and L1 logistic regression are one-liners in Python. A .NET client can consume the JSON card later.

### D2. Storage: SQLite for the ledger, DuckDB or Parquet for analytics
SQLite gives a single-file, append-only ledger. DuckDB reads it for reports. Alternative: Postgres. Rejected until there is more than one user or process.

### D3. Pipeline stages
```
ingest-markets → ingest-matches → extract-flags → fit-model
→ evaluate-rules → combine → decide → write-ledger → render-card
```
Each stage reads and writes the database, so any stage can be re-run alone. A `daily` command runs them in order.

### D4. Combining evidence in log-odds
`logit(p) = w·logit(p_market) + (1−w)·logit(p_model) + Σ βᵢ·xᵢ`, with w default 0.7. Log-odds keeps adjustments symmetric and bounded; averaging probabilities would understate strong evidence near 0 or 1. For three-way markets, apply per outcome then renormalize.

### D5. Rules as code with a manifest
Each rule is a pure function `evaluate(context) -> RuleResult(fired, x, explanation, inputs)` registered with id, tier, cap and target. The learned βᵢ lives in a versioned weights table, not in code. Default β before learning equals the tier default (Tier 1: 1.0, Tier 2: 0.5, Tier 3: 0.0 with logging only).

### D6. LLM usage: two narrow jobs
- Extraction: a fast model (Haiku class), temperature 0, JSON-schema output, Spanish and English input. Cost bounded by article count per match (config, default 8).
- Adversarial review: a stronger model (Sonnet/Opus class), only for recommended bets.
Neither job may emit probabilities; the schema has no field for them.

### D7. Data providers behind interfaces
`MarketProvider` (Kalshi), `MatchProvider` (API-Football or football-data.org), `NewsProvider` (search API or RSS). Each has a recorded-fixture implementation for tests so the suite runs offline.

### D8. Fees as config
Kalshi's fee formula can change, so it is a configured function of price and contract count with a default matching the schedule at build time. Verify it against Kalshi's current docs before first use.

### D9. Validation before use
Before recommending real bets, run a walk-forward backtest on past seasons with historical closing prices where available. If historical Kalshi prices are missing, use bookmaker closing odds as the market prior for backtesting only.

## Risks / Trade-offs

- **Small samples**: proving a 3-point edge by win rate needs about 1,000 bets. Mitigation: track CLV and log loss, which converge faster.
- **Kalshi coverage**: Liga MX markets may be thin or missing on some matchdays. Mitigation: volume check in decision-sizing; the league is pluggable.
- **Data provider gaps**: free tiers may lack lineups or goal minutes. Mitigation: provider interface; mark missing inputs so dependent rules do not fire.
- **LLM errors**: hallucinated injuries. Mitigation: quote-plus-URL requirement, two-source rule, lineup supersedes flags.
- **Overfitting rule weights**: Mitigation: L1 regularization, minimum 50 samples, walk-forward evaluation only.
- **Behavioral risk**: a tool can make betting feel more certain than it is. Mitigation: hard caps in config, no-bet as default, disclaimer and exposure on every card.

## Open Questions

1. Which football data provider and plan (cost vs. lineup and goal-minute coverage)?
2. Where the daily run lives: local cron, a cloud scheduler, or a Claude scheduled task that reads the JSON card.
3. Bankroll and caps to set in config.
4. Whether to add a second league (MLS or Premier League) once the Liga MX pipeline is stable.
