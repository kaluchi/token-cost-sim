#!/usr/bin/env node
/**
 * Token Cost Simulator — CLI
 * Usage: node simulate.js [--no-cache] [--model sonnet|opus|haiku]
 */
import { simulate, sweepBreakeven, sweepGranularity, findCrossover } from './src/core/simulate.js';
import { MODELS } from './src/core/models.js';
import { fmtN, fmtMT, fmtCost } from './src/core/format.js';

// ─── Scenarios ────────────────────────────────────────────────────
const SCENARIOS = {
  ctx1: {
    label:          'Ctx1 — «мышиная возня» (много мелких итераций)',
    initialContext: 2_000,
    numTurns:       60,
    userMsg:        400,
    toolResult:     2_000,
    modelOutput:    800,
  },
  ctx2: {
    label:          'Ctx2 — «специализированный» (документация + онбординг, мало итераций)',
    initialContext: 250_000,
    numTurns:       10,
    userMsg:        500,
    toolResult:     12_000,
    modelOutput:    3_000,
  },
};

// ─── CLI parsing ──────────────────────────────────────────────────
const args     = process.argv.slice(2);
const modelKey = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'sonnet';
const useCache = !args.includes('--no-cache');
const pricing  = MODELS[modelKey] ?? MODELS.sonnet;

// ─── Formatting helpers ───────────────────────────────────────────
const col = (s, w) => String(s).padEnd(w);
const line = c => c.repeat(72);

function printHeader(title) {
  console.log('\n' + line('─'));
  console.log(' ' + title);
  console.log(line('─'));
}

function printTurns(rows, limit = 5) {
  console.log(`\n  ${col('Тур',4)} ${col('Input ctx',11)} ${col('InputCost',12)} ${col('OutCost',11)} ${col('TurnCost',11)} Кумулятив`);
  console.log('  ' + line('─').slice(0, 66));
  const show = r =>
    console.log(`  ${col(r.turn,4)} ${col(fmtN(r.inputCtx),11)} ${col(fmtCost(r.inputCost),12)} ${col(fmtCost(r.outCost),11)} ${col(fmtCost(r.turnCost),11)} ${fmtCost(r.cumCost)}`);

  for (let i = 0; i < Math.min(limit, rows.length); i++) show(rows[i]);
  if (rows.length > limit * 2) console.log('  …');
  for (let i = Math.max(limit, rows.length - limit); i < rows.length; i++) show(rows[i]);
}

function toRows(rsim, params) {
  const outPerTurn = (params.modelOutput * pricing.output) / 1e6;
  let cumCost = 0;
  return rsim.turnCosts.map((tc, i) => {
    cumCost += tc;
    return {
      turn:      i + 1,
      inputCtx:  i === 0 ? params.initialContext : rsim.ctxSizes[i - 1],
      inputCost: tc - outPerTurn,
      outCost:   outPerTurn,
      turnCost:  tc,
      cumCost,
    };
  });
}

function printSummary(label, r) {
  console.log(`\n  ${label}`);
  console.log(`  Финальный контекст  : ${fmtN(r.finalContext)} tokens`);
  console.log(`  Итого input обраб.  : ${fmtMT(r.totalInput)} MTok  ← это и есть "площадь параболы"`);
  console.log(`  Итого output        : ${fmtMT(r.totalOutput)} MTok`);
  console.log(`  ══ ИТОГО            : ${fmtCost(r.totalCost)}`);
}

// ─── Main ─────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  LLM Token Cost Simulator — CLI                                     ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log(`\n  Модель  : ${pricing.name}`);
console.log(`  Кэш     : ${useCache ? `включён (cache_read=${pricing.cacheRead}$/MTok)` : 'выключен'}`);
console.log(`  Input   : ${pricing.input}$/MTok  Output: ${pricing.output}$/MTok`);

const r1 = simulate(SCENARIOS.ctx1, pricing, useCache);
const r2 = simulate(SCENARIOS.ctx2, pricing, useCache);

printHeader('Ctx1 — первые и последние туры');
printTurns(toRows(r1, SCENARIOS.ctx1));

printHeader('Ctx2 — первые и последние туры');
printTurns(toRows(r2, SCENARIOS.ctx2));

printHeader('Сводное сравнение');
printSummary(SCENARIOS.ctx1.label, r1);
printSummary(SCENARIOS.ctx2.label, r2);

const cheaper  = r1.totalCost < r2.totalCost ? 'Ctx1' : 'Ctx2';
const savings  = Math.abs(r1.totalCost - r2.totalCost);
const savPct   = (savings / Math.max(r1.totalCost, r2.totalCost) * 100).toFixed(1);
const inputRat = (r1.totalInput / r2.totalInput).toFixed(2);
console.log(`\n  ══ Победитель: ${cheaper}  |  Экономия: ${fmtCost(savings)}  (${savPct}%)`);
console.log(`  ══ Ctx1 обработал в ${inputRat}× больше input-токенов, чем Ctx2`);

// Break-even
printHeader('Break-even: при каком N2 Ctx2 ≤ стоимости Ctx1?');
const beData = sweepBreakeven(SCENARIOS.ctx2, pricing, useCache, 60);
const crossN = findCrossover(beData, r1.totalCost);
const preview = [1,2,3,5,8,10,15,20,30,40,50,60];
console.log(`\n  ${col('N2',5)} ${col('Стоимость Ctx2',18)} ${col('Финальный ctx',16)} Vs Ctx1`);
console.log('  ' + line('─').slice(0, 50));
for (const { n, totalCost, finalContext } of beData.filter(d => preview.includes(d.n))) {
  const flag = totalCost <= r1.totalCost ? ' ← ✓ дешевле Ctx1' : '';
  console.log(`  ${col(n,5)} ${col(fmtCost(totalCost),18)} ${col(fmtN(finalContext),16)}${flag}`);
}
console.log(crossN
  ? `\n  ✓ Ctx2 дешевле Ctx1 начиная с N2 = ${crossN} итераций`
  : '\n  ✗ Ctx2 не дешевле Ctx1 в диапазоне 1..60 итераций');

// Granularity sweep
printHeader('Гранулярность tool results: при каком размере Ctx1 становится выгоднее Ctx2?');
const toolSizes = [100, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 30000];
const granData  = sweepGranularity(SCENARIOS.ctx1, pricing, useCache, toolSizes);
console.log(`\n  Стоимость Ctx2 (фикс.) = ${fmtCost(r2.totalCost)}\n`);
console.log(`  ${col('tool_result/тур',18)} ${col('Cost Ctx1',14)} Разница с Ctx2`);
console.log('  ' + line('─').slice(0, 50));
for (const { toolSize, totalCost } of granData) {
  const diff = totalCost - r2.totalCost;
  const flag = diff < 0 ? ' ← Ctx1 дешевле!' : '';
  console.log(`  ${col(fmtN(toolSize),18)} ${col(fmtCost(totalCost),14)} ${diff >= 0 ? '+' : ''}${fmtCost(diff)}${flag}`);
}

console.log('\n  Запуск без кэша : node simulate.js --no-cache');
console.log('  Другая модель   : node simulate.js --model opus\n');
