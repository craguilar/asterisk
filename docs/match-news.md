# Match evidence and adversarial reviews

Set `ASTERISK_NEWS_FILE` to a server-owned JSON corpus. The pipeline matches both exact fixture team names and the kickoff instant. It reads a maximum of eight distinct articles per fixture. Only material published in the seven days before the snapshot and before kickoff is eligible. Article URLs identify sources. Asterisk reads the included text directly from the file. The account running Asterisk should restrict editing rights to trusted operators.

The following abbreviated example uses fictional sources and names. The official-domain and star lists are assertions made by the operator. The `*` official-domain entry applies to every team and is intended for a verified league or federation domain.

```json
{
  "version": 1,
  "options": {
    "officialDomains": {"Toluca": ["club.example.org"]},
    "stars": {"Toluca": ["Ana Gómez"]}
  },
  "matches": [{
    "home": "Toluca",
    "away": "Monterrey",
    "kickoff": "2026-05-09T01:00:00Z",
    "articles": [{
      "url": "https://club.example.org/press/squad",
      "language": "es",
      "team": "Toluca",
      "publishedAt": "2026-05-08T18:00:00Z",
      "text": "El club anunció que Ana Gómez es baja por lesión.",
      "claims": [{
        "type": "player_out",
        "value": "Ana Gómez",
        "confidence": "high",
        "quote": "Ana Gómez es baja por lesión."
      }]
    }],
    "lineups": []
  }]
}
```

Articles accept English or Spanish. Use direct, clean HTTPS citation URLs. Each quote must be an exact excerpt of under 25 words. In reviewed mode the operator supplies claims. With `ASTERISK_NEWS_PROVIDER=anthropic`, Asterisk instead sends article text, language and team to the configured Anthropic model for extraction. Set `ASTERISK_EXTRACT_MODEL` to a fast Anthropic model supporting JSON outputs and temperature zero. Set `ANTHROPIC_API_KEY` on the server. The extraction request uses a constrained JSON schema and a temperature of zero. Both published English and Spanish quotations are accepted. Extraction allows at most 12 calls or 15 seconds per run and discards invalid claims. Each request allows 512 output tokens. Unknown or contradictory wording can result in no observation. Rotation and confirmed star absence can affect the engine before prediction. Other accepted facts are context for the risk review.

A confirmed absence requires an official source for that team or independent reporting on two registrable domains. An entry in `lineups` has `team`, `publishedAt`, `url` and `starters`. A newer official team sheet supersedes a player-specific availability report only if it names the player as a starter. An unrelated partial lineup leaves the report active. A team-wide rotation report is superseded only by eleven distinct confirmed starters. Asterisk also accepts a confirmed XI from the current fixture’s pre-kickoff ESPN summary, verifies the summary identity and observation time, and stores its provenance. Absence from a starting lineup alone cannot establish injury. Keep the supplied publisher text and timestamps archived with the run's source material.

The default review selects up to three recorded concerns for each paper pick. `ASTERISK_REVIEW_PROVIDER=anthropic` lets the model rank the supplied evidence IDs. Set `ASTERISK_REVIEW_MODEL` to a stronger model for this step. Existing single-model installations may supply `ANTHROPIC_MODEL` as the fallback for either model ID. The separate extraction and review settings take priority. The reviewer receives the pick and a list of evidence IDs and returns schema-constrained IDs only. Each resulting statement is rendered from the saved facts. Selected evidence that has no corresponding fired rule appears under **Unmodeled risks** with publication time and source in the structured card and a citation in the dashboard and Markdown. Review never changes a probability, stake or decision. The hosted review has a ten-second limit and at most four calls per card. If it is unavailable, each affected card entry identifies the local review and records why.

## Public RSS and Atom feeds

Set `ASTERISK_NEWS_FEEDS` to a comma-separated selection of `espn-soccer`, `bbc-football`, and `elpais-deportes`. These IDs resolve to fixed publisher URLs. Live daily runs fetch each feed once and retain feed status and article count on the card. A feed outage preserves the results from the other feeds and any reviewed corpus. Reported zero matching articles means the retained stories supplied no eligible match observation.

Feed parsing accepts RSS 2, RDF RSS and Atom. Every request uses HTTPS, rejects redirects, reads at most 512 KiB, and times out after four seconds. The reader examines up to 100 entries and stores citation links only from the configured publisher's article hosts. It never visits an article link. The operator-supplied corpus can be combined with feeds.

To attach a feed entry to a side, its text must identify both opponents and its title must name one side unambiguously. The extractor receives only sentences that name that side and omit the opponent. The pipeline combines these results with reviewed articles, takes up to eight distinct current sources per fixture, and verifies all claims against their text before any rule can fire. Feeds supply dated text and provenance. Enable the hosted extractor to derive new observations from them. With reviewed-only extraction, a newly retrieved story has no verified claim until a reviewed claim is supplied for that article.

The API wire format follows [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Offline tests exercise the two response schemas, model selection, timing and authority boundaries with recorded responses. Hosted extraction and review require a separately configured deployment to verify live model behavior.
