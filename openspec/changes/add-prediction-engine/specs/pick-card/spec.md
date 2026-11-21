# Spec Delta

## Purpose

Presents each day's predictions as a short, readable card that shows the numbers, the reasons, the strongest argument against each bet and what would change the pick.

## ADDED Requirements

### Requirement: Card contents per match
For each evaluated market the card SHALL show match, kickoff in local time, market price, model probability, final probability, edge after fees, decision, stake, fired rules with explanations and the cited sources.

#### Scenario: Bet recommended
- **WHEN** a market passes the edge threshold
- **THEN** its card section shows the stake and every fired rule with its explanation

### Requirement: Adversarial review
For every recommended bet the system SHALL run an LLM review prompted to argue against the bet using only stored flags, data and sources, and SHALL show its top three risks on the card.

#### Scenario: Review finds a new risk
- **WHEN** the review cites a risk not covered by any fired rule
- **THEN** the card shows it under "Unmodeled risks" with its source and it does not change the probability

### Requirement: Kill-switch conditions
Each recommended bet SHALL list the observable events before kickoff that would cancel it, such as a named player missing from the confirmed lineup.

#### Scenario: Lineup check
- **WHEN** a bet depends on a star starting
- **THEN** the card states "cancel if <player> is not in the starting XI"

### Requirement: Output formats
The card SHALL be produced as Markdown for reading and JSON for machines, from the same data.

#### Scenario: Daily run
- **WHEN** the daily command finishes
- **THEN** both `card-YYYY-MM-DD.md` and `card-YYYY-MM-DD.json` exist with the same picks

### Requirement: Responsible-use footer
Every card SHALL include the current bankroll, today's exposure against the daily cap, and a line stating that the output is analysis, not financial advice.

#### Scenario: Card footer
- **WHEN** any card is generated
- **THEN** the footer shows bankroll, exposure and the disclaimer
