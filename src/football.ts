import { matchDetail } from './football-details.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DAY = 86_400_000;
const ARCHIVE = new URL('../data/liga-mx.csv', import.meta.url);
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const FIXTURE_UTC = '2026-11-08T01:00:00.000Z';
const DEFAULT_CUTOFF = '2026-11-07T16:00:00.000Z';

const names: Record<string, string[]> = {
  Toluca: ['Deportivo Toluca', 'Deportivo Toluca FC', 'Toluca', 'TOL'],
  Monterrey: ['CF Monterrey', 'Monterrey', 'MON', 'MTY'],
  América: ['CF América', 'Club América', 'América', 'AME'],
  Atlas: ['Atlas Guadalajara', 'Atlas FC', 'Atlas', 'ATS'],
  'Atlético de San Luis': ['Atlético San Luis', 'Atlético de San Luis', 'San Luis', 'ASL'],
  Guadalajara: ['Deportivo Guadalajara', 'CD Guadalajara', 'Guadalajara', 'Chivas', 'GDL', 'GUAD'],
  'Cruz Azul': ['Cruz Azul', 'CF Cruz Azul', 'CRA', 'CAZ'],
  Juárez: ['FC Juárez', 'Juárez', 'JUA'],
  León: ['Club León', 'León', 'LEO'],
  Mazatlán: ['Mazatlán FC', 'Mazatlán', 'MAZ'],
  Necaxa: ['Club Necaxa', 'Necaxa', 'NCX'],
  Pachuca: ['CF Pachuca', 'Pachuca', 'PAC'],
  Puebla: ['Puebla FC', 'Club Puebla', 'Puebla', 'PUE'],
  'Pumas UNAM': ['Pumas UNAM', 'UNAM', 'Pumas', 'PUM'],
  Querétaro: ['Gallos Blancos', 'Queretaro FC', 'Querétaro', 'QUE', 'QRO'],
  'Santos Laguna': ['Santos Laguna', 'Club Santos Laguna', 'Santos', 'SAN', 'SAL'],
  'Tigres UANL': ['UANL Tigres', 'Tigres UANL', 'Tigres', 'TIG'],
  Tijuana: ['Club Tijuana', 'Tijuana de Caliente', 'Club Tijuana de Caliente', 'Tijuana', 'TIJ'],
  Atlante: ['Atlante', 'ALA', 'ATLANTE'],
};
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const aliasMap = new Map(Object.entries(names).flatMap(([name, aliases]) => aliases.map(alias => [fold(alias), name] as const)));
export const teamName = (s: string) => aliasMap.get(fold(s)) ?? s;

export interface Result {
  date: string;
  availableAt: number;
  season: string;
  stage: string;
  home: string;
  away: string;
  hg: number;
  ag: number;
}
export interface Ratings {
  version: string;
  trainedThrough: string | null;
  asOf: string;
  samples: number;
  intercept: number;
  advantage: number;
  rho: number;
  teams: Record<string, { attack: number; defense: number; matches: number }>;
}

export function history(): Result[] {
  return readFileSync(ARCHIVE, 'utf8').trim().split(/\r?\n/).slice(1).map(line => {
    const [date, season, stage, h, a, hg, ag] = line.split(',');
    // Conservative availability for calendar-day records lacking kickoff and timezone.
    return { date, availableAt: Date.parse(date + 'T00:00:00Z') + 2 * DAY, season, stage,
      home: teamName(h), away: teamName(a), hg: Number(hg), ag: Number(ag) };
  });
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(x, hi));
const rate = (eta: number) => Math.exp(clamp(eta, Math.log(0.15), Math.log(4.4)));

