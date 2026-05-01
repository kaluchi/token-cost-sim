import { describe, it, expect } from 'vitest';
import {
  simulate,
  sweepBreakeven,
  sweepGranularity,
  sweepFixedContext,
  sweepROI,
  findCrossover,
} from '../src/core/simulate.js';

const PR = { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 };

const P1 = { initialContext: 2_000,   numTurns: 60, userMsg: 400, toolResult: 2_000,  modelOutput: 800  };
const P2 = { initialContext: 250_000, numTurns: 10, userMsg: 500, toolResult: 12_000, modelOutput: 3_000 };

describe('sweepBreakeven()', () => {
  it('returns array of length maxN', () => {
    const sweep = sweepBreakeven(P2, PR, true, 20);
    expect(sweep).toHaveLength(20);
  });

  it('n values are 1..maxN', () => {
    const sweep = sweepBreakeven(P2, PR, true, 10);
    sweep.forEach((s, i) => expect(s.n).toBe(i + 1));
  });

  it('costs increase monotonically with N (more turns = more cost)', () => {
    const sweep = sweepBreakeven(P2, PR, true, 20);
    for (let i = 1; i < sweep.length; i++) {
      expect(sweep[i].totalCost).toBeGreaterThan(sweep[i - 1].totalCost);
    }
  });

  it('final context increases monotonically with N', () => {
    const sweep = sweepBreakeven(P2, PR, true, 15);
    for (let i = 1; i < sweep.length; i++) {
      expect(sweep[i].finalContext).toBeGreaterThan(sweep[i - 1].finalContext);
    }
  });
});

describe('findCrossover()', () => {
  it('returns null when no entry is below target', () => {
    const sweep = sweepBreakeven(P2, PR, true, 5);
    expect(findCrossover(sweep, 0)).toBeNull();
  });

  it('returns 1 when first entry is already below target', () => {
    const sweep = sweepBreakeven(P2, PR, true, 5);
    const bigTarget = 1_000_000;
    expect(findCrossover(sweep, bigTarget)).toBe(1);
  });

  it('crossover point N satisfies cost[N] <= target < cost[N-1]', () => {
    const r1cost = simulate(P1, PR, true).totalCost;
    const sweep  = sweepBreakeven(P2, PR, true, 30);
    const crossN = findCrossover(sweep, r1cost);
    if (crossN !== null) {
      const hitEntry = sweep.find(s => s.n === crossN);
      expect(hitEntry.totalCost).toBeLessThanOrEqual(r1cost);
      if (crossN > 1) {
        const prevEntry = sweep.find(s => s.n === crossN - 1);
        expect(prevEntry.totalCost).toBeGreaterThan(r1cost);
      }
    }
  });
});

describe('sweepGranularity()', () => {
  it('returns array matching toolSizes length', () => {
    const sizes = [500, 1000, 5000, 10000];
    const result = sweepGranularity(P1, PR, true, sizes);
    expect(result).toHaveLength(sizes.length);
  });

  it('larger tool results → higher cost at same number of turns', () => {
    const sizes = [500, 2000, 10000];
    const result = sweepGranularity(P1, PR, true, sizes);
    expect(result[0].totalCost).toBeLessThan(result[1].totalCost);
    expect(result[1].totalCost).toBeLessThan(result[2].totalCost);
  });

  it('each entry carries the toolSize that was used', () => {
    const sizes = [100, 999, 42000];
    const result = sweepGranularity(P1, PR, false, sizes);
    result.forEach((r, i) => expect(r.toolSize).toBe(sizes[i]));
  });
});

describe('sweepFixedContext()', () => {
  it('all entries have approximately the same finalContext', () => {
    const nRange = [5, 10, 20, 40, 60];
    const results = sweepFixedContext(P1, PR, true, nRange);
    const ref = results[0].finalContext;
    results.forEach(r => {
      // Allow small rounding difference from integer division
      expect(Math.abs(r.finalContext - ref) / ref).toBeLessThan(0.05);
    });
  });

  it('cost decreases as N decreases (fewer iterations = cheaper at same context)', () => {
    const nRange = [60, 30, 10, 5];
    const results = sweepFixedContext(P1, PR, true, nRange);
    // N=5 should be cheaper than N=60
    const costAt5  = results.find(r => r.n === 5).totalCost;
    const costAt60 = results.find(r => r.n === 60).totalCost;
    expect(costAt5).toBeLessThan(costAt60);
  });
});

describe('sweepROI()', () => {
  it('returns array matching initCtxRange length', () => {
    const range = [50_000, 100_000, 200_000];
    const result = sweepROI(P1, P2, PR, true, range);
    expect(result).toHaveLength(3);
  });

  it('each entry carries the initCtx that was used', () => {
    const range = [10_000, 200_000];
    const result = sweepROI(P1, P2, PR, true, range);
    expect(result[0].initCtx).toBe(10_000);
    expect(result[1].initCtx).toBe(200_000);
  });

  it('larger initial Ctx2 context → higher breakevenN1 (need more Ctx1 iterations to justify investment)', () => {
    const range = [30_000, 150_000, 400_000];
    const result = sweepROI(P1, P2, PR, true, range, 200);
    // Bigger initCtx → more expensive Ctx2 → Ctx1 needs more iterations before Ctx2 wins
    const n1_small = result[0].breakevenN1 ?? 201;
    const n1_large = result[2].breakevenN1 ?? 201;
    expect(n1_large).toBeGreaterThanOrEqual(n1_small);
  });

  it('breakevenN1 is null when Ctx2 is always more expensive than Ctx1 in 1..maxN range', () => {
    // A huge initial context that makes Ctx2 always more expensive than 1-turn Ctx1
    const hugeCtx = [5_000_000];
    const result = sweepROI(P1, P2, PR, true, hugeCtx, 5);
    expect(result[0].breakevenN1).toBeNull();
  });

  it('ctx2Cost increases with larger initial context', () => {
    const range = [10_000, 100_000, 500_000];
    const result = sweepROI(P1, P2, PR, true, range, 10);
    expect(result[0].ctx2Cost).toBeLessThan(result[1].ctx2Cost);
    expect(result[1].ctx2Cost).toBeLessThan(result[2].ctx2Cost);
  });
});
