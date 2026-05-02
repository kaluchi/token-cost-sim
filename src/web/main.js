import {
  simulate,
  sweepBreakeven,
  sweepGranularity,
  sweepFixedContext,
  sweepROI,
  findCrossover,
} from '../core/simulate.js';
import { fmtN, fmtMT, fmtCost } from '../core/format.js';
import { injectNav } from './nav.js';
import {
  sv, setModel as _setModel, pricing, createStorage,
  mkChart, mkDS, chartOpts, pad,
  GRID, TICK, LEGEND,
} from './shared.js';
import './style.css';

injectNav('sim');

const DEFAULTS = {
  c1t: 60, c1s: 2000, c1u: 400, c1r: 2000, c1o: 800,
  c2t: 10, c2i: 250000, c2u: 500, c2r: 12000, c2o: 3000,
  p_in: 3, p_out: 15, p_cr: 0.30, p_cw: 3.75,
  useCache: true, showQuad: true,
};

const SLIDERS = ['c1t', 'c1s', 'c1u', 'c1r', 'c1o', 'c2t', 'c2i', 'c2u', 'c2r', 'c2o'];
const store = createStorage('tcs_v1', DEFAULTS);

window.sv = sv;
window.setModel = (key, btn) => _setModel(key, btn, update);
window.resetToDefaults = () => store.reset(SLIDERS, update);

function p1() {
  return {
    initialContext: +document.getElementById('c1s').value,
    numTurns:       +document.getElementById('c1t').value,
    userMsg:        +document.getElementById('c1u').value,
    toolResult:     +document.getElementById('c1r').value,
    modelOutput:    +document.getElementById('c1o').value,
  };
}

function p2() {
  return {
    initialContext: +document.getElementById('c2i').value,
    numTurns:       +document.getElementById('c2t').value,
    userMsg:        +document.getElementById('c2u').value,
    toolResult:     +document.getElementById('c2r').value,
    modelOutput:    +document.getElementById('c2o').value,
  };
}

