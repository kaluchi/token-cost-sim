/**
 * Core simulation engine — shared between CLI and browser.
 *
 * Key insight: each API call costs (all previous context + new tokens) × price.
 * With N turns and δ tokens/turn this is ≈ δ·N²/2 — quadratic in iterations.
 * Prompt Caching reduces the repeated-context cost to ~10% → quadratic slope shrinks 10×.
 */

/**
 * @typedef {{
 *   initialContext: number,
 *   numTurns:       number,
 *   userMsg:        number,
 *   toolResult:     number,
 *   modelOutput:    number,
 * }} SimParams
 *
 * @typedef {{
 *   input:      number,
 *   output:     number,
 *   cacheRead:  number,
 *   cacheWrite: number,
 * }} Pricing
 *
 * @typedef {{
 *   turnCosts:    number[],
 *   cumCosts:     number[],
 *   ctxSizes:     number[],
 *   totalCost:    number,
 *   finalContext: number,
 *   totalInput:   number,
 *   totalOutput:  number,
 * }} SimResult
 */

/**
 * Run a single conversation simulation.
 * @param {SimParams} params
 * @param {Pricing}   pricing
 * @param {boolean}   useCache  — whether prompt caching is active
 * @returns {SimResult}
 */
export function simulate(params, pricing, useCache) {
  const { initialContext, numTurns, userMsg, toolResult, modelOutput } = params;
  let ctx = initialContext;

  const turnCosts = [];
  const cumCosts  = [];
  const ctxSizes  = [];
  let cumCost    = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (let i = 0; i < numTurns; i++) {
    const newIn   = userMsg + toolResult;       // tokens the user/tools add this turn
    const fullIn  = ctx + newIn;                // total input tokens for this API call
    totalInput  += fullIn;
    totalOutput += modelOutput;

    const inputCost = !useCache
      ? (fullIn * pricing.input) / 1e6
      : i === 0
        ? (ctx * pricing.cacheWrite + newIn * pricing.input) / 1e6
        : (ctx * pricing.cacheRead  + newIn * pricing.input) / 1e6;

    const outCost = (modelOutput * pricing.output) / 1e6;
    const turnCost = inputCost + outCost;

    cumCost += turnCost;
    turnCosts.push(turnCost);
    cumCosts.push(cumCost);
    ctx += newIn + modelOutput;
    ctxSizes.push(ctx);
  }

  return { turnCosts, cumCosts, ctxSizes, totalCost: cumCost,
           finalContext: ctx, totalInput, totalOutput };
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics sweeps (used by both CLI reports and browser charts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find how Ctx2 cost changes as we vary its number of turns (break-even analysis).
 * Returns [{n, totalCost, finalContext}] for n = 1..maxN.
 * @param {SimParams} p2Base
 * @param {Pricing}   pricing
 * @param {boolean}   useCache
 * @param {number}    maxN
 * @returns {{ n: number, totalCost: number, finalContext: number }[]}
 */
export function sweepBreakeven(p2Base, pricing, useCache, maxN = 60) {
  return Array.from({ length: maxN }, (_, i) => {
    const n = i + 1;
    const r = simulate({ ...p2Base, numTurns: n }, pricing, useCache);
    return { n, totalCost: r.totalCost, finalContext: r.finalContext };
  });
}

/**
 * Vary tool result size for Ctx1 at fixed iteration count.
 * @param {SimParams}  p1Base
 * @param {Pricing}    pricing
 * @param {boolean}    useCache
 * @param {number[]}   toolSizes  — array of tool result sizes to test
 * @returns {{ toolSize: number, totalCost: number, totalInput: number }[]}
 */
export function sweepGranularity(p1Base, pricing, useCache, toolSizes) {
  return toolSizes.map(ts => {
    const r = simulate({ ...p1Base, toolResult: ts }, pricing, useCache);
    return { toolSize: ts, totalCost: r.totalCost, totalInput: r.totalInput };
  });
}

/**
 * Fix the final context of Ctx1 and vary N (iteration count), adjusting toolResult
 * proportionally so the final context stays the same. Demonstrates pure quadratic effect.
 * @param {SimParams}  p1Base   — the "reference" params (numTurns and toolResult are overridden)
 * @param {Pricing}    pricing
 * @param {boolean}    useCache
 * @param {number[]}   nRange   — iteration counts to test
 * @returns {{ n: number, toolResult: number, totalCost: number }[]}
 */
export function sweepFixedContext(p1Base, pricing, useCache, nRange) {
  const refResult = simulate(p1Base, pricing, useCache);
  const fixedFinalCtx = refResult.finalContext;
  const totalDelta = fixedFinalCtx - p1Base.initialContext; // total tokens added across all turns

  return nRange.map(n => {
    const deltaPer = Math.max(1, Math.round(totalDelta / n));
    const tr = Math.max(1, deltaPer - p1Base.userMsg - p1Base.modelOutput);
    const r  = simulate({ ...p1Base, numTurns: n, toolResult: tr }, pricing, useCache);
    return { n, toolResult: tr, totalCost: r.totalCost, finalContext: r.finalContext };
  });
}

/**
 * Vary initial context of Ctx2 and find the break-even N1 —
 * the MINIMUM iterations in Ctx1 from which Ctx2 becomes cheaper.
 * Below this N1 → Ctx1 wins. Above this N1 → Ctx2 wins.
 * Models the ROI of investing in documentation/onboarding prompts.
 * @param {SimParams}  p1Base
 * @param {SimParams}  p2Base
 * @param {Pricing}    pricing
 * @param {boolean}    useCache
 * @param {number[]}   initCtxRange  — initial context values to test for Ctx2
 * @param {number}     maxN          — upper search bound
 * @returns {{ initCtx: number, breakevenN1: number | null, ctx2Cost: number }[]}
 */
export function sweepROI(p1Base, p2Base, pricing, useCache, initCtxRange, maxN = 200) {
  return initCtxRange.map(initCtx => {
    const ctx2Cost = simulate({ ...p2Base, initialContext: initCtx }, pricing, useCache).totalCost;
    // Walk N1 upward: find first N1 where ctx1 becomes more expensive than ctx2.
    // That N1 is the minimum "мышиная возня" needed for Ctx2 to be worth the investment.
    let breakevenN1 = null;
    for (let n1 = 1; n1 <= maxN; n1++) {
      const ctx1Cost = simulate({ ...p1Base, numTurns: n1 }, pricing, useCache).totalCost;
      if (ctx1Cost > ctx2Cost) { breakevenN1 = n1; break; }
    }
    return { initCtx, breakevenN1, ctx2Cost };
  });
}

/**
 * Find the first N (in sweepBreakeven output) where Ctx2 cost falls below targetCost.
 * @param {{ n: number, totalCost: number }[]} sweep
 * @param {number} targetCost
 * @returns {number | null}
 */
export function findCrossover(sweep, targetCost) {
  const hit = sweep.find(s => s.totalCost <= targetCost);
  return hit ? hit.n : null;
}
