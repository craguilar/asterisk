function unit(value: number, label = 'probability') {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Invalid ' + label);
  return value;
}
export function normalize(values: number[]) {
  const total = values.reduce((a, b) => {
    if (!Number.isFinite(b) || b < 0) throw new RangeError('Invalid outcome weight');
    return a + b;
  }, 0);
  if (!(total > 0 && Number.isFinite(total))) throw new RangeError('Missing outcome weights');
  return values.map(value => value / total);
}
function poisson(lambda: number) {
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 10) throw new RangeError('Invalid expected goals');
  const p = [Math.exp(-lambda)];
  // Always cover 0–10. Extend the tail for high-scoring teams.
  for (let i = 1; i <= 10 || p[i - 1]! > 1e-12; i++) p.push(p[i - 1]! * lambda / i);
  return p;
}
export function scoreGrid(homeRate: number, awayRate: number, rho = 0) {
  const h = poisson(homeRate), a = poisson(awayRate);
  const low = [[1 - homeRate * awayRate * rho, 1 + homeRate * rho], [1 + awayRate * rho, 1 - rho]];
  if (low.flat().some(factor => !Number.isFinite(factor) || factor < 0)) throw new RangeError('Invalid low-score correction');
  const cells = h.map((pv, i) => a.map((qv, j) => pv * qv * (low[i]?.[j] ?? 1)));
  let home = 0, away = 0, draw = 0, btts = 0;
  const over = [0, 0, 0, 0, 0];
  cells.forEach((row, i) => row.forEach((p, j) => {
    if (i > j) home += p;
    else if (i < j) away += p;
    else draw += p;
    if (i && j) btts += p;
    for (let k = 0; k < over.length && k < i + j; k++) over[k] = over[k]! + p;
  }));
  return { home, draw, away, btts, over25: over[2]!, over, levelAt90: draw, cells };
}
export function lateWindow(homeRate: number, awayRate: number, minutes: number, intensity = 1) {
  if (!(minutes > 0 && minutes <= 45 && intensity > 0 && Number.isFinite(intensity))) throw new RangeError('Invalid late window');
  return scoreGrid(homeRate * minutes / 90 * intensity, awayRate * minutes / 90 * intensity).draw;
}
export function capRules(adjustments: number[]) {
  const total = adjustments.reduce((sum, value) => {
    if (!Number.isFinite(value)) throw new RangeError('Invalid rule adjustment');
    return sum + Math.max(-0.4, Math.min(0.4, value));
  }, 0);
  return Math.max(-0.8, Math.min(0.8, total));
}
export function combine(market: number, model: number, weight: number, adjustment: number) {
  function logit(p: number) {
    const interior = Math.max(1e-12, Math.min(1 - 1e-12, unit(p)));
    return Math.log(interior / (1 - interior));
  }
  if (!Number.isFinite(adjustment) || Math.abs(adjustment) > 0.8) throw new RangeError('Unbounded adjustment');
  return 1 / (1 + Math.exp(-(unit(weight) * logit(market) + (1 - weight) * logit(model) + adjustment)));
}
export function edge(p: number, c: number, fee: number) {
  return unit(p) - unit(c) - unit(fee);
}
export function kelly(p: number, cost: number, bankroll: number, multiplier: number) {
  unit(p); unit(cost); unit(multiplier);
  if (!Number.isFinite(bankroll) || bankroll < 0) throw new RangeError('Invalid bankroll');
  return cost === 1 ? 0 : Math.max(0, (p - cost) / (1 - cost)) * multiplier * bankroll;
}
export function metrics(rows: Array<{ p: number; outcome: number; price: number; close: number }>) {
  let brier = 0, logLoss = 0, clv = 0;
  const calibration = Array.from({ length: 10 }, (_, bin) => ({ lower: bin / 10, count: 0, predictedSum: 0, outcomeSum: 0 }));
  for (const { p, outcome, price, close } of rows) {
    unit(p); unit(price); unit(close);
    if (outcome !== 0 && outcome !== 1) throw new RangeError('Outcome must be binary');
    brier += (p - outcome) ** 2;
    logLoss -= Math.log(Math.max(1e-15, outcome ? p : 1 - p));
    clv += close - price;
    const bucket = calibration[Math.min(9, Math.floor(p * 10))]!;
    bucket.count++; bucket.predictedSum += p; bucket.outcomeSum += outcome;
  }
  if (!rows.length) throw new RangeError('No settled observations');
  return { count: rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length, clv: clv / rows.length, calibration };
}
