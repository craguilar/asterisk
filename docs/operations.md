# Running and evaluating Asterisk

## Operational defaults

The HTTP service and daily cron share a dedicated Postgres database. The cron runs at 14:15 UTC. A per-date, per-mode lock protects concurrent runs. Risk settings in config/paper.json govern simulated capital. Credentials and quotas are principal-scoped. Rotate a web token by changing ASTERISK_USERS and restarting the web service. Keep PostgreSQL and Kalshi credentials in secret environment variables. Run on a host with HTTPS termination.

Use GET /health for database readiness and the analyst's run-status tool for feed availability. The two signals answer different questions. A day with zero open contracts is a successful discovery. A failed market provider produces an unavailable record and a failing cron exit status; rerun after the outage. Prior quotes are time-stamped. A live consultation suppresses a paper stake after kickoff or quote expiry.

The demo uses the embedded PostgreSQL engine and a loopback cookie. Its historical run and example live analysis cannot authorize a trade. Asterisk has no order route or exchange write tool. The optional account reader verifies the exchange-reported scope on startup and again at consultation.

## Deployment and recovery

Apply the Render Blueprint and choose service/database plans in the Render preview. Configure the analyst token map as a secret. The initial web boot creates the schema and first card if required. The cron subsequently writes the authoritative daily ledger. The service uses the private database connection string supplied by Render. A health failure should remove that instance from traffic. After deployment, verify a real authenticated consultation, model/provider status, scheduled run logs and persistence across a web restart.

Use managed Postgres backups. Before a schema-changing upgrade, restore a backup into a separate database and run the health, card and session checks there. Roll back the application with a compatible migration version. No destructive rollback or production restore is automated. Configure Render billing alerts and application monitoring for the chosen plans before continuous hosting.

## Evidence and outstanding gates

- The dated replay uses three actual pre-match exchange candles and a fitted ratings snapshot. Candle volume gives no executable ask size. A zero-stake recommendation is expected.
- The ordinary test suite runs offline using injected responses and disposable databases. The independent exchange benchmark uses previous football results and actual historical exchange prices. Data sources, exclusions and score definitions are in data/FOOTBALL.md.
- The private account protocol and hosted model adapters have offline fixtures. Live use requires appropriate user credentials. The local router provides deterministic summaries of saved evidence.
- Football fixtures, regulation results and selected official match details are public feeds. Coverage for player injuries, non-league schedule congestion, published lineups and timestamped news depends on the supplied sources. Missing facts do not trigger a positive rule.
- Prospective matchday paper observation, live private-key/hosted-model validation, hosted Render staging, a managed backup restore, and production monitoring remain external release gates. Neither archive performance nor a replay counts toward the live sample. The original composite research backlog remains visible in the OpenSpec task list.
