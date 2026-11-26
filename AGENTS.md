# AGENTS.md

Guide for AI coding agents working in this repository.

## What this is

Asterisk is a sports-prediction engine for Kalshi event contracts. It starts from the market price, adds a Dixon-Coles goal model and a rulebook learned during the 2026 World Cup, sizes bets with fractional Kelly, and scores everything in a ledger.

## Source of truth

This project is spec-driven with [OpenSpec](https://github.com/Fission-AI/OpenSpec).

- Proposed work: `openspec/changes/<change-id>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/**/spec.md`)
- Accepted behavior: `openspec/specs/` (filled when a change is archived)
- Project constraints: `openspec/config.yaml`
- Rule definitions: `docs/rules-catalog.md`

Before writing code, read the active change and its specs. Implement tasks in order and tick them in `tasks.md`. Run `openspec validate --strict` after editing any spec.

## Hard constraints

1. Never call a Kalshi order endpoint. Trading is disabled regardless of whether the ledger's trading gate passes.
2. Never let an LLM output a probability, score prediction or stake.
3. Money limits come only from config.
4. Every rule adjustment is capped (0.4 per rule, 0.8 total, log-odds) and logged.
5. Tests run offline against recorded fixtures; no live API calls in the test suite.
6. Every math function gets a unit test with the worked example from its spec.

## Commands

```bash
npm ci
npm test
npm run build
npm run daily
openspec validate --strict
```
