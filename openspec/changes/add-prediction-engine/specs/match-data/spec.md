# Spec Delta

## Purpose

Provides the structured football facts the model and rules depend on: fixtures, results with goal times, lineups, injuries, suspensions and schedule congestion for supported leagues.

## ADDED Requirements

### Requirement: Fixtures and results history
The system SHALL load fixtures and final results for supported leagues, including at least the last four seasons for model fitting, with kickoff time, venue, competition stage and score after 90 minutes, after extra time and on penalties.

#### Scenario: Knockout match settled on penalties
- **WHEN** a Liguilla match ends 1-1 after 90 and is decided on penalties
- **THEN** the record stores the 90-minute score, the extra-time score and the penalty result separately

### Requirement: Goal event timing
The system SHALL store each goal's minute, including stoppage-time minutes, and whether it came from a penalty, set piece or open play when the source provides it.

#### Scenario: Stoppage-time goal
- **WHEN** a goal is scored at 90+4
- **THEN** it is stored as minute 90 with added minute 4 and counts toward the 90-minute result

### Requirement: Lineups and availability
The system SHALL record confirmed lineups when published and, before that, the latest injury and suspension list per team with a source and timestamp for each entry.

#### Scenario: Lineup published before kickoff
- **WHEN** official lineups appear about 60 minutes before kickoff
- **THEN** they replace projected availability and the change is timestamped

### Requirement: Schedule congestion
The system SHALL compute, per team and match, days since the previous match, days until the next match and the competition of that next match.

#### Scenario: Cup final four days later
- **WHEN** a team plays a league match four days before a trophy match
- **THEN** the match context shows `next_match_days=4` and the next competition name

### Requirement: League table context
The system SHALL compute the table position, points gaps and qualification or elimination status for each team before each match.

#### Scenario: Team already qualified
- **WHEN** a team has mathematically secured a Liguilla place
- **THEN** its match context is marked `qualified=true`
