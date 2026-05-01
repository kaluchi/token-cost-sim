import Chart from 'chart.js/auto';
import { MODELS } from '../core/models.js';
import { simulate } from '../core/simulate.js';
import { fmtN, fmtMT, fmtCost } from '../core/format.js';
import { injectNav } from './nav.js';
import './style.css';

injectNav('oneshot');

const CONTEXT_WINDOW = 200_000;
const STORAGE_KEY = 'oneshot_settings';
const DEFAULTS = {
  files: 80, avg_tok: 1200, relevance: 50, sys: 15000,
  files_per_iter: 3, out_per: 800,
  p_in: 3, p_out: 15, p_cr: 0.30, p_cw: 3.75,
  useCache: true,
};

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
  document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('active'));
  document.querySelector('.mbtn[data-model="sonnet"]')?.classList.add('active');
  ['files', 'avg_tok', 'relevance', 'sys', 'files_per_iter', 'out_per'].forEach(sv);
  update();
}
window.resetToDefaults = resetToDefaults;

export function sv(id) {
  const el = document.getElementById(id);
  document.getElementById('v_' + id).textContent = Number(el.value).toLocaleString('ru-RU');
}
window.sv = sv;

export function setModel(key, btn) {
  document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const m = MODELS[key];
  document.getElementById('p_in').value  = m.input;
  document.getElementById('p_out').value = m.output;
  document.getElementById('p_cr').value  = m.cacheRead;
  document.getElementById('p_cw').value  = m.cacheWrite;
  update();
}
window.setModel = setModel;

function pricing() {
  return {
    input:      +document.getElementById('p_in').value,
    output:     +document.getElementById('p_out').value,
    cacheRead:  +document.getElementById('p_cr').value,
    cacheWrite: +document.getElementById('p_cw').value,
  };
}

const CHARTS = {};
const GRID   = { color: 'rgba(255,255,255,0.04)' };
const TICK   = { color: '#64748b', font: { size: 11 } };
const LEGEND = { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } };

