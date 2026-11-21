# Spec Delta

## Purpose

Keeps an append-only record of every prediction and decision, settles them against results, and measures whether the model, the rules and the LLM flags actually beat the market.

## ADDED Requirements

### Requirement: Append-only prediction ledger
Every prediction SHALL be written once with timestamp, market prices, model probabilities, each rule's fire and adjustment, flags used, final probability, decision and stake; records MUST NOT be edited after writing.

#### Scenario: Correcting a mistake
- **WHEN** a prediction needs correction
- **THEN** a new record references the old one and the original stays unchanged

### Requirement: Settlement
The system SHALL settle each prediction from official results, using the market's own settlement rules, and record outcome and profit or loss.

#### Scenario: Stoppage-time winner on a 90-minute market
- **WHEN** a match is won at 90+3 and the market resolves on the 90-minute result
- **THEN** the prediction is settled as decided in 90 minutes

### Requirement: Scoring metrics
The system SHALL report Brier score, log loss and calibration buckets for the market, the model alone and the combined prediction over any date range.

#### Scenario: Comparing against the market
- **WHEN** the user requests a report for the last 100 settled predictions
- **THEN** Brier and log loss are shown side by side for market, model and combined

### Requirement: Closing-line value
For every bet the system SHALL compute closing-line value as the closing normalized probability minus the probability implied by the entry price.

#### Scenario: Price moved toward the pick
- **WHEN** a bet entered at 0.45 implied closes at 0.50
- **THEN** CLV is +0.05 for that bet

### Requirement: Per-rule attribution
The system SHALL report, per rule, fire count, average adjustment and the change in log loss with versus without that rule over settled predictions.

#### Scenario: Rule that hurts
- **WHEN** removing a rule improves log loss over its fires
- **THEN** the report marks the rule `harmful`

### Requirement: Weight learning
After at least 50 new settled predictions the system SHALL refit rule weights with L1-regularized logistic regression, store them as a new weight version and never apply weights fitted on fewer than 50 predictions.

#### Scenario: Not enough data
- **WHEN** only 30 predictions are settled
- **THEN** default weights stay active and the report states the sample is too small

### Requirement: Trading gate report
The system SHALL report whether the gate for enabling trading is met: at least 100 settled bets with positive mean CLV and combined log loss below the market's.

#### Scenario: Gate not met
- **WHEN** mean CLV over 120 bets is −0.01
- **THEN** the report shows the gate as not met
