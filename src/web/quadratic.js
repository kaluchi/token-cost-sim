import Chart from 'chart.js/auto';
import { MODELS } from '../core/models.js';
import { fmtN, fmtCost } from '../core/format.js';
import { injectNav } from './nav.js';
import './style.css';

injectNav('quad');

const STORAGE_KEY = 'quad_settings';
const DEFAULTS = { S: 20000, delta: 3500, N: 50, costCache: true };

function saveToStorage() {
  const state = {};
  Object.keys(DEFAULTS).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    state[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    Object.entries(state).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = val;
    });
    return true;
  } catch { return false; }
}

export function resetToDefaults() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  Object.entries(DEFAULTS).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = val;
    else el.value = val;
  });
  ['S', 'delta', 'N'].forEach(sv);
  update();
}
window.resetToDefaults = resetToDefaults;

export function sv(id) {
  const el = document.getElementById(id);
  document.getElementById('v_' + id).textContent = Number(el.value).toLocaleString('ru-RU');
}
window.sv = sv;

const CHARTS = {};
const GRID   = { color: 'rgba(255,255,255,0.04)' };
const TICK   = { color: '#64748b', font: { size: 11 } };
const LEGEND = { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } };

function mkChart(id, cfg) {
  if (CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart(document.getElementById(id), cfg);
}

function chartOpts(yFmt, xTitle = '', extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: LEGEND },
    scales: {
      x: {
        ticks: { ...TICK, maxTicksLimit: 15 }, grid: GRID,
        title: xTitle ? { display: true, text: xTitle, color: '#64748b', font: { size: 11 } } : undefined,
        ...(extra.xStacked && { stacked: true }),
      },
      y: {
        ticks: { ...TICK, callback: yFmt }, grid: GRID,
        min: 0,
        ...(extra.yStacked && { stacked: true }),
      },
    },
    interaction: { intersect: false, mode: 'index' },
  };
}

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

export function update() {
  saveToStorage();
  const S     = +document.getElementById('S').value;
  const delta = +document.getElementById('delta').value;
  const N     = +document.getElementById('N').value;

  const sim = computeSum(S, delta, N);
  const labels = Array.from({ length: N }, (_, i) => i + 1);

  const pr = MODELS.sonnet;
  const useCache = document.getElementById('costCache').checked;
  const ratio = pr.cacheRead / pr.input;

  const finalCtx    = N > 0 ? S + (N - 1) * delta : S;
  const cachedInput = sim.total - finalCtx;
  const cachedPct   = sim.total > 0 ? (cachedInput / sim.total * 100) : 0;
  const sesCost     = useCache
    ? finalCtx * pr.input / 1e6 + cachedInput * pr.cacheRead / 1e6
    : sim.total * pr.input / 1e6;
  const $ = id => document.getElementById(id);

  // Metrics
  $('m_ctx').textContent      = fmtN(finalCtx);
  $('m_total').textContent    = fmtN(sim.total);
  $('m_cached_pct').textContent = cachedPct.toFixed(1) + '%';
  $('m_cost').textContent     = fmtCost(sesCost);

  // Staircase bar chart
  const sysData  = Array(N).fill(S);
  const dataData = sim.perTurn.map((v, i) => v - S);
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

  // Cost staircase — same bars, height × price coefficient
  $('ratioLabel').textContent = ratio.toFixed(2);

  const costSys = [], costData = [], ghost = [];
  const sysBg = [], dataBg = [];
  for (let k = 0; k < N; k++) {
    const isLast = k === N - 1;
    const r = (!useCache || isLast) ? 1 : ratio;
    costSys.push(S * r);
    costData.push(k * delta * r);
    ghost.push(useCache && !isLast ? (S + k * delta) * (1 - ratio) : 0);
    sysBg.push(isLast ? 'rgba(129,140,248,0.55)' : 'rgba(129,140,248,0.12)');
    dataBg.push(isLast ? 'rgba(245,158,11,0.55)' : 'rgba(245,158,11,0.12)');
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
              const isLast = idx === N - 1;
              const r = (!useCache || isLast) ? 1 : ratio;
              const orig = sim.perTurn[idx];
              const weighted = Math.round(orig * r);
              const lines = [
                `Input: ${fmtN(orig)} tokens`,
                `Ставка: ×${r.toFixed(2)} (${isLast || !useCache ? 'полная' : 'cache read'})`,
                `Эфф. вес: ${fmtN(weighted)}`,
              ];
              if (!isLast && useCache) lines.push(`Без кэша было бы: ${fmtN(orig)}`);
              return lines;
            },
          },
        },
      },
    },
  });

  // Horizontal bar: 4 cost segments
  const totalTokens = sim.total;
  const noCacheCost = totalTokens * pr.input / 1e6;

  const cRate = useCache ? pr.cacheRead : pr.input;
  const sFull  = S * pr.input / 1e6;
  const sRepeat = N > 1 ? S * cRate / 1e6 * (N - 1) : 0;
  const dFull  = N > 1 ? (N - 1) * delta * pr.input / 1e6 : 0;
  const dRepeat = N > 2 ? delta * cRate / 1e6 * (N - 1) * (N - 2) / 2 : 0;
  const sessionCost = sFull + sRepeat + dFull + dRepeat;

  // Horizontal bar
  const segs = [];
  if (useCache) {
    if (sFull > 0)    segs.push({ label: 'S полн.', val: sFull, bg: 'rgba(129,140,248,.5)', fg: '#818cf8' });
    if (dFull > 0)    segs.push({ label: 'δ полн.', val: dFull, bg: 'rgba(245,158,11,.5)', fg: '#f59e0b' });
    if (sRepeat > 0)  segs.push({ label: 'S cache', val: sRepeat, bg: 'rgba(129,140,248,.15)', fg: '#818cf8' });
    if (dRepeat > 0)  segs.push({ label: 'δ cache', val: dRepeat, bg: 'rgba(245,158,11,.15)', fg: '#f59e0b' });
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
    ? `Полная ставка: <strong>${fmtCost(sFull + dFull)}</strong> · Cache read: <strong>${fmtCost(sRepeat + dRepeat)}</strong> · Итого: <strong>${fmtCost(sessionCost)}</strong> (без кэша было бы ${fmtCost(noCacheCost)})${crossNote}`
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
  loadFromStorage();
  ['S', 'delta', 'N'].forEach(sv);
  update();
});
