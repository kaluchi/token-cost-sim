import { describe, it, expect } from 'vitest';
import { simulate } from '../src/core/simulate.js';

const PR = { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 };

describe('simulate()', () => {
  it('returns zero cost and original context for 0 turns', () => {
    const r = simulate({ initialContext: 5000, numTurns: 0, userMsg: 200, toolResult: 1000, modelOutput: 500 }, PR, false);
    expect(r.totalCost).toBe(0);
    expect(r.turnCosts).toHaveLength(0);
    expect(r.finalContext).toBe(5000);
    expect(r.totalInput).toBe(0);
  });

  it('context grows by (userMsg + toolResult + modelOutput) each turn', () => {
    const delta = 200 + 1000 + 500;
    const r = simulate({ initialContext: 0, numTurns: 5, userMsg: 200, toolResult: 1000, modelOutput: 500 }, PR, false);
    expect(r.finalContext).toBe(5 * delta);
    r.ctxSizes.forEach((ctx, i) => expect(ctx).toBe((i + 1) * delta));
  });

  it('cumCosts is non-decreasing', () => {
    const r = simulate({ initialContext: 1000, numTurns: 20, userMsg: 200, toolResult: 1000, modelOutput: 500 }, PR, false);
    for (let i = 1; i < r.cumCosts.length; i++) {
      expect(r.cumCosts[i]).toBeGreaterThan(r.cumCosts[i - 1]);
    }
  });

  it('turn costs grow over time (context gets heavier)', () => {
    const r = simulate({ initialContext: 0, numTurns: 10, userMsg: 200, toolResult: 1000, modelOutput: 500 }, PR, false);
    expect(r.turnCosts[9]).toBeGreaterThan(r.turnCosts[0]);
  });

  it('without cache: doubling N roughly quadruples total cost (quadratic property)', () => {
    const base = { initialContext: 0, numTurns: 10, userMsg: 200, toolResult: 1000, modelOutput: 500 };
    const r10 = simulate({ ...base, numTurns: 10 }, PR, false);
    const r20 = simulate({ ...base, numTurns: 20 }, PR, false);
    const ratio = r20.totalCost / r10.totalCost;
    // Exact ratio depends on initialContext; with 0 initial context it should be ~4
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  });

  it('with cache: cost is strictly less than without cache for N > 1', () => {
    const p = { initialContext: 10_000, numTurns: 15, userMsg: 300, toolResult: 2000, modelOutput: 800 };
    const cached   = simulate(p, PR, true);
    const uncached = simulate(p, PR, false);
    expect(cached.totalCost).toBeLessThan(uncached.totalCost);
  });

  it('first turn cost is identical with and without cache', () => {
    const p = { initialContext: 5000, numTurns: 1, userMsg: 200, toolResult: 1000, modelOutput: 500 };
    const cached   = simulate(p, PR, true);
    const uncached = simulate(p, PR, false);
    expect(cached.totalCost).toBeCloseTo(uncached.totalCost, 10);
  });

  it('larger initial context increases total cost', () => {
    const base = { numTurns: 10, userMsg: 200, toolResult: 1000, modelOutput: 500 };
    const r1 = simulate({ ...base, initialContext: 1_000 },   PR, false);
    const r2 = simulate({ ...base, initialContext: 100_000 }, PR, false);
    expect(r2.totalCost).toBeGreaterThan(r1.totalCost);
  });

  it('totalInput matches sum of individual per-turn input tokens', () => {
    const p = { initialContext: 2000, numTurns: 8, userMsg: 300, toolResult: 1500, modelOutput: 600 };
    const r = simulate(p, PR, false);
    // We know totalInput accumulates (ctx + newIn) each turn
    let ctx = p.initialContext;
    let expected = 0;
    for (let i = 0; i < p.numTurns; i++) {
      expected += ctx + p.userMsg + p.toolResult;
      ctx += p.userMsg + p.toolResult + p.modelOutput;
    }
    expect(r.totalInput).toBe(expected);
  });

  it('big initial context + few iterations can be cheaper than small initial + many iterations', () => {
    const ctx1 = simulate({ initialContext: 2_000,   numTurns: 60, userMsg: 400, toolResult: 2_000, modelOutput: 800  }, PR, true);
    const ctx2 = simulate({ initialContext: 250_000, numTurns: 10, userMsg: 500, toolResult: 12_000, modelOutput: 3_000 }, PR, true);
    // This is the main thesis — Context 2 should be cheaper despite bigger final size
    expect(ctx2.totalCost).toBeLessThan(ctx1.totalCost);
    // And Context 1 processes more input tokens despite smaller final context
    expect(ctx1.totalInput).toBeGreaterThan(ctx2.totalInput);
  });
});