export function fit(results: Result[], asOf: string): Ratings {
  const time = Date.parse(asOf);
  if (!Number.isFinite(time)) throw Error('Invalid model cutoff');
  const eligible = results.filter(g => g.availableAt < time && time - g.availableAt <= 1461 * DAY);
  const keys = [...new Set(eligible.flatMap(g => [g.home, g.away]))].sort();
  const index = new Map(keys.map((t, i) => [t, i]));
  const n = keys.length;
  const attack = new Float64Array(n);
  const defense = new Float64Array(n);
  const played = new Uint32Array(n);
  const volume = new Float64Array(n);
  const observations = eligible.map(g => {
    const h = index.get(g.home)!;
    const a = index.get(g.away)!;
    const w = Math.exp(-Math.LN2 * (time - g.availableAt) / (365 * DAY));
    played[h]++; played[a]++; volume[h] += w; volume[a] += w;
    return { h, a, w, x: g.hg, y: g.ag };
  });
  const mass = observations.reduce((s, g) => s + g.w, 0);
  let intercept = 0.18, advantage = 0.16, rho = 0;
  // Penalized, recency-weighted log-likelihood. The Fisher-style diagonal scaling
  // keeps small clubs stable; L2 shrinkage also identifies attack/defense effects.
  for (let step = 0; step < 120 && mass; step++) {
    const da = attack.map(x => -3 * x), dd = defense.map(x => -3 * x);
    let dBase = 0, dAdv = 0, dRho = -5 * rho;
    for (const { h, a, w, x, y } of observations) {
      const homeEta = intercept + advantage + attack[h] + defense[a];
      const awayEta = intercept + attack[a] + defense[h];
      const l = rate(homeEta), m = rate(awayEta);
      // tau and its derivatives for the four Dixon–Coles low-score cells.
      let raw = 0, dl = 0, dm = 0;
      if (x === 0 && y === 0) { raw = -l * m; dl = raw; dm = raw; }
      if (x === 0 && y === 1) { raw = l; dl = l; }
      if (x === 1 && y === 0) { raw = m; dm = m; }
      if (x === 1 && y === 1) raw = -1;
      const tau = 1 + rho * raw;
      const dx = (homeEta === clamp(homeEta, Math.log(0.15), Math.log(4.4))) ? w * (x - l + rho * dl / tau) : 0;
      const dy = (awayEta === clamp(awayEta, Math.log(0.15), Math.log(4.4))) ? w * (y - m + rho * dm / tau) : 0;
      da[h] += dx; dd[a] += dx; da[a] += dy; dd[h] += dy;
      dBase += dx + dy; dAdv += dx; dRho += w * raw / tau;
    }
    const scale = 0.3;
    intercept += scale * dBase / (2 * mass);
    advantage += scale * dAdv / mass;
    rho = clamp(rho + scale * dRho / mass, -0.16, 0.045);
    for (let i = 0; i < n; i++) {
      attack[i] += scale * da[i] / (3 + volume[i]);
      defense[i] += scale * dd[i] / (3 + volume[i]);
    }
  }
  const teams = Object.fromEntries(keys.map((k, i) => [k, {attack: attack[i], defense: defense[i], matches: played[i]}]));
  const version = 'dc1-' + createHash('sha256').update(JSON.stringify([teams, intercept, advantage, rho])).digest('hex').slice(0, 16);
  return { version, asOf, samples: eligible.length, trainedThrough: eligible.length ? new Date(Math.max(...eligible.map(g=>g.availableAt))).toISOString() : null,
    teams, intercept, advantage, rho };
}

export function forecast(model: Ratings, home: string, away: string) {
  const h = model.teams[teamName(home)], a = model.teams[teamName(away)];
  if (!h || !a || h.matches < 5 || a.matches < 5) return {lambdaHome: null, lambdaAway: null, rho: model.rho};
  return {lambdaHome: rate(model.intercept + model.advantage + h.attack + a.defense),
    lambdaAway: rate(model.intercept + a.attack + h.defense), rho: model.rho};
}

interface Competitor {
  homeAway: string;
  team: { displayName: string; shortDisplayName?: string; abbreviation?: string };
  score?: string | { value: number };
}
export interface FootballEvent {
  id: string;
  date: string;
  season?: { year:number; slug:string };
  competitions: Array<{ venue?:{fullName?:string}; competitors: Competitor[]; status: {type: {state: string; name: string}; period?: number} }>;
}
export async function scoreboard(dates: string, fetchImpl: typeof fetch = fetch): Promise<FootballEvent[]> {
  const url = new URL(ESPN);
  url.searchParams.set('dates', dates);
  url.searchParams.set('limit', '1000');
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(15000), redirect: 'error'});
  if (!response.ok) throw Error('ESPN scoreboard returned HTTP ' + response.status);
  const data = await response.json();
  if (!Array.isArray(data.events)) throw Error('ESPN scoreboard missing events');
  return data.events;
}

