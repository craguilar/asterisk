# Spec Delta

## Purpose

Uses an LLM to read news, previews and press-conference reports in Spanish or English and turn them into structured, source-cited match flags that the rule engine can consume.

## ADDED Requirements

### Requirement: Structured flag output
The extractor SHALL emit only JSON that validates against the flag schema: match id, team, flag type, value, confidence (low, medium, high), quoted evidence and one or more source URLs.

#### Scenario: Invalid model output
- **WHEN** the model returns text that fails schema validation twice
- **THEN** no flags are stored for that article and the failure is logged

### Requirement: Supported flag types
The extractor SHALL support at least these flag types: `player_out`, `player_doubtful`, `player_limited`, `rotation_risk`, `coach_change`, `motivation`, `travel_or_altitude`, and `tactical_change`.

#### Scenario: Rotation before a trophy match
- **WHEN** a preview says the coach will rest starters before a final in four days
- **THEN** a `rotation_risk` flag with value `high` and the quoted sentence is stored

### Requirement: Source citation required
Every flag MUST carry at least one source URL and a quote under 25 words from that source supporting it. Flags without both MUST be discarded.

#### Scenario: Unsupported claim
- **WHEN** the model asserts a player is injured but cannot quote a source sentence
- **THEN** the flag is discarded

### Requirement: Two-source rule for absences
A `player_out` flag SHALL be marked `confirmed` only when two independent domains report it or an official club or league source does; otherwise it is stored as `player_doubtful`.

#### Scenario: Single aggregator claims a star is out
- **WHEN** one site lists a forward as out and three others list him as starting
- **THEN** the flag is stored as `player_doubtful` with the conflicting sources attached

### Requirement: No probabilities from the LLM
The extractor MUST NOT output win probabilities, scores or bet recommendations. Any such field in the output MUST be stripped before storage.

#### Scenario: Model volunteers a prediction
- **WHEN** the model output includes "Toluca should win 2-0"
- **THEN** that text is not stored as a flag or used by any downstream component

### Requirement: Flag freshness
Each flag SHALL store the publish time of its source, and flags older than the confirmed lineup SHALL be superseded by the lineup.

#### Scenario: Doubtful player starts
- **WHEN** a player flagged `player_doubtful` appears in the confirmed starting XI
- **THEN** the flag is marked superseded and no longer affects the prediction
