# Spec Delta

## Purpose

Turns a final probability and a market price into a bet-or-no-bet decision, net of fees, with stake sizes bounded by fractional Kelly and hard limits from config.

## ADDED Requirements

### Requirement: Edge after fees
The system SHALL compute edge as p minus the effective cost per contract, where cost includes the ask price and the Kalshi fee from the configured fee schedule.

#### Scenario: Fee erases a thin edge
- **WHEN** p is 0.53, the ask is 52¢ and the fee is 2¢ per contract
- **THEN** edge is −0.01 and the decision is no bet

### Requirement: Minimum edge threshold
The system SHALL recommend a bet only when edge after fees is at least the configured threshold (default 0.03) and the market has enough volume to fill the stake.

#### Scenario: Edge below threshold
- **WHEN** edge after fees is 0.02
- **THEN** the output is no bet with reason `edge_below_threshold`

### Requirement: Fractional Kelly sizing
Stake SHALL be the Kelly fraction f* = (p − c) / (1 − c) multiplied by the configured Kelly multiplier (default 0.25) and the current bankroll, where c is the effective cost.

#### Scenario: Worked example
- **GIVEN** p 0.58, c 0.52, multiplier 0.25 and bankroll 1000
- **WHEN** the stake is computed
- **THEN** full Kelly is 0.125 and the stake before caps is 31.25

### Requirement: Hard caps
Stakes MUST be clipped to the configured per-bet cap and the remaining per-day cap; caps are read only from config and cannot be overridden at runtime.

#### Scenario: Daily cap reached
- **WHEN** earlier picks today already used the full daily cap
- **THEN** all further picks today are no bet with reason `daily_cap_reached`

### Requirement: No-bet is a valid result
Every evaluated market SHALL produce exactly one decision: bet with stake, or no bet with a reason code, and both SHALL be written to the ledger.

#### Scenario: Fair market
- **WHEN** the combined probability equals the normalized market probability
- **THEN** a no-bet decision with reason `no_edge` is recorded

### Requirement: Correlated exposure limit
The system SHALL treat outcomes of the same match as one exposure and MUST NOT recommend combined stakes on one match above the per-bet cap.

#### Scenario: Winner and both-teams-to-score on one match
- **WHEN** two markets on the same match both show edge
- **THEN** their combined stake does not exceed the per-bet cap
