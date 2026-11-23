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

Articles accept English or Spanish. Use direct, clean HTTPS citation URLs. Each quote must be an exact excerpt of under 25 words. In reviewed mode the operator supplies claims. With `ASTERISK_NEWS_PROVIDER=anthropic`, Asterisk instead sends article text, language and team to the configured Anthropic model for extraction. Set `ANTHROPIC_MODEL` and `ANTHROPIC_API_KEY` on the server. Extraction allows at most 12 calls or 15 seconds per run and discards invalid claims. Each request allows 512 output tokens. Unknown or contradictory wording can result in no observation. Rotation and confirmed star absence can affect the engine before prediction. Other accepted facts are context for the risk review.

A confirmed absence requires an official source for that team or independent reporting on two registrable domains. An entry in `lineups` has `team`, `publishedAt`, `url` and `starters`. A newer official lineup supersedes earlier availability and rotation reports. Absence from a starting lineup alone cannot establish injury. Keep the supplied publisher text and timestamps archived with the run's source material.

The default review selects up to three recorded concerns for each paper pick. `ASTERISK_REVIEW_PROVIDER=anthropic` lets the model rank the supplied evidence IDs. Each resulting statement is rendered from the saved facts. Review never changes a probability, stake or decision. The hosted review has a ten-second limit and at most four calls per card. If it is unavailable, each affected card entry identifies the local review and records why.
