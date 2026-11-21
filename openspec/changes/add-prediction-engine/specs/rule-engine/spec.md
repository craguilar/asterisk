# Spec Delta

## Purpose

Encodes the World Cup rulebook as a registry of small, bounded, explainable adjustments whose weights are learned from the ledger rather than set by intuition.

## ADDED Requirements

### Requirement: Rule registry
Each rule SHALL be declared with an id, name, tier, target outcome, inputs it reads, a log-odds adjustment cap and a default weight, and SHALL be listed in docs/rules-catalog.md.

#### Scenario: Listing rules
- **WHEN** the user runs the rules list command
- **THEN** every registered rule is shown with id, tier, cap, current weight and fire count

### Requirement: Bounded adjustments
A single rule's adjustment MUST NOT exceed its cap, which MUST NOT exceed 0.4 in log-odds, and the sum of all rule adjustments for one outcome MUST NOT exceed 0.8.

#### Scenario: Several rules fire together
- **WHEN** three rules each propose +0.35 on the same outcome
- **THEN** the total applied adjustment is +0.8 and the clipping is recorded

### Requirement: Explanation for every fire
Each rule evaluation SHALL return whether it fired, the adjustment, the inputs used and a one-line explanation that cites the flags or statistics behind it.

#### Scenario: Rotation rule fires
- **WHEN** a favorite has `rotation_risk=high` and its next match is a final within five days
- **THEN** the rule returns a negative adjustment on that favorite with the explanation and flag ids

### Requirement: Confirmed inputs only for star-player rules
Rules that depend on a specific player's availability SHALL use only `confirmed` flags or the official lineup, never `player_doubtful` flags alone.

#### Scenario: Doubtful star
- **WHEN** the only evidence for a star's absence is a doubtful flag
- **THEN** the star-absence rule does not fire and the reason is logged

### Requirement: Method-of-victory rules
For knockout markets the engine SHALL estimate P(decided in 90 minutes) starting from the configured base rate and adjusting only through registered rules, counting stoppage time as 90 minutes.

#### Scenario: Two grinders with no late-goal threat
- **WHEN** both teams match the draw-machine signature and neither has a late-goal weapon
- **THEN** the extra-time probability is raised and the pick card cites the rule

### Requirement: Rule weights come from the ledger
Rule weights SHALL be read from the latest weight version produced by ledger evaluation; a rule whose learned weight is zero SHALL still be evaluated and logged but contribute nothing.

#### Scenario: Pruned rule
- **WHEN** regularized fitting sets a rule's weight to zero
- **THEN** it keeps logging fires but its applied adjustment is 0
