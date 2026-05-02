import { fmtN, fmtMT, fmtCost } from '../core/format.js';
import { injectNav } from './nav.js';
import {
  sv, setModel as _setModel, pricing, createStorage,
  mkChart, mkDS, chartOpts, autoFmt, pad,
} from './shared.js';
import './style.css';

injectNav('tax');

const DEFAULTS = {
  sys_tok: 20000, target_ctx: 200000,
  prompt_a: 500,  data_a: 2000,  out_a: 1500,
  prompt_b: 5000, data_b: 8000,  out_b: 2000,
  p_in: 3, p_out: 15, p_cr: 0.30, p_cw: 3.75,
  useCache: true,
};
const SLIDERS = ['sys_tok','target_ctx','prompt_a','data_a','out_a','prompt_b','data_b','out_b'];
const store = createStorage('tcs_tax_v2', DEFAULTS);

window.sv = sv;
window.setModel = (key, btn) => _setModel(key, btn, update);
window.resetToDefaults = () => store.reset(SLIDERS, update);

function deriveN(target, sysTok, prompt, dataPer, outPer) {
  const delta = dataPer + outPer;
  if (delta <= 0) return 1;
  return Math.max(1, Math.round((target - sysTok - prompt) / delta));
}

// Cost formula kept in sync with src/core/simulate.js
function decompose(sysTok, prompt, nTurns, dataPer, outPer, pr, useCache) {
  const turns = [];
  let ctx = sysTok + prompt;
  let cumTotalIn = 0, cumSysIn = 0, cumUserIn = 0, cumOut = 0;
  let cumCostTotal = 0, cumCostSys = 0, cumCostUser = 0, cumCostOut = 0;

  for (let k = 0; k < nTurns; k++) {
    const fullIn = ctx + dataPer;
    const userIn = fullIn - sysTok;

    cumTotalIn += fullIn;
    cumSysIn   += sysTok;
    cumUserIn  += userIn;
    cumOut     += outPer;

    let cSys, cUser;
    if (!useCache) {
      cSys  = sysTok * pr.input / 1e6;
      cUser = userIn * pr.input / 1e6;
    } else if (k === 0) {
      const history = ctx - sysTok;
      cSys  = sysTok  * pr.cacheWrite / 1e6;
      cUser = history * pr.cacheWrite / 1e6 + dataPer * pr.input / 1e6;
    } else {
      const history = ctx - sysTok;
      cSys  = sysTok  * pr.cacheRead / 1e6;
      cUser = history * pr.cacheRead / 1e6 + dataPer * pr.input / 1e6;
    }
    const cOut = outPer * pr.output / 1e6;

    cumCostSys   += cSys;
    cumCostUser  += cUser;
    cumCostOut   += cOut;
    cumCostTotal += cSys + cUser + cOut;

    turns.push({
      turn: k + 1, ctx, fullIn, sysIn: sysTok, userIn,
      cumTotalIn, cumSysIn, cumUserIn,
      sysShareTurn: sysTok / fullIn,
      sysShareCum:  cumSysIn / cumTotalIn,
      turnCost: cSys + cUser + cOut,
      turnCostSys: cSys, turnCostUser: cUser, turnCostOut: cOut,
      cumCostSys, cumCostUser, cumCostOut, cumCostTotal,
    });

    ctx += dataPer + outPer;
  }

  return {
    turns, totalCost: cumCostTotal,
    sysCost: cumCostSys, userCost: cumCostUser, outCost: cumCostOut,
    totalInput: cumTotalIn, sysInput: cumSysIn, userInput: cumUserIn,
    totalOutput: cumOut, finalContext: ctx,
    linearCrossover: turns.find(t => t.userIn > t.sysIn)?.turn ?? null,
    cumCrossover:    turns.find(t => t.cumUserIn > t.cumSysIn)?.turn ?? null,
    sysShareTotal:   cumSysIn / cumTotalIn,
  };
}

// ── Visual bars ───────────────────────────────────────────────────
function renderCtxBar(sysTok, target) {
  const budget = target - sysTok;
  const pctSys = (sysTok / target * 100).toFixed(1);
  const pctBud = (budget / target * 100).toFixed(1);
  document.getElementById('ctxBar').innerHTML =
    `<div class="ctx-seg" title="Системные токены: ${fmtN(sysTok)}\nИнструменты, инструкции, правила — зашиты фреймворком, вы не управляете этим" style="flex:${sysTok};background:rgba(129,140,248,.25);color:#818cf8">Система ${fmtN(sysTok)} (${pctSys}%)</div>` +
    `<div class="ctx-seg" title="Бюджет на данные: ${fmtN(budget)}\nВсё что остаётся на промт + tool results + model output" style="flex:${budget};background:rgba(52,211,153,.15);color:#34d399">Бюджет ${fmtN(budget)} (${pctBud}%)</div>`;
  document.getElementById('frameBudget').textContent =
    `Бюджет на данные: ${fmtN(budget)} tokens (${pctBud}% от ${fmtN(target)})`;
}

