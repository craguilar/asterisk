# Rules Catalog

The rulebook built by hand during the 2026 World Cup (104 matches, including 31 knockout games), consolidated for code. Rule IDs keep their original numbers so history stays traceable. Tiers set the **default weight before learning**; the ledger replaces these with learned weights once 50+ predictions settle.

- **Tier 1** (default β = 1.0): held up across the tournament.
- **Tier 2** (default β = 0.5): useful in specific situations.
- **Tier 3** (default β = 0.0, log only): burned us; kept so the ledger can confirm or bury them.

Caps are in log-odds. No rule may exceed 0.4; the total per outcome is capped at 0.8.

## Outcome rules (win / draw / loss)

| ID | Name | Tier | Fires when | Adjusts | Cap | Lesson |
|---|---|---|---|---|---|---|
| R01 | Blowout discount | 1 | Team's recent big win came vs. a team with a red card, already eliminated, or rotated | Shrinks that result's weight in form inputs (input-level, no direct adjustment) | — | Canada 6-0 vs. 9-man Qatar inflated Canada |
| R02 | Defensive collapse | 2 | Team conceded 4+ in a recent match with discipline problems (reds, errors) | Opponent win +, collapsing team clean sheet − | 0.25 | Qatar after 0-6 |
| R03 | Must-win urgency | 2 | One team needs a win, the other is safe | Must-win team + | 0.20 | South Africa 1-0 South Korea |
| R04 | Weak teams can score | 1 | Underdog has scored in most recent matches and favorite concedes in transition | Both-teams-to-score +, favorite clean sheet − | 0.30 | Haiti 2 vs. Morocco; Egypt 2 vs. Argentina |
| R06 | Rotation | 1 | `rotation_risk=high`, or next match is a bigger trophy within 5 days, or team already qualified | Favorite − , draw + | 0.40 | USA rotated, lost 3-2 to Türkiye |
| R07 | Rotation needs a reason | 1 | Favorite still needs the result | Blocks R06 | — | England still needed first place |
| R08 | Eliminated ≠ harmless | 2 | Eliminated team playing for pride, fresh reserves | Eliminated team's goal probability + | 0.20 | England 6-4 France in the bronze game |
| R09 | Draw incentives | 2 | One team only needs a draw, both are defensively organized | Draw + | 0.30 | — |
| R10 | No goal by default | 1 | Underdog has no proven scoring mechanism (low xG, no set-piece threat) | Underdog score − | 0.30 | Ghana 0.26 xG vs. Colombia |
| R11 | Stars only if confirmed | 1 | Star player's status is `confirmed` out, or official lineup omits him | Team − | 0.35 | Messi rested; Amoura false alarm |
| R12 | Big name ≠ goals | 2 | Striker returning with poor recent form or service | Blocks star-return boosts | — | Lukaku return |
| R13 | Explicit incentives | 1 | Table context changes motivation (qualified, eliminated, avoiding a bracket path) | Feeds R03, R06, R09 | — | — |
| R16 | Organized low block to penalties | 2 | Underdog is defensively organized, favorite lacks a block-breaking mechanism | Draw +, extra-time + | 0.30 | Paraguay over Germany, Morocco over Netherlands |
| R21 | Upset routing | 2 | Picking an underdog in a knockout | Shifts underdog win mass toward extra time/penalties unless both teams are open | — | Every R32 upset came via penalties |
| R25 | Clean-sheet streaks are opposition-relative | 1 | Clean-sheet streak built against weak attacks, now facing an elite one | Streak team clean sheet − | 0.30 | Mexico's run ended vs. England |
| R26 | Late window | 1 | Team has a deeper, fresher bench and opponent played 120 minutes recently | Deeper team + | 0.25 | Argentina 3 goals after 79' vs. Egypt |
| R27 | Coach adaptability | 2 | Coach has a record of lineup surprises | Widens uncertainty (shrinks all adjustments toward market) | — | Belgium benched De Bruyne and Doku, won 4-1 |
| R28 | Donation rate | 1 | Favorite is transition-leaky (concedes on counters) | Underdog goal +, both-teams-to-score + | 0.30 | Egypt and Cape Verde vs. Argentina |
| R30 | Dead-rubber motivation | 2 | Third-place or dead game | Team with fresh reserves + over team with tired starters | 0.25 | Bronze game lesson |
| R31 | Altitude and travel | 2 | Home team at high altitude, visitor without recent altitude exposure | Home + | 0.20 | Liga MX: Toluca, Pachuca, Mexico City |
| R32 | First-leg incentives | 2 | First leg of a two-legged tie where the away team holds the aggregate tiebreak | Away win −, draw +. Never reduces the home win | 0.20 | Monterrey 0-0 América (right); fading home favorite Toluca was wrong, Toluca 2-0 Atlas |

## Method rules (decided in 90 vs. extra time/penalties)

Base rate: 77% of 2026 World Cup knockout games were decided in 90 minutes (24 of 31). Stoppage time counts as 90 minutes.

| ID | Name | Tier | Fires when | Adjusts | Cap |
|---|---|---|---|---|---|
| M19 | Stoppage counts as 90 | 1 | Always | Defines the outcome; widens "in 90" mass by the late-window rate | — |
| M20 | Draw-machine signature | 2 | Both teams drew 2+ recent matches at 90 and neither has an elite late scorer | Extra time + | 0.40 |
| M22 | Grinder vs. grinder | 2 | Both teams are low-event defensive sides | Extra time + | 0.30 |
| M29 | Late weapons resolve games | 1 | Either team has a proven 85'+ scorer or deep bench | Extra time − | 0.30 |
| M10 | Depth decays with stage | 2 | Semifinal or final | Extra time + (finals ran long 4 of last 5 World Cups) | 0.20 |

## Tier 3 (log only)

| ID | Name | Why demoted |
|---|---|---|
| R15 | Exact-score templates (1-0, 2-1, 2-0) | Useful for score picks, not probabilities |
| R23 | Short-sample base rates as law | "Underdogs never win in 90" broke with Norway 2-1 Brazil |
| R24a | Override the user's contrarian pick | Override record was about 50/50, zero net value |
| R-v9 | "Elite scorers on both sides means no extra time" | Broken twice in one day (England-Norway, Argentina-Switzerland) |
| R-mkt | Market slice beats profile at the extremes | Egypt-Australia and Switzerland-Colombia went to penalties |
| R-inj | Discount an elite player for a known injury he already played through | Alcaraz beat Zverev 6-2, 7-6 two days after winning on the same strapped thigh |
| R-tbl | Near-equal table points mean near-equal teams | Atlas (4th) vs. Toluca (5th): Toluca won 2-0; venue and head-to-head carried more signal than 17 games of points |

## Process rules (not adjustments)

- **P1. Market first.** The normalized market price is the prior.
- **P2. Two sources for absences.** One aggregator is not enough.
- **P3. Lineup beats news.** Confirmed XI supersedes all availability flags.
- **P4. Log the user's pick.** When the user picks against the system, record it as its own predictor so the ledger can measure the user's edge too.
- **P5. No bet is normal.** Most markets are fair.
- **P6. Public news is priced.** News published before the market's last big move is already in a liquid price. Rules may adjust only on information newer than that (confirmed lineups, in-play events) or in thin markets.
- **P7. Rule-only edges pay a premium.** When the edge comes only from rule adjustments, with no model baseline behind it, require at least 5¢ after fees and half the normal stake until 50 such predictions have settled.
