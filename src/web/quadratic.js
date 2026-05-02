import { MODELS } from '../core/models.js';
import { simulate } from '../core/simulate.js';
import { fmtN, fmtCost } from '../core/format.js';
import { injectNav } from './nav.js';
import { sv, createStorage, mkChart, chartOpts, LEGEND } from './shared.js';
import './style.css';

injectNav('quad');

const DEFAULTS = { S: 20000, delta: 3500, N: 50, costCache: true };
const SLIDERS = ['S', 'delta', 'N'];
const store = createStorage('quad_settings', DEFAULTS);

window.sv = sv;
window.resetToDefaults = () => store.reset(SLIDERS, update);

function computeSum(S, delta, N) {
  let sum = 0;
  const perTurn = [];
  const cumulative = [];
  for (let k = 0; k < N; k++) {
    const inp = S + k * delta;
    sum += inp;
    perTurn.push(inp);
    cumulative.push(sum);
  }
  return { perTurn, cumulative, total: sum };
}

function update() {
  store.save();
  const S     = +document.getElementById('S').value;
  const delta = +document.getElementById('delta').value;
  const N     = +document.getElementById('N').value;

  const sim = computeSum(S, delta, N);
  const labels = Array.from({ length: N }, (_, i) => i + 1);

  const pr = MODELS.sonnet;
  const useCache = document.getElementById('costCache').checked;
  const ratio = pr.cacheRead / pr.input;

  // Use core simulate() for session cost (modelOutput=0, userMsg=0, toolResult=delta)
  const coreSim = simulate(
    { initialContext: S, numTurns: N, userMsg: 0, toolResult: delta, modelOutput: 0 },
    pr, useCache
  );
  const sesCost = coreSim.totalCost;
  const noCacheSim = simulate(
    { initialContext: S, numTurns: N, userMsg: 0, toolResult: delta, modelOutput: 0 },
    pr, false
  );
  const noCacheCost = noCacheSim.totalCost;

  const finalCtx    = N > 0 ? S + (N - 1) * delta : S;
  const cachedInput = sim.total - finalCtx;
  const cachedPct   = sim.total > 0 ? (cachedInput / sim.total * 100) : 0;
  const $ = id => document.getElementById(id);

  $('m_ctx').textContent      = fmtN(finalCtx);
  $('m_total').textContent    = fmtN(sim.total);
  $('m_cached_pct').textContent = cachedPct.toFixed(1) + '%';
  $('m_cost').textContent     = fmtCost(sesCost);

  // Staircase bar chart
  const sysData  = Array(N).fill(S);
  const dataData = sim.perTurn.map((v) => v - S);
  mkChart('chStairs', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: `S (начальный контекст ${fmtN(S)})`,
          data: sysData,
          backgroundColor: 'rgba(129,140,248,0.35)',
          borderColor: 'rgba(129,140,248,0.6)',
          borderWidth: 1,
        },
        {
          label: `Накопленные данные (+δ за вызов)`,
          data: dataData,
          backgroundColor: 'rgba(245,158,11,0.35)',
          borderColor: 'rgba(245,158,11,0.6)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      ...chartOpts(v => fmtN(v), 'N', { xStacked: true, yStacked: true }),
      plugins: {
        legend: LEGEND,
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              return `Всего: ${fmtN(sim.perTurn[idx])} tokens`;
            },
          },
        },
      },
    },
  });

  // Cost staircase — use per-turn costs from core simulate
  $('ratioLabel').textContent = ratio.toFixed(2);

  const costSys = [], costData = [], ghost = [];
  const sysBg = [], dataBg = [];
  for (let k = 0; k < N; k++) {
    const isFirst = k === 0;
    const r = !useCache ? 1 : isFirst ? (pr.cacheWrite / pr.input) : ratio;
    costSys.push(S * r);
    costData.push(k * delta * r);
    const fullPrice = S + k * delta;
    ghost.push(useCache && !isFirst ? fullPrice * (1 - ratio) : 0);
    sysBg.push(isFirst ? 'rgba(129,140,248,0.55)' : 'rgba(129,140,248,0.12)');
    dataBg.push(isFirst ? 'rgba(245,158,11,0.55)' : 'rgba(245,158,11,0.12)');
  }

  mkChart('chCostStairs', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'S (начальный контекст)',
          data: costSys,
          backgroundColor: sysBg,
          borderColor: sysBg.map(c => c.replace(/[\d.]+\)$/, '0.35)')),
          borderWidth: 1,
        },
        {
          label: 'Накопленные данные',
          data: costData,
          backgroundColor: dataBg,
          borderColor: dataBg.map(c => c.replace(/[\d.]+\)$/, '0.35)')),
          borderWidth: 1,
        },
        ...(useCache ? [{
          label: 'Без кэша',
          data: ghost,
          backgroundColor: 'transparent',
          borderColor: 'rgba(255,255,255,0.15)',
          borderWidth: 1, borderDash: [3, 3],
        }] : []),
      ],
    },
    options: {
      ...chartOpts(v => fmtN(v), 'N', { xStacked: true, yStacked: true }),
      plugins: {
        legend: { labels: { ...LEGEND.labels, filter: (item) => item.text !== 'Без кэша' } },
        tooltip: {
          callbacks: {
            title: (items) => `N = ${items[0].label}`,
            label: () => null,
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const isFirst = idx === 0;
              const r = !useCache ? 1 : isFirst ? (pr.cacheWrite / pr.input) : ratio;
              const orig = sim.perTurn[idx];
              const weighted = Math.round(orig * r);
              const lines = [
                `Input: ${fmtN(orig)} tokens`,
                `Ставка: ×${r.toFixed(2)} (${!useCache ? 'полная' : isFirst ? 'cache write' : 'cache read'})`,
                `Эфф. вес: ${fmtN(weighted)}`,
              ];
              if (!isFirst && useCache) lines.push(`Без кэша было бы: ${fmtN(orig)}`);
              return lines;
            },
          },
        },
      },
    },
  });

  // Horizontal cost bar — use core-computed costs
  const segs = [];
  if (useCache) {
    // Turn 0: full ctx at cacheWrite, rest at input
    const sWrite = S * pr.cacheWrite / 1e6;
    // Turns 1+: S at cacheRead
    const sRead  = N > 1 ? S * pr.cacheRead / 1e6 * (N - 1) : 0;
    // Turn 0 has 0 data tokens; turns 1+ each k*delta new tokens at input
    const dFull  = N > 1 ? delta * pr.input / 1e6 * (N - 1) : 0;
    // Turns 2+: accumulated data re-read from cache
    const dRead  = N > 2 ? delta * pr.cacheRead / 1e6 * (N - 1) * (N - 2) / 2 : 0;
    if (sWrite > 0)  segs.push({ label: 'S write', val: sWrite, bg: 'rgba(129,140,248,.5)', fg: '#818cf8' });
    if (dFull > 0)   segs.push({ label: 'δ полн.', val: dFull, bg: 'rgba(245,158,11,.5)', fg: '#f59e0b' });
    if (sRead > 0)   segs.push({ label: 'S cache', val: sRead, bg: 'rgba(129,140,248,.15)', fg: '#818cf8' });
    if (dRead > 0)   segs.push({ label: 'δ cache', val: dRead, bg: 'rgba(245,158,11,.15)', fg: '#f59e0b' });
  } else {
    const sAll = S * pr.input / 1e6 * N;
    const dAll = delta * pr.input / 1e6 * N * (N - 1) / 2;
    if (sAll > 0) segs.push({ label: 'S', val: sAll, bg: 'rgba(129,140,248,.5)', fg: '#818cf8' });
    if (dAll > 0) segs.push({ label: 'δ', val: dAll, bg: 'rgba(245,158,11,.5)', fg: '#f59e0b' });
  }

  const barTotal = segs.reduce((s, seg) => s + seg.val, 0);
  $('costBar').innerHTML = segs.map(s => {
    const pct = (s.val / barTotal * 100).toFixed(1);
    return `<div class="ctx-seg cost-seg" title="${s.label}: ${fmtCost(s.val)} (${pct}%)" style="flex:${s.val};background:${s.bg};color:${s.fg}"><span class="seg-pct">${pct}%</span><span class="seg-lbl">${s.label}</span><span class="seg-lbl">${fmtCost(s.val)}</span></div>`;
  }).join('');

  let crossTurn = null;
  if (useCache) {
    for (let n = 2; n <= 1000; n++) {
      const fc = pr.input * (S + (n - 1) * delta);
      const cc = pr.cacheRead * (S * (n - 1) + delta * (n - 1) * (n - 2) / 2);
      if (cc > fc) { crossTurn = n; break; }
    }
  }

  const crossNote = crossTurn
    ? ` · cache &gt; полная с вызова <strong>${crossTurn}</strong>`
    : '';

  $('costSummary').innerHTML = useCache && N > 1
    ? `Итого: <strong>${fmtCost(sesCost)}</strong> (без кэша было бы ${fmtCost(noCacheCost)})${crossNote}`
    : `Итого: ${fmtCost(noCacheCost)} (все по полной ставке)`;

  // Linear: per-turn input
  mkChart('chLinear', {
    type: 'line',
    data: { labels, datasets: [
      {
        label: 'Input вызова',
        data: sim.perTurn,
        borderColor: 'rgb(245,158,11)',
        backgroundColor: 'rgba(245,158,11,0.08)',
        fill: true, tension: 0, pointRadius: N > 40 ? 0 : 3,
        pointHoverRadius: 4, borderWidth: 2,
      },
      {
        label: `S = ${fmtN(S)} (фикс.)`,
        data: Array(N).fill(S),
        borderColor: 'rgb(129,140,248)',
        borderDash: [6, 4], borderWidth: 1.5,
        pointRadius: 0, fill: false,
      },
    ]},
    options: chartOpts(v => fmtN(v), 'N'),
  });

  // Parabola: cumulative
  mkChart('chParabola', {
    type: 'line',
    data: { labels, datasets: [
      {
        label: 'Σ Input (факт.)',
        data: sim.cumulative,
        borderColor: 'rgb(52,211,153)',
        backgroundColor: 'rgba(52,211,153,0.08)',
        fill: true, tension: 0.3, pointRadius: N > 40 ? 0 : 3,
        pointHoverRadius: 4, borderWidth: 2,
      },
      {
        label: 'S·N (линейная часть)',
        data: labels.map(k => S * k),
        borderColor: 'rgb(129,140,248)',
        borderDash: [6, 4], borderWidth: 1.5,
        pointRadius: 0, fill: false,
      },
    ]},
    options: chartOpts(v => fmtN(v), 'N'),
  });

  // Doubling demo
  const sim2 = computeSum(S, delta, N * 2);
  const dblRatio = sim2.total / sim.total;
  $('d_n1').textContent = `${N} вызовов`;
  $('d_c1').textContent = `Σ ${fmtN(sim.total)}`;
  $('d_n2').textContent = `${N * 2} вызовов`;
  $('d_c2').textContent = `Σ ${fmtN(sim2.total)}`;
  $('d_ratio').textContent = dblRatio.toFixed(2) + '×';

  const doublingNs = [1, 2, 3, 4, 5].map(m => m * N);
  const doublingSums = doublingNs.map(n => computeSum(S, delta, n).total);
  mkChart('chDouble', {
    type: 'bar',
    data: {
      labels: doublingNs.map(n => `${n} вызовов`),
      datasets: [{
        label: 'Σ Input tokens',
        data: doublingSums,
        backgroundColor: doublingNs.map((_, i) =>
          i === 0 ? 'rgba(129,140,248,0.4)' : 'rgba(248,113,113,0.3)'
        ),
        borderColor: doublingNs.map((_, i) =>
          i === 0 ? 'rgba(129,140,248,0.7)' : 'rgba(248,113,113,0.5)'
        ),
        borderWidth: 1,
      }],
    },
    options: chartOpts(v => fmtN(v), ''),
  });
}
window.update = update;

window.addEventListener('load', () => {
  store.load();
  SLIDERS.forEach(sv);
  update();
});