function mkChart(id, cfg) {
  if (CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart(document.getElementById(id), cfg);
}

function autoFmt(maxVal) {
  if (maxVal >= 10)   return v => '$' + v.toFixed(1);
  if (maxVal >= 1)    return v => '$' + v.toFixed(2);
  if (maxVal >= 0.1)  return v => '$' + v.toFixed(3);
  if (maxVal >= 0.01) return v => '$' + v.toFixed(4);
  return v => '$' + v.toExponential(2);
}

export function update() {
  saveToStorage();
  const pr       = pricing();
  const useCache = document.getElementById('useCache').checked;
  const files    = +document.getElementById('files').value;
  const avgTok   = +document.getElementById('avg_tok').value;
  const relPct   = +document.getElementById('relevance').value;
  const sys      = +document.getElementById('sys').value;
  const filesPI  = +document.getElementById('files_per_iter').value;
  const outPer   = +document.getElementById('out_per').value;

  const totalTok    = files * avgTok;
  const relevantTok = Math.round(totalTok * relPct / 100);
  const relevantFiles = Math.round(files * relPct / 100);
  const oneshotCtx    = sys + relevantTok;
  const oneshotInput  = oneshotCtx;
  const oneshotOutput = outPer;
  const fits          = oneshotCtx + oneshotOutput <= CONTEXT_WINDOW;
  const oneshotCost   = oneshotInput * pr.input / 1e6 + oneshotOutput * pr.output / 1e6;

  const tokPerIter = filesPI * avgTok;
  const nIter = Math.max(1, Math.ceil(relevantFiles / filesPI));
  const iterSim = simulate(
    { initialContext: sys, numTurns: nIter, userMsg: 500, toolResult: tokPerIter, modelOutput: outPer },
    pr, useCache
  );

  const $ = id => document.getElementById(id);

  // Fit check
  $('bc_proj').textContent   = fmtN(oneshotCtx);
  $('bc_proj_d').textContent = `${fmtN(relevantFiles)} файлов × ${fmtN(avgTok)} = ${fmtN(relevantTok)} + sys ${fmtN(sys)}`;
  $('badge_fit').textContent = fits ? '✓ Влезает в 200k' : '⚠ Не влезает';
  $('badge_fit').className   = 'badge ' + (fits ? 'badge-win' : 'badge-lose');

  $('vs_window').textContent = '200k';
  const freeTokens = CONTEXT_WINDOW - oneshotCtx - oneshotOutput;
  $('vs_free').textContent = fits ? `${fmtN(freeTokens)} свободно` : `${fmtN(-freeTokens)} сверх лимита`;

  $('bc_oneshot').textContent   = fmtCost(oneshotCost);
  $('bc_oneshot_d').textContent = `${fmtN(oneshotInput)} input + ${fmtN(oneshotOutput)} output`;

  // Context bar
  if (fits) {
    const pctSys  = (sys / CONTEXT_WINDOW * 100).toFixed(1);
    const pctData = (relevantTok / CONTEXT_WINDOW * 100).toFixed(1);
    const pctFree = (freeTokens / CONTEXT_WINDOW * 100).toFixed(1);
    $('ctxBar').innerHTML =
      `<div class="ctx-seg" title="Системный промт" style="flex:${sys};background:rgba(129,140,248,.25);color:#818cf8">Sys ${pctSys}%</div>` +
      `<div class="ctx-seg" title="Данные проекта" style="flex:${relevantTok};background:rgba(245,158,11,.25);color:#f59e0b">Данные ${pctData}%</div>` +
      `<div class="ctx-seg" title="Свободно" style="flex:${Math.max(freeTokens,0)};background:rgba(52,211,153,.1);color:#34d399">Свободно ${pctFree}%</div>`;
  } else {
    const pctOver = ((-freeTokens) / CONTEXT_WINDOW * 100).toFixed(0);
    $('ctxBar').innerHTML =
      `<div class="ctx-seg" style="flex:${CONTEXT_WINDOW};background:rgba(129,140,248,.15);color:#818cf8">Окно 200k</div>` +
      `<div class="ctx-seg" style="flex:${-freeTokens};background:rgba(248,113,113,.25);color:#f87171">+${pctOver}% сверх</div>`;
  }

  // Info box
  const ib = $('infoBox');
  const overpay = iterSim.totalCost - oneshotCost;
  const overpayPct = oneshotCost > 0 ? (overpay / oneshotCost * 100).toFixed(0) : '0';
  if (fits && overpay > 0) {
    ib.className = 'info-box info-ok';
    ib.innerHTML = `✓ <strong>One-Shot выгоднее</strong>: один вызов за ${fmtCost(oneshotCost)} вместо ${nIter} итераций за ${fmtCost(iterSim.totalCost)}. ` +
      `Переплата итеративного подхода: <strong>+${overpayPct}%</strong> (+${fmtCost(overpay)}).`;
  } else if (fits) {
    ib.className = 'info-box info-neutral';
    ib.innerHTML = `При ${nIter} итерациях итеративный подход ещё дешевле. One-Shot станет выгоднее когда задача потребует больше файлов или итераций.`;
  } else {
    ib.className = 'info-box info-warn';
    ib.innerHTML = `⚠ <strong>Проект не влезает</strong> в 200k контекст. Нужна фильтрация: снизь % релевантных файлов или используй итеративный подход с таргетированным поиском.`;
  }

  // Metrics
  $('m_os_cost').textContent = fmtCost(oneshotCost);
  $('m_it_cost').textContent = fmtCost(iterSim.totalCost);
  $('m_it_n').textContent    = `${nIter} итер.`;
  $('m_overpay').textContent = overpay > 0 ? `+${overpayPct}%` : '—';
  $('m_it_tok').textContent  = fmtMT(iterSim.totalInput);

  // Break-even: max N where iterative is still cheaper than one-shot
  let brkN = null;
  const firstIterCost = simulate(
    { initialContext: sys, numTurns: 1, userMsg: 500, toolResult: tokPerIter, modelOutput: outPer },
    pr, useCache
  ).totalCost;
  if (firstIterCost >= oneshotCost) {
    brkN = 0;
  } else {
    for (let n = 2; n <= 200; n++) {
      const c = simulate(
        { initialContext: sys, numTurns: n, userMsg: 500, toolResult: tokPerIter, modelOutput: outPer },
        pr, useCache
      ).totalCost;
      if (c > oneshotCost) { brkN = n - 1; break; }
    }
  }
  $('m_brk').textContent = brkN === 0 ? 'one-shot сразу' : brkN !== null ? `${brkN}` : '> 200';

  // Chart 1: Cost comparison
  const maxPlotN = Math.min(Math.max(nIter * 3, 30), 100);
  const plotNs   = Array.from({ length: maxPlotN }, (_, i) => i + 1);
  const iterCosts = plotNs.map(n =>
    simulate({ initialContext: sys, numTurns: n, userMsg: 500, toolResult: tokPerIter, modelOutput: outPer }, pr, useCache).totalCost
  );

  const maxCost = Math.max(oneshotCost * 2, ...iterCosts);
  mkChart('chCompare', {
    type: 'line',
    data: {
      labels: plotNs,
      datasets: [
        {
          label: 'Итеративно ($ total)',
          data: iterCosts,
          borderColor: 'rgb(129,140,248)', backgroundColor: 'transparent',
          tension: 0.3, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2,
        },
        {
          label: `One-Shot (${fmtCost(oneshotCost)})`,
          data: Array(maxPlotN).fill(oneshotCost),
          borderColor: 'rgb(245,158,11)', borderDash: [6, 4],
          borderWidth: 2, pointRadius: 0, fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: LEGEND },
      scales: {
        x: { ticks: { ...TICK, maxTicksLimit: 12 }, grid: GRID, title: { display: true, text: 'N', color: '#64748b', font: { size: 11 } } },
        y: { ticks: { ...TICK, callback: autoFmt(maxCost) }, grid: GRID, min: 0 },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });

  // Chart 2: Token comparison
  const iterTokens = plotNs.map(n =>
    simulate({ initialContext: sys, numTurns: n, userMsg: 500, toolResult: tokPerIter, modelOutput: outPer }, pr, false).totalInput
  );
  mkChart('chTokens', {
    type: 'line',
    data: {
      labels: plotNs,
      datasets: [
        {
          label: 'Итеративно: Σ input',
          data: iterTokens,
          borderColor: 'rgb(129,140,248)', backgroundColor: 'rgba(129,140,248,0.08)',
          fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
        },
        {
          label: `One-Shot: ${fmtN(oneshotInput)}`,
          data: Array(maxPlotN).fill(oneshotInput),
          borderColor: 'rgb(245,158,11)', borderDash: [6, 4],
          borderWidth: 2, pointRadius: 0, fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: LEGEND },
      scales: {
        x: { ticks: { ...TICK, maxTicksLimit: 12 }, grid: GRID, title: { display: true, text: 'N', color: '#64748b', font: { size: 11 } } },
        y: { ticks: { ...TICK, callback: v => fmtN(v) }, grid: GRID, min: 0 },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}
window.update = update;

window.addEventListener('load', () => {
  loadFromStorage();
  ['files', 'avg_tok', 'relevance', 'sys', 'files_per_iter', 'out_per'].forEach(sv);
  update();
});
