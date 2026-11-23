import { describe, expect, it } from 'vitest';
import { capRules, combine, edge, kelly, metrics, normalize, scoreGrid } from '../src/math.js';

describe('deterministic prediction arithmetic', () => {
  it('removes overround from three mutually exclusive asks', () => {
    const prices = normalize([0.52, 0.27, 0.26]);
    expect(prices).toHaveLength(3);
    [0.4952, 0.2571, 0.2476].forEach((expected, i) => {
      expect(Math.abs(prices[i]! - expected)).toBeLessThan(0.0001);
    });
    expect(prices.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
  });

  it('derives the specified three-way, BTTS and total probabilities from the score grid', () => {
    const grid = scoreGrid(1.6, 1.0, 0);
    const outcomes = [grid.home, grid.draw, grid.away, grid.btts, grid.over25];
    [0.5134, 0.2500, 0.2366, 0.5045, 0.4816].forEach((expected, i) => {
      expect(Math.abs(outcomes[i]! - expected)).toBeLessThan(0.001);
    });
  });

  it('applies the Dixon-Coles correction only to the low-score cells', () => {
    const independent = scoreGrid(1.6, 1.0, 0);
    const corrected = scoreGrid(1.6, 1.0, -0.1);
    expect(corrected.draw - independent.draw).toBeCloseTo(2 * 0.1 * 1.6 * Math.exp(-2.6), 5);
    expect(corrected.over25).toBeCloseTo(independent.over25, 6);
  });

  it('combines market and model in log odds before applying the rule adjustment', () => {
    expect(Math.abs(combine(0.5, 0.55, 0.7, -0.15) - 0.4776)).toBeLessThan(0.001);
    expect(combine(0.25, 0.88, 1, 0)).toBeCloseTo(0.25, 8);
  });

  it('clips individual adjustments before clipping the signed sum', () => {
    expect(capRules([0.35, 0.35, 0.35])).toBeCloseTo(0.8, 8);
    expect(capRules([-1, -1, -1])).toBeCloseTo(-0.8, 8);
    expect(capRules([0.9, -0.2])).toBeCloseTo(0.2, 8);
    expect(capRules([])).toBe(0);
  });

  it('subtracts fees from the gross edge and sizes favorable paper positions by fractional Kelly', () => {
    expect(edge(0.53, 0.52, 0.02)).toBeCloseTo(-0.01, 8);
    expect(kelly(0.58, 0.52, 1000, 0.25)).toBeCloseTo(31.25, 8);
    expect(kelly(0.40, 0.52, 1000, 0.25)).toBe(0);
  });

  it('scores both realized outcomes and reports signed closing line value', () => {
    const result = metrics([
      { p: 0.8, outcome: 1, price: 0.45, close: 0.5 },
      { p: 0.4, outcome: 0, price: 0.6, close: 0.65 },
    ]);
    expect(result.brier).toBeCloseTo(0.10, 8);
    expect(result.logLoss).toBeCloseTo(-(Math.log(0.8) + Math.log(0.6)) / 2, 8);
    expect(result.clv).toBeCloseTo(0.05, 8);
  });
});
