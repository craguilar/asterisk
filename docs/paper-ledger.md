# Paper Ledger

Hand-scored predictions made before the engine exists. Import into the SQLite ledger once task 8.1 lands. Prices are Kalshi, normalized. Brier is the sum of squared errors across all outcomes of the market (lower is better).

## Predictions

| Date | Market | Market prior | Our estimate | Decision | Result | Brier (ours / market) | P&L per contract |
|---|---|---|---|---|---|---|---|
| 2026-11-21 | Pumas vs Monterrey, tie (live, HT 0-0) | Tie 37% | Tie 32.5% (R03 must-win) | Tie NO @ 63¢ | Monterrey won | 0.106 / 0.137 | +0.37 |
| 2026-11-22 | Zverev vs Alcaraz, ATP Finals final | ALC 66% / ZVE 34% | ALC 57% / ZVE 43% (R11 injury) | Zverev YES @ 34¢ | Alcaraz 6-2, 7-6(7) | 0.370 / 0.231 | −0.34 |
| 2026-11-25 | Monterrey vs América, QF leg 1 | 42.6 / 27.7 / 29.7 | 41.4 / 28.7 / 29.9 (R32) | No bet (`no_edge`) | 0-0 (MTY 10 men from 12') | 0.769 / 0.792 | 0 |
| 2026-11-25 | Toluca vs Atlas, QF leg 1 | 68.0 / 18.4 / 13.6 | 63.5 / 22.0 / 14.5 (R32, R11, R14) | Toluca NO @ 31¢ | Toluca 2-0 | 0.202 / 0.155 | −0.31 |

No-bet live markets on 2026-11-21 (VT vs Miami, Delaney vs Ferguson, Gadecki vs Garland, Adams vs Beck) are not scored here.

## Running totals (4 scored)

- Bets: 3, won 1, P&L −0.28 per contract before fees.
- Brier vs. market: better on 2 of 4, worse on 2 of 4.

## What the four results say

1. **Game-state adjustments to the draw beat the market both times.** Raising the draw in a first leg and lowering it when one side must win were both right.
2. **Fading a favorite on public news lost both times.** The Alcaraz injury and Toluca's poor recent form were reported before the market settled, so the price already held them (now P6).
3. **First-leg incentives act on the away side, not the home favorite.** The away team holding the tiebreak plays for a draw. That cuts its own win chances and raises the draw; it does not stop the home side winning (R32 rewritten).
4. **Sample size is 4.** None of this is significant. These are hypotheses for the ledger, which is why R-inj and R-tbl go to Tier 3 instead of being deleted.
