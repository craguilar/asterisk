# Proposal

## Why

During the 2026 World Cup we predicted knockout matches by hand with a growing rulebook (29 rules). It worked in places and failed in others, but the lessons lived only in a chat log, adjustments were made by feel, and nobody measured which rules actually added value. Asterisk turns that process into a repeatable pipeline for Kalshi sports contracts: market price as the prior, math for the baseline, rules as weighted and audited adjustments, and a ledger that proves or disproves the edge.

## What Changes

- Ingest Kalshi sports markets and prices (read-only).
- Ingest fixtures, results, lineups and injuries for Liga MX.
- Use an LLM to turn news into structured, source-cited flags (rotation, absences, motivation, fitness).
- Fit a Dixon-Coles goal model that yields win/draw/loss, both-teams-to-score, totals, exact score and level-at-90 probabilities.
- Encode the World Cup rulebook as a registry of bounded adjustments combined in log-odds space with the market and the model.
- Compute edge after fees, size with fractional Kelly under hard caps, and output "no bet" when the edge is too small.
- Record every prediction in a ledger and score it (Brier, log loss, calibration, closing-line value, per-rule attribution).
- Produce a daily pick card with an adversarial "argue against this bet" review.

Out of scope for this change:
- Placing orders on Kalshi (advice only).
- Leagues other than Liga MX (the design keeps the league pluggable).
- In-play / live betting.
- A web UI (the pick card is Markdown/JSON).

## Capabilities

### New Capabilities
- `market-ingestion`: Read Kalshi sports markets and prices, normalize them into implied probabilities, and snapshot them over time.
- `match-data`: Fixtures, results, lineups, injuries and suspensions for supported leagues, linked to Kalshi markets.
- `news-extraction`: LLM extraction of structured, source-cited match flags from news and previews.
- `probability-model`: Dixon-Coles goal model and the log-odds combiner that blends market, model and rule adjustments.
- `rule-engine`: Registry of the World Cup rules as bounded, weighted, explainable adjustments.
- `decision-sizing`: Edge after fees, fractional Kelly sizing, hard caps and the no-bet decision.
- `ledger-evaluation`: Prediction ledger, settlement, scoring and per-rule weight learning.
- `pick-card`: Daily human-readable output with reasoning and adversarial review.

### Modified Capabilities
<!-- None: first change in this repository. -->

## Impact

- New Python package and CLI (`asterisk`).
- External dependencies: Kalshi public market-data API, a football data API (API-Football or football-data.org), Anthropic API, a news source (search API or RSS).
- Secrets: Kalshi API key (read scope), football data key, Anthropic key, all via environment variables.
- Local storage: SQLite/DuckDB file for markets, matches, flags, predictions and ledger.
