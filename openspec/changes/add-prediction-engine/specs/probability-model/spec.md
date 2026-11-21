# Spec Delta

## Purpose

Produces calibrated outcome probabilities from a Dixon-Coles goal model and blends them with the market prior and rule adjustments in log-odds space.

## ADDED Requirements

### Requirement: Dixon-Coles team ratings
The system SHALL fit per-team attack and defense strengths plus a home-advantage term from historical results, with exponential time decay and the Dixon-Coles low-score correction, refit at least once per matchday.

#### Scenario: Refit after a matchday
- **WHEN** all results of a matchday are loaded
- **THEN** ratings are refit and stored with a version id and fit timestamp

### Requirement: Scoreline grid
For each match the model SHALL produce expected goals for both teams and a scoreline probability grid covering 0-10 goals per side, summing to at least 0.999.

#### Scenario: Grid integrity
- **WHEN** a grid is produced for any match
- **THEN** every cell is in [0,1] and the total is between 0.999 and 1.000

### Requirement: Derived market probabilities
The model SHALL derive home/draw/away, both-teams-to-score, over/under at 0.5 to 4.5 goals, exact score and level-at-90 probabilities from the grid.

#### Scenario: Worked example without correction
- **GIVEN** independent Poisson with expected goals 1.6 home and 1.0 away
- **WHEN** outcomes are derived
- **THEN** home 0.5134, draw 0.2500, away 0.2366, both-teams-to-score 0.5045 and over 2.5 is 0.4816, each within 0.001

### Requirement: Late-window goal intensity
The model SHALL support a time-varying goal rate so the probability of a goal after the 75th minute, including stoppage time, can be estimated and fed to rules.

#### Scenario: Level at 75 minutes
- **WHEN** a knockout match is level after 75 minutes
- **THEN** the model reports the probability that it is still level after 90 plus stoppage

### Requirement: Log-odds combiner
The system SHALL combine probabilities as logit(p) = w·logit(p_market) + (1−w)·logit(p_model) + Σ rule adjustments, with w configurable and default 0.7, then renormalize multi-outcome sets.

#### Scenario: Worked example
- **GIVEN** market 0.50, model 0.55, w 0.7 and one rule adjustment of −0.15
- **WHEN** combined for a binary outcome
- **THEN** the final probability is 0.4776 within 0.001

### Requirement: Market-only fallback
If the model cannot rate a team, the combiner SHALL use the market prior plus rule adjustments and mark the prediction `model_missing`.

#### Scenario: Newly promoted team
- **WHEN** a team has fewer than five matches in the training window
- **THEN** the prediction is produced from the market and rules and flagged `model_missing`