function renderPathBar(id, sysTok, prompt, nTurns, dataPer, outPer) {
  const totalData = nTurns * dataPer;
  const totalOut  = nTurns * outPer;
  const total     = sysTok + prompt + totalData + totalOut;
  const pct = v => (v / total * 100).toFixed(1);
  document.getElementById(id).innerHTML =
    `<div class="path-seg" title="Системный промт: ${fmtN(sysTok)} tokens (${pct(sysTok)}%)\nНеуправляемый — отправляется в каждом вызове целиком" style="flex:${sysTok};background:rgba(129,140,248,.25);color:#818cf8">S ${fmtN(sysTok)}</div>` +
    `<div class="path-seg" title="Начальный промт пользователя: ${fmtN(prompt)} tokens (${pct(prompt)}%)\nОписание задачи, контекст — задаётся один раз" style="flex:${Math.max(prompt,1)};background:rgba(251,191,36,.25);color:#fbbf24">P ${fmtN(prompt)}</div>` +
    `<div class="path-seg" title="Суммарные данные: ${fmtN(totalData)} tokens (${pct(totalData)}%)\n${nTurns} итер. × ${fmtN(dataPer)} tokens/вызов (tool results, файлы, grep)" style="flex:${totalData};background:rgba(52,211,153,.2);color:#34d399">D ${fmtN(totalData)}</div>` +
    `<div class="path-seg" title="Суммарный output модели: ${fmtN(totalOut)} tokens (${pct(totalOut)}%)\n${nTurns} итер. × ${fmtN(outPer)} tokens/вызов (thinking + ответ)" style="flex:${totalOut};background:rgba(248,113,113,.15);color:#f87171">O ${fmtN(totalOut)}</div>`;
}