function update() {
  const pr       = pricing();
  const useCache = document.getElementById('useCache').checked;
  const showQ    = document.getElementById('showQuad').checked;
  const pp1 = p1(), pp2 = p2();

  const r1   = simulate(pp1, pr, useCache);
  const r2   = simulate(pp2, pr, useCache);
  const r1nc = showQ && useCache ? simulate(pp1, pr, false) : null;
  const r2nc = showQ && useCache ? simulate(pp2, pr, false) : null;

  document.getElementById('s_c1fc').textContent   = fmtN(r1.finalContext);
  document.getElementById('s_c1ti').textContent   = fmtMT(r1.totalInput);
  document.getElementById('s_c1cost').textContent = fmtCost(r1.totalCost).slice(1);
  document.getElementById('s_c2fc').textContent   = fmtN(r2.finalContext);
  document.getElementById('s_c2ti').textContent   = fmtMT(r2.totalInput);
  document.getElementById('s_c2cost').textContent = fmtCost(r2.totalCost).slice(1);

  document.getElementById('bc1').textContent  = fmtCost(r1.totalCost);
  document.getElementById('bc1d').textContent = `${fmtMT(r1.totalInput)} MTok · ${pp1.numTurns} итер.`;
  document.getElementById('bc2').textContent  = fmtCost(r2.totalCost);
  document.getElementById('bc2d').textContent = `${fmtMT(r2.totalInput)} MTok · ${pp2.numTurns} итер.`;

  const diff     = r1.totalCost - r2.totalCost;
  const absDiff  = Math.abs(diff);
  const pct      = (absDiff / Math.max(r1.totalCost, r2.totalCost) * 100).toFixed(1);
  const cheaper  = diff > 0 ? 2 : 1;
  const inputRat = (r1.totalInput / r2.totalInput).toFixed(2);
  const ctxRat   = (r2.finalContext / r1.finalContext).toFixed(2);

  document.getElementById('vsdiff').textContent = fmtCost(absDiff);
  document.getElementById('vsdiff').style.color = cheaper === 2 ? 'var(--c2)' : 'var(--c1)';
  document.getElementById('vspct').textContent  = pct + '% разница';
  document.getElementById('vsctx').textContent  = `${fmtN(r1.finalContext)} vs ${fmtN(r2.finalContext)}`;
  document.getElementById('vsctxd').textContent = 'финальный контекст';
  document.getElementById('vsratio').textContent= `Ctx1/Ctx2 input обработано: ${inputRat}×`;

  const [b1, b2] = [document.getElementById('badge1'), document.getElementById('badge2')];
  if (cheaper === 2) {
    b1.textContent = '✗ Дороже';  b1.className = 'badge badge-lose';
    b2.textContent = '✓ Дешевле'; b2.className = 'badge badge-win';
  } else {
    b1.textContent = '✓ Дешевле'; b1.className = 'badge badge-win';
    b2.textContent = '✗ Дороже';  b2.className = 'badge badge-lose';
  }

  const ib = document.getElementById('infoBox');
  if (cheaper === 2) {
    ib.className = 'info-box info-ok';
    ib.innerHTML = `✓ <strong>Ctx2 выгоднее</strong> на ${pct}% — несмотря на то, что финальный контекст в ${ctxRat}× больше. Ctx1 обработал в ${inputRat}× больше input-токенов из-за квадратичного роста (${pp1.numTurns} итераций × нарастающий контекст).`;
  } else {
    ib.className = 'info-box info-warn';
    ib.innerHTML = `✗ <strong>Ctx1 выгоднее</strong> с текущими настройками. Начальный контекст Ctx2 (${fmtN(pp2.initialContext)}) слишком велик для ${pp2.numTurns} итераций. Увеличь N1 или уменьши начальный контекст Ctx2.`;
  }

  document.getElementById('m1ti').textContent   = fmtMT(r1.totalInput);
  document.getElementById('m2ti').textContent   = fmtMT(r2.totalInput);
  document.getElementById('mratio').textContent = inputRat + '×';
  document.getElementById('mratio').style.color = r1.totalInput > r2.totalInput ? 'var(--red)' : 'var(--green)';
  document.getElementById('m1pti').textContent  = fmtCost(r1.totalCost / pp1.numTurns);
  document.getElementById('m2pti').textContent  = fmtCost(r2.totalCost / pp2.numTurns);

  const maxT  = Math.max(pp1.numTurns, pp2.numTurns);
  const lbs   = Array.from({ length: maxT }, (_, i) => i + 1);
  const noP   = n => n > 40 ? 0 : 3;

  const ds1 = [mkDS('Ctx1 (кэш)', pad(r1.cumCosts, maxT), 'rgb(129,140,248)', [], true, noP(maxT))];
  const ds2 = [mkDS('Ctx2 (кэш)', pad(r2.cumCosts, maxT), 'rgb(245,158,11)',  [], true, noP(maxT))];
  if (r1nc) ds1.push(mkDS('Ctx1 (без кэша)', pad(r1nc.cumCosts, maxT), 'rgb(129,140,248)', [5, 4], false, 0));
  if (r2nc) ds2.push(mkDS('Ctx2 (без кэша)', pad(r2nc.cumCosts, maxT), 'rgb(245,158,11)',  [5, 4], false, 0));
  mkChart('chCum', { type: 'line', data: { labels: lbs, datasets: [...ds1, ...ds2] },
    options: chartOpts(v => '$' + v.toFixed(3)) });

  mkChart('chTurn', {
    type: 'line',
    data: { labels: lbs, datasets: [
      mkDS('Ctx1 вызов/cost', pad(r1.turnCosts, maxT), 'rgb(129,140,248)', [], false, noP(maxT)),
      mkDS('Ctx2 вызов/cost', pad(r2.turnCosts, maxT), 'rgb(245,158,11)',  [], false, noP(maxT)),
    ]},
    options: chartOpts(v => '$' + v.toFixed(4)),
  });

  const beData  = sweepBreakeven(pp2, pr, useCache, 60);
  const crossN  = findCrossover(beData, r1.totalCost);
  const beLabels = beData.map(d => d.n);
  const beCosts  = beData.map(d => d.totalCost);
  mkChart('chBreak', {
    type: 'line',
    data: { labels: beLabels, datasets: [
      mkDS('Ctx2 при N₂ итерациях', beCosts, 'rgb(245,158,11)', [], true, 0),
      mkDS(`Ctx1 = ${fmtCost(r1.totalCost)} (фикс.)`, Array(60).fill(r1.totalCost), 'rgb(129,140,248)', [6, 4], false, 0),
    ]},
    options: chartOpts(v => '$' + v.toFixed(4), 'N'),
  });

  const toolSizes = Array.from({ length: 60 }, (_, i) => (i + 1) * 500);
  const granData  = sweepGranularity(pp1, pr, useCache, toolSizes);
  mkChart('chSens', {
    type: 'line',
    data: { labels: toolSizes.map(s => fmtN(s)), datasets: [
      mkDS('Ctx1 (tool_result варьируется)', granData.map(d => d.totalCost), 'rgb(129,140,248)', [], true, 0),
      mkDS(`Ctx2 = ${fmtCost(r2.totalCost)} (фикс.)`, Array(60).fill(r2.totalCost), 'rgb(245,158,11)', [6, 4], false, 0),
    ]},
    options: chartOpts(v => '$' + v.toFixed(3), 'Tool results / вызов (tokens)'),
  });

  const nRange  = Array.from({ length: 80 }, (_, i) => i + 2);
  const fixData = sweepFixedContext(pp1, pr, useCache, nRange);
  const fixNC   = showQ ? sweepFixedContext(pp1, pr, false, nRange) : null;
  const fixDS   = [mkDS(`Ctx1 фин.ctx=${fmtN(r1.finalContext)} зафикс. (кэш)`, fixData.map(d => d.totalCost), 'rgb(129,140,248)', [], true, 0)];
  if (fixNC) fixDS.push(mkDS('без кэша', fixNC.map(d => d.totalCost), 'rgb(129,140,248)', [5, 4], false, 0));
  fixDS.push(mkDS(`Ctx2 = ${fmtCost(r2.totalCost)} (фикс.)`, Array(nRange.length).fill(r2.totalCost), 'rgb(245,158,11)', [6, 4], false, 0));
  mkChart('chFixed', {
    type: 'line', data: { labels: nRange, datasets: fixDS },
    options: chartOpts(v => '$' + v.toFixed(3), 'N'),
  });

  const initCtxRange = Array.from({ length: 50 }, (_, i) => (i + 1) * 10_000);
  const roiData      = sweepROI(pp1, pp2, pr, useCache, initCtxRange, 200);
  const roiY = roiData.map(d => d.breakevenN1 ?? 0);
  mkChart('chROI', {
    type: 'line',
    data: { labels: initCtxRange.map(v => fmtN(v)), datasets: [
      mkDS('Break-even N₁: минимум итераций Ctx1 для выгоды Ctx2', roiY, 'rgb(52,211,153)', [], true, 0),
    ]},
    options: chartOpts(v => v + '', 'Начальный контекст Ctx2 — инвестиция в доки/промт (tokens)'),
  });

  const cacheWord = useCache ? 'включён' : 'выключен';
  const el = document.getElementById('dynConclusion');
  if (cheaper === 2) {
    el.innerHTML = `Кэш <strong>${cacheWord}</strong>. <span style="color:var(--c2)">Ctx2 дешевле</span> на <strong>${pct}%</strong>.<br>
    Ctx1 обработал <strong>${inputRat}×</strong> больше input-токенов (${fmtMT(r1.totalInput)} vs ${fmtMT(r2.totalInput)} MTok) при ${pp1.numTurns} итерациях.
    Ctx2 имеет финальный контекст в <strong>${ctxRat}×</strong> больше, но всего ${pp2.numTurns} итераций — суммарная площадь под кривой меньше.
    ${crossN ? `Break-even: при N₂ ≥ <strong>${crossN}</strong> Ctx2 дороже Ctx1.` : ''}
    ${useCache ? '' : '<br><em>Включи Prompt Caching — преимущество Ctx2 усилится ещё сильнее.</em>'}`;
  } else {
    el.innerHTML = `Кэш <strong>${cacheWord}</strong>. <span style="color:var(--c1)">Ctx1 дешевле</span> на <strong>${pct}%</strong>.<br>
    Начальный контекст Ctx2 (${fmtN(pp2.initialContext)}) слишком велик для ${pp2.numTurns} итераций.
    Увеличь итерации Ctx1 ползунком или уменьши начальный контекст Ctx2.
    ${!useCache ? '<br><em>Включи Prompt Caching — это сильно снизит стоимость большого начального контекста Ctx2.</em>' : ''}`;
  }
  store.save();
}
window.update = update;

window.addEventListener('load', () => {
  store.load();
  SLIDERS.forEach(sv);
  update();
});
