import { capRules, combine } from './math.js';

export type Result = 'home' | 'draw' | 'away';
type Team = 'home' | 'away';
export type Target = Result | 'btts' | 'homeScores' | 'awayScores' | 'extraTime' | 'context';
export interface TeamFacts {
  bigWinDistorted?: boolean; defensiveCollapse?: boolean; mustWin?: boolean; safe?: boolean;
  scoresRecently?: boolean; transitionLeaky?: boolean; rotationHigh?: boolean; trophyInDays?: number;
  qualified?: boolean; eliminated?: boolean; freshReserves?: boolean; drawSufficient?: boolean;
  organized?: boolean; noScoringMechanism?: boolean; confirmedStarOut?: string; doubtfulStar?: string;
  returningStrikerPoorForm?: boolean; weakOppositionStreak?: boolean; eliteAttack?: boolean;
  deepFreshBench?: boolean; played120?: boolean; surprisingCoach?: boolean; tiredStarters?: boolean;
  altitudeAcclimated?: boolean; frequentDraws?: boolean; lateScorer?: boolean; lowEvent?: boolean;
  breaksLowBlock?: boolean; openPlay?: boolean;
}
export interface RuleFacts {
  home: TeamFacts; away: TeamFacts; source: string; favorite: Team;
  highAltitude?: boolean; deadRubber?: boolean; knockout?: boolean; lateStage?: boolean;
  observations?: string[];
}
export interface RuleFire {
  id: string; tier: number; target: Target; raw: number; applied: number; feature?:number; weight?:number; source: string; explanation: string;
}
const manifest = {
  R01:[1,0], R02:[2,.25], R03:[2,.2], R04:[1,.3], R06:[1,.4], R07:[1,0], R08:[2,.2],
  R09:[2,.3], R10:[1,.3], R11:[1,.35], R12:[2,0], R13:[1,0], R16:[2,.3], R21:[2,0],
  R25:[1,.3], R26:[1,.25], R27:[2,0], R28:[1,.3], R30:[2,.25], R31:[2,.2],
  M19:[1,0], M20:[2,.4], M22:[2,.3], M29:[1,.3], M10:[2,.2],
  R15:[3,0], R23:[3,0], R24a:[3,0], 'R-v9':[3,0], 'R-mkt':[3,0],
} as const;
export const ruleRegistry = Object.entries(manifest).map(([id,[tier,cap]]) => ({id,tier,cap,weight:tier === 1 ? 1 : tier === 2 ? .5 : 0}));
export function evaluateRules(f: RuleFacts, weights: Readonly<Record<string, number>> = {}) {
  const fires: RuleFire[] = [];
  function fire(id: keyof typeof manifest, target: Target, sign: number, explanation: string) {
    const [tier, cap] = manifest[id];
    const weight = weights[id] ?? (tier === 1 ? 1 : tier === 2 ? .5 : 0);
    if (!Number.isFinite(weight)) throw new Error('Invalid rule weight');
    const raw = tier === 3 ? 0 : cap * sign * weight;
    fires.push({ id, tier, target, raw, applied: Math.max(-cap, Math.min(cap, raw)), feature:cap*sign,weight, source:f.source, explanation });
  }
  for (const side of ['home','away'] as const) {
    const other = side === 'home' ? 'away' : 'home', team = f[side], opponent = f[other];
    const goal = side === 'home' ? 'homeScores' : 'awayScores';
    if (team.bigWinDistorted) fire('R01','context',0,side + ' recent blowout had distorted opposition.');
    if (team.defensiveCollapse) fire('R02',other,1,side + ' conceded at least four with discipline problems.');
    if (team.mustWin && opponent.safe) fire('R03',side,1,side + ' needs the result against safe opposition.');
    if (side !== f.favorite && team.scoresRecently && opponent.transitionLeaky) fire('R04','btts',1,side + ' often scores against teams vulnerable in transition.');
    if (side === f.favorite && (team.rotationHigh || team.qualified || (team.trophyInDays !== undefined && team.trophyInDays >= 0 && team.trophyInDays <= 5))) {
      if (team.mustWin) fire('R07','context',0,side + ' still needs the result; rotation discount blocked.');
      else {
        fire('R06',side,-1,side + ' has a documented rotation incentive.');
        fire('R06','draw',1,side + ' rotation raises draw risk.');
      }
    }
    if (team.eliminated && team.freshReserves) fire('R08',goal,1,side + ' has fresh reserves in an eliminated side.');
    if (side !== f.favorite && team.noScoringMechanism) fire('R10',goal,-1,side + ' lacks a documented route to goal.');
    if (team.confirmedStarOut) fire('R11',side,-1,team.confirmedStarOut + ' is confirmed unavailable for ' + side + '.');
    if (team.returningStrikerPoorForm) fire('R12','context',0,side + ' returning striker has poor recent form.');
    if (team.qualified || team.eliminated || team.mustWin) fire('R13','context',0,side + ' has a documented table incentive.');
    if (side !== f.favorite && team.organized && opponent.breaksLowBlock === false) {
      fire('R16','draw',1,side + ' low block faces a team without a documented way through.');
      if (f.knockout) fire('R16','extraTime',1,'Organized low block in a knockout.');
    }
    if (team.weakOppositionStreak && opponent.eliteAttack) fire('R25',other === 'home' ? 'homeScores' : 'awayScores',1,side + ' clean sheets came against weak attacks.');
    if (team.deepFreshBench && opponent.played120) fire('R26',side,1,side + ' has a fresh bench against a team coming off extra time.');
    if (team.surprisingCoach) fire('R27','context',0,side + ' coach makes unexpected changes.');
    if (side === f.favorite && team.transitionLeaky) fire('R28','btts',1,side + ' concedes in transition.');
    if (f.deadRubber && team.freshReserves && opponent.tiredStarters) fire('R30',side,1,side + ' has fresh reserves in a dead rubber.');
  }
  if ((f.home.drawSufficient || f.away.drawSufficient) && f.home.organized && f.away.organized) fire('R09','draw',1,'A draw suits a team and both defenses are organized.');
  if (f.highAltitude && f.away.altitudeAcclimated === false) fire('R31','home',1,'Visitor has no recent exposure to this altitude.');
  if (f.knockout) {
    fire('M19','context',0,'Stoppage time counts toward regulation.');
    if (f.home.frequentDraws && f.away.frequentDraws && f.home.lateScorer === false && f.away.lateScorer === false) fire('M20','extraTime',1,'Both teams frequently draw in regulation and lack a late scorer.');
    if (f.home.lowEvent && f.away.lowEvent) fire('M22','extraTime',1,'Both knockout opponents play low-event football.');
    if (f.home.lateScorer || f.away.lateScorer || f.home.deepFreshBench || f.away.deepFreshBench) fire('M29','extraTime',-1,'Late goals or a deep bench can resolve a knockout.');
    if (f.lateStage) fire('M10','extraTime',1,'Semifinal or final.');
    if (f.home.openPlay === false || f.away.openPlay === false) fire('R21','context',0,'Underdog advancement and regulation wins are distinct markets.');
  }
  for (const rule of ruleRegistry.filter(r => r.tier === 3)) {
    if (f.observations?.includes(rule.id)) fire(rule.id as keyof typeof manifest, 'context',0,'Logged catalog observation.');
  }
  return fires;
}
export function adjustment(fires: RuleFire[], target: Target) {
  const shrink = fires.some(f => f.id === 'R27') ? .5 : 1;
  return capRules(fires.filter(f => f.target === target).map(f => f.applied)) * shrink;
}
export function decidedInRegulation(fires: RuleFire[], base = .77) {
  return 1 - combine(1 - base, 1 - base, 1, adjustment(fires, 'extraTime'));
}
