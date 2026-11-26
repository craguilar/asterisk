# Football evidence and forecast records

Each daily run saves its football fit, fixture list, ingested results and evidence in the same PostgreSQL transaction as the card and its decisions. This also records a successful football fit when Kalshi lists no contracts. The source record distinguishes a failed feed from an empty one. A fitted parameter version stores every team's attack, defense and sample count plus the league intercept, home advantage and low-score correlation. Run records hold the fit cutoff, latest eligible observation and sample count.

`loadRunDomain(sql, runId)` exports the ratings, source statuses, pre-cutoff results, matches, price snapshots, decisions, goals, lineups, availability and cited flags. Unknown datasets are represented by empty arrays. The frozen replay includes the redistributable CC0 result subset and the complete previously verified fit. Its coverage field identifies the separately retrievable ESPN input. Rebuilding the coefficients is documented in `data/FOOTBALL.md`. A run made before migration 005 has no reconstructed evidence. A new daily invocation captures current inputs without rewriting its predecessor.

## Optional reviewed scouting evidence

Set `ASTERISK_SCOUTING_FILE` to a local JSON file to supplement the live football provider with observations from identified sources. Source URLs and quotes travel with the match record. An observation must match the exact home team, away team and kickoff. The daily forecast considers evidence observed during the prior seven days, through its cutoff, before kickoff. Entries for the same fixture and fact are applied in observation-time order. Player absences and lineup confirmations go through the news and lineup verification paths.

```json
{
  "version": 1,
  "matchEvidence": [
    {
      "home": "Toluca",
      "away": "Monterrey",
      "kickoff": "2026-11-08T01:00:00Z",
      "team": "away",
      "facts": {"freshReserves": true},
      "observedAt": "2026-11-07T12:00:00Z",
      "source": "https://club.example/preview",
      "quote": "Two fresh reserves named in the squad."
    }
  ],
  "distortedResults": []
}
```

The example is synthetic. Accepted match-level and team-level fields are enumerated in `src/scouting.ts`. For R01, a distorted-result record identifies the exact result date, home team, away team, winning side, documented reason, observation timestamp, source URL and quote. A margin of at least three goals and the correct winning side are required. The engine halves that observation's contribution to team form and fitting. No universal historical red-card or fatigue feed is assumed.

Three-way cards can include unpriced diagnostics for scoring, clean sheets, both teams scoring and knockout method. The estimates expose the baseline, adjustment and cited rules. They carry no contract, ask, stake or proposed trade. R21 can split a separately supplied advancement forecast only after a paper selection of the underdog and only when the extra-time and advancement masses are consistent. R12 blocks a return-dependent scoring route when recent form or service is poor. R27 shrinks model disagreement with the market as well as the log-odds adjustments. The historical 77% regulation base already includes added time. An observed added-time length produces a separate conditional estimate for a match tied at 90.


Every new run references a content-addressed training set. Repeated refreshes of an identical set share the result membership rows. Original run-specific membership remains readable after upgrade.
