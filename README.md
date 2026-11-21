# Asterisk

A disciplined prediction engine for Kalshi sports contracts.

**Status:** specification only. See `openspec/changes/add-prediction-engine/`.

## How it thinks

1. **Market first.** The Kalshi price is the starting probability.
2. **Math baseline.** A Dixon-Coles goal model gives win/draw/loss, both-teams-to-score, totals and level-at-90 odds.
3. **Rules as evidence.** The World Cup rulebook (`docs/rules-catalog.md`) adds small, capped, logged adjustments in log-odds.
4. **LLM as analyst, not oracle.** A model reads Spanish/English news into cited flags and argues against each bet. It never sets a probability.
5. **Edge or no bet.** Bets need edge after fees above a threshold; stakes use quarter Kelly under hard caps.
6. **Ledger decides.** Brier, log loss, calibration and closing-line value show whether any of it beats the market, and which rules earn their weight.

## Layout

```
openspec/
  config.yaml                         project constraints for agents
  changes/add-prediction-engine/      proposal, design, tasks, 8 capability specs
docs/rules-catalog.md                 the rulebook, tiered, with caps
AGENTS.md                             instructions for coding agents
```

## Working with the spec

```bash
npm i -g @fission-ai/openspec
openspec list
openspec show add-prediction-engine
openspec validate add-prediction-engine --strict
```

With Claude Code, use the bundled OpenSpec skills in `.agents/skills/` (propose, apply, archive).

This project produces analysis, not financial advice. Bet only what you can afford to lose.