function sides(event: FootballEvent) {
  const c = event.competitions[0];
  const h = c?.competitors?.find(t => t.homeAway === 'home');
  const a = c?.competitors?.find(t => t.homeAway === 'away');
  if (!h?.team?.displayName || !a?.team?.displayName || !Number.isFinite(Date.parse(event.date))) return null;
  return { h, a, c, home: teamName(h.team.displayName), away: teamName(a.team.displayName) };
}
export function espnResults(events: FootballEvent[]): Result[] {
  const games: Result[] = [];
  for (const e of events) {
    const teams = sides(e);
    if (!teams || teams.c.status?.type?.name !== 'STATUS_FULL_TIME' || (teams.c.status.period ?? 2) !== 2) continue;
    const score = (t: Competitor) => typeof t.score === 'string' && /^\d+$/.test(t.score) ? Number(t.score) :
      t.score && typeof t.score === 'object' ? t.score.value : NaN;
    const hg=score(teams.h), ag=score(teams.a);
    if (!Number.isInteger(hg) || hg < 0 || !Number.isInteger(ag) || ag < 0) continue;
    games.push({date: e.date.slice(0,10), availableAt: Date.parse(e.date) + DAY, season: e.date.slice(0,4), stage: 'ESPN regulation',
      home: teams.home, away: teams.away, hg, ag});
  }
  return games;
}

export function extendArchive(base: Result[], events: FootballEvent[]): Result[] {
  const archiveEnd = base.reduce((latest,g) => g.date > latest ? g.date : latest, '');
  const known = new Set<string>();
  return [...base, ...espnResults(events.filter(e => {
    if (known.has(e.id)) return false;
    known.add(e.id);
    // The local calendar date in the archive can precede kickoff UTC by one day.
    return Date.parse(e.date) > Date.parse(archiveEnd) + 2*DAY;
  }))];
}

function fixture(home: string, away: string, kickoff: string, model: Ratings, h: string[]=[], a: string[]=[]) {
  return {home, away, kickoff, aliasesHome: [...new Set([home, ...(names[home] ?? []), ...h])],
    aliasesAway: [...new Set([away, ...(names[away] ?? []), ...a])], ...forecast(model, home, away), ratingVersion:model.version,
    trainedThrough:model.trainedThrough};
}

export async function footballContext(asOf: string, mode: 'live' | 'demo', fetchImpl: typeof fetch = fetch) {
  const at = new Date(asOf);
  if (!Number.isFinite(+at)) throw Error('Invalid fixture cutoff');
  const base = history();
  if (mode === 'demo') {
    const replay = at.toISOString() === DEFAULT_CUTOFF;
    const model: Ratings = replay
      ? JSON.parse(readFileSync(new URL('../data/replay-ratings.json', import.meta.url), 'utf8'))
      : fit(base, asOf);
    const kickoff = replay ? FIXTURE_UTC : new Date(+at + 3*3600_000).toISOString();
    return {source: replay ? 'ESPN fixture 401876905; pre-match fitted ratings from OpenFootball and ESPN' : 'Simulated schedule; OpenFootball historical ratings',
      matches:[fixture('Toluca','Monterrey',kickoff,model)]};
  }
  const year = at.getUTCFullYear();
  const seasons = [year-1,year];
  if (new Date(+at + 7*DAY).getUTCFullYear() > year) seasons.push(year+1);
  const events = (await Promise.all(seasons.map(y => scoreboard(String(y), fetchImpl)))).flat();
  const combined = extendArchive(base,events);
  const model = fit(combined,asOf);
  const unique = new Map(events.map(e=>[e.id,e]));
  const allEvents = [...unique.values()];
  const matches = await Promise.all(allEvents.flatMap(e=>{
    const t = sides(e), kickoff=Date.parse(e.date);
    if (!t || t.c.status?.type?.state!=='pre' || kickoff <= +at || kickoff > +at + 7*DAY) return [];
    const aliases = (c: Competitor) => [c.team.shortDisplayName,c.team.abbreviation].filter((s):s is string=>!!s);
    const match = fixture(t.home,t.away,new Date(kickoff).toISOString(),model,aliases(t.h),aliases(t.a));
    return [matchDetail(t.home,t.away,e,allEvents,combined,model,asOf,fetchImpl).then(detail=>({...match,...detail}))];
  }));
  return {source:'ESPN Liga MX scoreboard and OpenFootball results',matches};
}