// ── Main update ───────────────────────────────────────────────────
function update() {
  const pr       = pricing();
  const useCache = document.getElementById('useCache').checked;
  const sysTok   = +document.getElementById('sys_tok').value;
  const target   = +document.getElementById('target_ctx').value;
  const pA = +document.getElementById('prompt_a').value;
  const dA = +document.getElementById('data_a').value;
  const oA = +document.getElementById('out_a').value;
  const pB = +document.getElementById('prompt_b').value;
  const dB = +document.getElementById('data_b').value;
  const oB = +document.getElementById('out_b').value;

  const nA = deriveN(target, sysTok, pA, dA, oA);
  const nB = deriveN(target, sysTok, pB, dB, oB);

  const simA = decompose(sysTok, pA, nA, dA, oA, pr, useCache);
  const simB = decompose(sysTok, pB, nB, dB, oB, pr, useCache);

  const $ = id => document.getElementById(id);

  renderCtxBar(sysTok, target);
  renderPathBar('barA', sysTok, pA, nA, dA, oA);
  renderPathBar('barB', sysTok, pB, nB, dB, oB);

  $('s_nA').textContent    = nA;
  $('s_fcA').textContent   = fmtN(simA.finalContext);
  $('s_costA').textContent = fmtCost(simA.totalCost);
  $('s_taxA').textContent  = fmtCost(simA.sysCost);
  $('s_sumA').textContent  = fmtMT(simA.totalInput) + ' MTok';
  $('s_outA').textContent  = fmtMT(simA.totalOutput) + ' MTok';

  $('s_nB').textContent    = nB;
  $('s_fcB').textContent   = fmtN(simB.finalContext);
  $('s_costB').textContent = fmtCost(simB.totalCost);
  $('s_taxB').textContent  = fmtCost(simB.sysCost);
  $('s_sumB').textContent  = fmtMT(simB.totalInput) + ' MTok';
  $('s_outB').textContent  = fmtMT(simB.totalOutput) + ' MTok';

  $('bc_a').textContent   = fmtCost(simA.totalCost);
  $('bc_a_d').textContent = `${nA} итер. · ${fmtN(simA.finalContext)} финал · Σ ${fmtMT(simA.totalInput)} MTok`;
  $('bc_b').textContent   = fmtCost(simB.totalCost);
  $('bc_b_d').textContent = `${nB} итер. · ${fmtN(simB.finalContext)} финал · Σ ${fmtMT(simB.totalInput)} MTok`;

  const overpay    = simA.totalCost - simB.totalCost;
  const overPayPct = simB.totalCost > 0 ? (overpay / simB.totalCost * 100).toFixed(1) : '0.0';
  const bWins      = overpay > 0;

  $('badge_b').textContent = bWins ? '✓ База' : '⚠ Дороже';
  $('badge_b').className   = 'badge ' + (bWins ? 'badge-win' : 'badge-lose');
  $('badge_a').textContent = bWins ? `+${overPayPct}%` : '✓ Дешевле';
  $('badge_a').className   = 'badge ' + (bWins ? 'badge-lose' : 'badge-win');

  $('vs_save').textContent   = (bWins ? '+' : '') + fmtCost(Math.abs(overpay));
  $('vs_save').style.color   = bWins ? 'var(--red)' : 'var(--green)';
  $('vs_pct').textContent    = bWins ? `+${overPayPct}% к базе` : `${Math.abs(+overPayPct)}% дешевле базы`;
  $('vs_iters').textContent  = `${nB} vs ${nA}`;
  $('vs_iters_d').textContent = `Δ ${Math.abs(nA - nB)} итераций`;

  const ib = $('infoBox');
  if (bWins) {
    ib.className = 'info-box info-ok';
    ib.innerHTML = `✓ <strong>Крупные шаги = база</strong>. Мелкие шаги переплачивают <strong>${fmtCost(Math.abs(overpay))}</strong> (+${overPayPct}%). ` +
      `${nA} итераций вместо ${nB} — больше системного налога (${fmtCost(simA.sysCost)} vs ${fmtCost(simB.sysCost)}) ` +
      `и больше квадратичной переплаты.`;
  } else {
    ib.className = 'info-box info-warn';
    ib.innerHTML = `⚠ <strong>Мелкие шаги оказались дешевле</strong> на ${fmtCost(Math.abs(overpay))} (${Math.abs(+overPayPct)}%): ` +
      `крупный промт и большие tool results не окупились при данных параметрах.`;
  }

  $('m_lcA').textContent = simA.linearCrossover ? `N = ${simA.linearCrossover}` : '> N';
  $('m_ccA').textContent = simA.cumCrossover    ? `N = ${simA.cumCrossover}`    : '> N';
  $('m_lcB').textContent = simB.linearCrossover ? `N = ${simB.linearCrossover}` : '> N';
  $('m_ccB').textContent = simB.cumCrossover    ? `N = ${simB.cumCrossover}`    : '> N';

  const maxTurns = Math.max(nA, nB);
  const labels   = Array.from({ length: maxTurns }, (_, i) => i + 1);
  const noP      = n => n > 40 ? 0 : 3;
  const tA = simA.turns;
  const tB = simB.turns;

  mkChart('chCtx', {
    type: 'line',
    data: { labels, datasets: [
      mkDS('Крупн: input/вызов', pad(tB.map(t => t.fullIn), maxTurns), 'rgb(245,158,11)', [], false, noP(nB)),
      mkDS('Мелк: input/вызов',  pad(tA.map(t => t.fullIn), maxTurns), 'rgb(129,140,248)', [], false, noP(nA)),
      mkDS('Системные S',        Array(maxTurns).fill(sysTok), 'rgb(100,116,139)', [6, 4], false, 0),
      mkDS('Цель',               Array(maxTurns).fill(target), 'rgb(52,211,153)',  [3, 6], false, 0),
    ]},
    options: chartOpts(v => fmtN(v), 'N', { yMin: 0 }),
  });

  mkChart('chCumTok', {
    type: 'line',
    data: { labels, datasets: [
      mkDS('Крупн: Σ input',     pad(tB.map(t => t.cumTotalIn), maxTurns), 'rgb(245,158,11)', [], false, noP(nB)),
      mkDS('Мелк: Σ input',      pad(tA.map(t => t.cumTotalIn), maxTurns), 'rgb(129,140,248)', [], false, noP(nA)),
      mkDS('Крупн: Σ системные', pad(tB.map(t => t.cumSysIn),  maxTurns), 'rgb(245,158,11)', [5, 4], false, 0),
      mkDS('Мелк: Σ системные',  pad(tA.map(t => t.cumSysIn),  maxTurns), 'rgb(129,140,248)', [5, 4], false, 0),
    ]},
    options: chartOpts(v => fmtN(v), 'N', { yMin: 0 }),
  });

  const maxCost = Math.max(simA.totalCost, simB.totalCost);
  mkChart('chCumCost', {
    type: 'line',
    data: { labels, datasets: [
      mkDS('Крупн: $ total', pad(tB.map(t => t.cumCostTotal), maxTurns), 'rgb(245,158,11)', [], false, noP(nB)),
      mkDS('Мелк: $ total',  pad(tA.map(t => t.cumCostTotal), maxTurns), 'rgb(129,140,248)', [], false, noP(nA)),
      mkDS('Крупн: $ sys',   pad(tB.map(t => t.cumCostSys),   maxTurns), 'rgb(245,158,11)', [5, 4], false, 0),
      mkDS('Мелк: $ sys',    pad(tA.map(t => t.cumCostSys),   maxTurns), 'rgb(129,140,248)', [5, 4], false, 0),
    ]},
    options: chartOpts(autoFmt(maxCost), 'N', { yMin: 0 }),
  });

  const maxTurnCost = Math.max(...tA.map(t => t.turnCost), ...tB.map(t => t.turnCost));
  mkChart('chTurn', {
    type: 'line',
    data: { labels, datasets: [
      mkDS('Крупн: $/вызов', pad(tB.map(t => t.turnCost), maxTurns), 'rgb(245,158,11)', [], false, noP(nB)),
      mkDS('Мелк: $/вызов',  pad(tA.map(t => t.turnCost), maxTurns), 'rgb(129,140,248)', [], false, noP(nA)),
    ]},
    options: chartOpts(autoFmt(maxTurnCost), 'N', { yMin: 0 }),
  });

  mkChart('chShare', {
    type: 'line',
    data: { labels, datasets: [
      mkDS('Крупн: %/вызов',   pad(tB.map(t => t.sysShareTurn * 100), maxTurns), 'rgb(245,158,11)', [], false, noP(nB)),
      mkDS('Мелк: %/вызов',    pad(tA.map(t => t.sysShareTurn * 100), maxTurns), 'rgb(129,140,248)', [], false, noP(nA)),
      mkDS('Крупн: % кумул.', pad(tB.map(t => t.sysShareCum  * 100), maxTurns), 'rgb(245,158,11)', [5, 4], false, 0),
      mkDS('Мелк: % кумул.',  pad(tA.map(t => t.sysShareCum  * 100), maxTurns), 'rgb(129,140,248)', [5, 4], false, 0),
      mkDS('50%',             Array(maxTurns).fill(50), 'rgb(100,116,139)', [6, 4], false, 0),
    ]},
    options: chartOpts(v => v.toFixed(0) + '%', 'N', { yMin: 0, suggestedMax: 100 }),
  });

  const targets = Array.from({ length: 20 }, (_, i) => (i + 1) * 50_000);
  const sensB = targets.map(t => {
    const n = deriveN(t, sysTok, pB, dB, oB);
    return decompose(sysTok, pB, n, dB, oB, pr, useCache).totalCost;
  });
  const sensA = targets.map(t => {
    const n = deriveN(t, sysTok, pA, dA, oA);
    return decompose(sysTok, pA, n, dA, oA, pr, useCache).totalCost;
  });
  mkChart('chSens', {
    type: 'line',
    data: {
      labels: targets.map(t => fmtN(t)),
      datasets: [
        mkDS('Крупные шаги', sensB, 'rgb(245,158,11)',  [], false, 0),
        mkDS('Мелкие шаги',  sensA, 'rgb(129,140,248)', [], false, 0),
      ],
    },
    options: chartOpts(autoFmt(Math.max(...sensA, ...sensB)), 'Целевой контекст', { yMin: 0 }),
  });

  const dc = $('dynConclusion');
  const tokRatio = (simA.totalInput / simB.totalInput).toFixed(1);
  dc.innerHTML =
    `При целевом контексте <span class="hl">${fmtN(target)}</span> и системном промте <span class="hl">${fmtN(sysTok)}</span>:<br>` +
    `Крупные шаги: <span class="hl2">${nB}</span> итер. → <strong>${fmtCost(simB.totalCost)}</strong> ` +
    `(sys: ${fmtCost(simB.sysCost)}, data: ${fmtCost(simB.userCost)}, out: ${fmtCost(simB.outCost)}) ` +
    `· Σ ${fmtMT(simB.totalInput)} MTok input — <em>база</em><br>` +
    `Мелкие шаги: <span class="hl">${nA}</span> итер. → <strong>${fmtCost(simA.totalCost)}</strong> ` +
    `(sys: ${fmtCost(simA.sysCost)}, data: ${fmtCost(simA.userCost)}, out: ${fmtCost(simA.outCost)}) ` +
    `· Σ ${fmtMT(simA.totalInput)} MTok input<br>` +
    `Мелкие шаги обработали в <strong>${tokRatio}×</strong> больше input-токенов.` +
    (bWins
      ? ` <span style="color:var(--red)">Переплата: +${fmtCost(Math.abs(overpay))} (+${overPayPct}% к базе).</span>`
      : ` <span class="hlg">Мелкие шаги дешевле на ${fmtCost(Math.abs(overpay))}.</span>`) +
    (simB.cumCrossover ? `<br>Σ Crossover крупных: N = ${simB.cumCrossover}.` : '') +
    (simA.cumCrossover ? ` Σ Crossover мелких: N = ${simA.cumCrossover}.` : '');

  store.save();
}
window.update = update;

window.addEventListener('load', () => {
  store.load();
  SLIDERS.forEach(sv);
  update();
});
