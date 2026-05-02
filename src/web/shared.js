import Chart from 'chart.js/auto';
import { MODELS } from '../core/models.js';

// ─── Chart constants ─────────────────────────────────────────────
export const GRID   = { color: 'rgba(255,255,255,0.04)' };
export const TICK   = { color: '#64748b', font: { size: 11 } };
export const LEGEND = { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } };

// ─── Chart factories ─────────────────────────────────────────────
const CHARTS = {};

export function mkChart(id, cfg) {
  if (CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart(document.getElementById(id), cfg);
}

export function mkDS(label, data, color, dash = [], fill = false, pr = 0) {
  return {
    label, data,
    borderColor: color,
    backgroundColor: fill ? color.replace('rgb', 'rgba').replace(')', ',0.08)') : 'transparent',
    borderDash: dash, fill, tension: 0.3,
    pointRadius: pr, pointHoverRadius: pr > 0 ? pr + 2 : 4,
    borderWidth: dash.length ? 1.5 : 2,
  };
}

export function chartOpts(yFmt, xTitle = '', { yMin, suggestedMax, xStacked, yStacked } = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: LEGEND },
    scales: {
      x: {
        ticks: { ...TICK, maxTicksLimit: 12 }, grid: GRID,
        title: xTitle ? { display: true, text: xTitle, color: '#64748b', font: { size: 11 } } : undefined,
        ...(xStacked && { stacked: true }),
      },
      y: {
        ticks: { ...TICK, callback: yFmt }, grid: GRID,
        ...(yMin !== undefined && { min: yMin }),
        ...(suggestedMax !== undefined && { suggestedMax }),
        ...(yStacked && { stacked: true }),
      },
    },
    interaction: { intersect: false, mode: 'index' },
  };
}

export function autoFmt(maxVal) {
  if (maxVal >= 10)   return v => '$' + v.toFixed(1);
  if (maxVal >= 1)    return v => '$' + v.toFixed(2);
  if (maxVal >= 0.1)  return v => '$' + v.toFixed(3);
  if (maxVal >= 0.01) return v => '$' + v.toFixed(4);
  return v => '$' + v.toExponential(2);
}

export function pad(arr, n) {
  return [...arr, ...Array(Math.max(0, n - arr.length)).fill(null)];
}

// ─── Slider sync ─────────────────────────────────────────────────
export function sv(id) {
  const el = document.getElementById(id);
  document.getElementById('v_' + id).textContent = Number(el.value).toLocaleString('ru-RU');
}

// ─── Model preset ────────────────────────────────────────────────
export function setModel(key, btn, updateFn) {
  document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (key === 'custom') return;
  const m = MODELS[key];
  document.getElementById('p_in').value  = m.input;
  document.getElementById('p_out').value = m.output;
  document.getElementById('p_cr').value  = m.cacheRead;
  document.getElementById('p_cw').value  = m.cacheWrite;
  updateFn();
}

export function pricing() {
  return {
    input:      +document.getElementById('p_in').value,
    output:     +document.getElementById('p_out').value,
    cacheRead:  +document.getElementById('p_cr').value,
    cacheWrite: +document.getElementById('p_cw').value,
  };
}

// ─── localStorage persistence ────────────────────────────────────
export function createStorage(storageKey, defaults) {
  function save() {
    const state = {};
    Object.keys(defaults).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      state[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
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

  function reset(sliderIds, updateFn) {
    try { localStorage.removeItem(storageKey); } catch {}
    Object.entries(defaults).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('active'));
    document.querySelector('.mbtn[data-model="sonnet"]')?.classList.add('active');
    sliderIds.forEach(sv);
    updateFn();
  }

  return { save, load, reset };
}
