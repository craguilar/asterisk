# Spec Delta

## Purpose

Reads Kalshi sports markets and prices without trading, converts them into normalized implied probabilities, and keeps a price history so the system can measure closing-line value.

## ADDED Requirements

### Requirement: Read-only market access
The system SHALL access Kalshi only through read endpoints. It MUST NOT create, modify or cancel orders, and MUST refuse to start if configured credentials carry trading scope and `trading.enabled` is false.

#### Scenario: Trading attempt is blocked
- **WHEN** any component tries to call an order endpoint
- **THEN** the call is rejected before any network request and an error is logged

### Requirement: Market discovery by league and date
The system SHALL list open Kalshi markets for a configured league and date range, returning event ticker, market ticker, outcome label, close time and settlement rules text.

#### Scenario: Liga MX markets for a matchday
- **WHEN** the user runs discovery for Liga MX on a date with scheduled matches
- **THEN** each match's win/draw/loss markets are returned with tickers and close times in UTC

### Requirement: Implied probability normalization
The system SHALL convert prices in cents to probabilities and, for mutually exclusive outcome sets, normalize so they sum to 1, storing both raw and normalized values and the overround.

#### Scenario: Three-way market with overround
- **GIVEN** home 52¢, draw 27¢, away 26¢
- **WHEN** the market is normalized
- **THEN** overround is 0.05 and normalized probabilities are 0.4952, 0.2571 and 0.2476

### Requirement: Price snapshots
The system SHALL store a timestamped snapshot of bid, ask, last price and volume for each tracked market at prediction time and at market close.

#### Scenario: Closing price recorded
- **WHEN** a tracked market reaches its close time
- **THEN** a snapshot tagged `closing` exists for it, used later for closing-line value

### Requirement: Market-to-match linking
The system SHALL link each market to exactly one match record and flag markets it cannot link instead of guessing.

#### Scenario: Ambiguous team name
- **WHEN** a market title cannot be matched to a known fixture with confidence
- **THEN** the market is stored as `unlinked` and excluded from predictions
