# Oregon staging estimate

The Blueprint creates one web service, a 15-minute scheduled job and one private PostgreSQL 18 database. Use the `feat/read-only-analyst` branch of `craguilar/asterisk` for this release. Both services use the same private database connection.

| Resource | Selected size | Estimated monthly USD |
| --- | --- | ---: |
| Web | 0.5 CPU, 512 MB | $7 |
| Database | 0.1 CPU, 256 MB, 1 GB storage | $6 |
| Scheduled refresh | 0.5 CPU, 512 MB, billed for active seconds | $1 minimum |
| Default analyst and public feeds | Local deterministic responses, public market and football data | $0 in model fees |
| **Expected base** | Hobby workspace, usual short refreshes | **About $14** |

Prices checked November 26, 2026. Budget for taxes, excess bandwidth or build usage, storage growth, paid workspace seats and any optional model usage separately. The cron minimum covers short runs and increases with active runtime. Confirm the itemized total in the dashboard before applying. [Render pricing](https://render.com/pricing) · [Cron billing](https://render.com/docs/cronjobs)

## Deploy after budget approval

1. Open **New → Blueprint** in the Render dashboard. Select `craguilar/asterisk`, branch `feat/read-only-analyst`, Blueprint file `render.yaml`. Inspect the service plans, region, PostgreSQL storage, and monthly estimate.
2. Set `ASTERISK_USERS` on the web service to a JSON object mapping analyst IDs to unique random bearer tokens of at least 32 characters. Store tokens in the dashboard's secret fields. Public market and football reads work without private credentials.
3. Apply the Blueprint after cost approval. Wait for the green deployment and `/health`, open the HTTPS service URL, sign in and ask “Show run status.” Confirm market source time and database status. Trigger one scheduled refresh and verify the resulting card. Check the next scheduled run for independent execution.
4. Restart the web service and verify the same run and session remain visible. Restore a managed backup into a separate staging database before approving hosted recovery. Monitor database size, cron failures, stale prices and usage alerts in the Render workspace.

## Inspect the ledger

Authenticated `GET /api/domain` exports the current run's fitted parameters, source history, price snapshots and decisions. Legacy uncaptured runs return a null domain. `GET /api/matchday?date=YYYY-MM-DD` or `node dist/main.js paper-day YYYY-MM-DD` lists the first live forecast recorded before kickoff for each covered contract, using the Mexico City match date. A settled result requires all three observed contracts for every recorded fixture. An unavailable schedule or an unlisted fixture can limit coverage.

For a sourced probability correction, run `node dist/main.js correct correction.json` with `DATABASE_URL` pointing at the intended database. Supply `runId`, `ticker`, `expectedRevision` (zero initially), `correctedProbability`, `reason` and an HTTPS `source`. The operator writes an immutable revision. The dashboard and `GET /api/corrections` expose the audit history for the current run. Performance and weight training use the original as-issued probabilities. Closing-price revisions use a separate append-only record so a candle outage cannot hide an official outcome.
