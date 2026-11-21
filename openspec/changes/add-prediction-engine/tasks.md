# Tasks

## 1. Project skeleton

- [ ] 1.1 Create Python 3.12 package `asterisk` with uv, pytest, ruff and a `asterisk` CLI entry point
- [ ] 1.2 Add `config.example.toml` (league, weights w, Kelly multiplier, per-bet cap, daily cap, edge threshold, fee schedule, trading.enabled=false) and load secrets from environment variables
- [ ] 1.3 Create SQLite schema and migrations: markets, price_snapshots, matches, goals, lineups, availability, flags, ratings, rule_weights, predictions, decisions, settlements
- [ ] 1.4 Add a guard that blocks any Kalshi order endpoint; test that it raises before a network call

## 2. Market ingestion

- [ ] 2.1 Implement `MarketProvider` for Kalshi read endpoints with a recorded-fixture test double
- [ ] 2.2 Implement normalization with overround; test the 52/27/26 example (0.4952, 0.2571, 0.2476)
- [ ] 2.3 Implement snapshots at prediction time and at close
- [ ] 2.4 Implement market-to-match linking with an `unlinked` state and a team-name alias table

## 3. Match data

- [ ] 3.1 Implement `MatchProvider` for the chosen football API, with fixtures for tests
- [ ] 3.2 Backfill four seasons of Liga MX results with 90-minute, extra-time and penalty scores
- [ ] 3.3 Store goal minutes with stoppage time; test that 90+4 counts toward the 90-minute result
- [ ] 3.4 Compute schedule congestion and table context per match

## 4. News extraction

- [ ] 4.1 Define the flag JSON schema (no probability fields) and validator
- [ ] 4.2 Implement `NewsProvider` (search API or RSS) with per-match article limit
- [ ] 4.3 Write the extraction prompt (Spanish and English) and call a fast model at temperature 0 with schema-constrained output
- [ ] 4.4 Enforce quote-plus-URL, the two-source rule for `player_out`, and lineup supersession; test each with fixtures

## 5. Probability model

- [ ] 5.1 Implement Dixon-Coles fit with time decay and low-score correction; store versioned ratings
- [ ] 5.2 Build the scoreline grid and derived markets; test the 1.6/1.0 example (0.5134 / 0.2500 / 0.2366, BTTS 0.5045, over 2.5 0.4816)
- [ ] 5.3 Implement the late-window goal-intensity estimate and level-at-90 probability
- [ ] 5.4 Implement the log-odds combiner with renormalization; test the 0.50/0.55/−0.15 example (0.4776)
- [ ] 5.5 Implement the market-only fallback with `model_missing`

## 6. Rule engine

- [ ] 6.1 Implement the rule registry, manifest and per-rule and total caps; test clipping (3 × 0.35 → 0.8)
- [ ] 6.2 Port Tier 1 rules from docs/rules-catalog.md with one test each
- [ ] 6.3 Port Tier 2 rules with tests
- [ ] 6.4 Register Tier 3 rules at weight 0 (log-only)
- [ ] 6.5 Implement the method-of-victory estimate for knockout markets

## 7. Decision and sizing

- [ ] 7.1 Implement edge after fees; test the 0.53 / 52¢ / 2¢ no-bet example
- [ ] 7.2 Implement fractional Kelly; test p 0.58, c 0.52, ×0.25, bankroll 1000 → 31.25
- [ ] 7.3 Implement per-bet, per-day and per-match exposure caps
- [ ] 7.4 Emit a decision with a reason code for every market

## 8. Ledger and evaluation

- [ ] 8.1 Implement append-only writes with correction records
- [ ] 8.2 Implement settlement using each market's settlement rules
- [ ] 8.3 Implement Brier, log loss, calibration buckets and CLV; test the CLV +0.05 example
- [ ] 8.4 Implement per-rule attribution and the `harmful` marker
- [ ] 8.5 Implement L1 logistic weight learning with the 50-sample minimum and weight versions
- [ ] 8.6 Implement the trading-gate report

## 9. Pick card

- [ ] 9.1 Render Markdown and JSON cards from the same data
- [ ] 9.2 Implement the adversarial review prompt (stronger model, recommended bets only) and "Unmodeled risks" section
- [ ] 9.3 Generate kill-switch conditions from star-player and lineup-dependent rules
- [ ] 9.4 Add the bankroll, exposure and disclaimer footer

## 10. Validation and operations

- [ ] 10.1 Walk-forward backtest on two past Liga MX tournaments; report market vs. model vs. combined log loss
- [ ] 10.2 Add `asterisk daily` to run all stages in order and stop cleanly on a stage failure
- [ ] 10.3 Document setup, config and the daily run in README.md
- [ ] 10.4 Paper-trade one full matchday cycle and review the card before any real stake
