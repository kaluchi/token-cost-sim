/**
 * Экономика агента vs. one-shot RAG
 *
 * Фрейминг:
 *   AGENT  — загружает bootstrap-контекст (доки, инструкции) один раз в кэш,
 *            затем итерирует: ищет, вызывает инструменты, проверяет результат.
 *            Кэш-скидка на bootstrap = "дешёвый бутстрап до боеготовности".
 *
 *   RAG    — одним большим вызовом: ретривер достаёт нужные куски, модель
 *            отвечает на основе этого контекста. Нет итераций, нет инструментов.
 *
 * Вопрос: до какого N итераций агент остаётся дешевле RAG?
 */
import { simulate } from './src/core/simulate.js';
import { MODELS } from './src/core/models.js';
import { fmtCost, fmtN } from './src/core/format.js';

const args     = process.argv.slice(2);
const modelKey = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'sonnet';
const PR = MODELS[modelKey] ?? MODELS.sonnet;

// ─── Helpers ──────────────────────────────────────────────────────
const line = (c = '─', n = 76) => c.repeat(n);
const col  = (s, w) => String(s).padEnd(w);

function ragCost({ docs, query = 500, answer = 3000 }, pr = PR) {
  return (docs + query) * pr.input / 1e6 + answer * pr.output / 1e6;
}

function agentCost({ bootstrap, iterations, toolResult = 3000,
                     userMsg = 300, modelOutput = 1500 }, pr = PR) {
  return simulate(
    { initialContext: bootstrap, numTurns: iterations,
      userMsg, toolResult, modelOutput },
    pr, /* useCache = */ true
  ).totalCost;
}

/** Маржинальная стоимость одной дополнительной итерации агента (после первой) */
function marginalCost({ bootstrap, toolResult = 3000, userMsg = 300, modelOutput = 1500 }, pr = PR) {
  const newIn  = userMsg + toolResult;
  const cached = bootstrap * pr.cacheRead / 1e6;   // bootstrap из кэша
  const fresh  = newIn    * pr.input    / 1e6;
  const out    = modelOutput * pr.output  / 1e6;
  return cached + fresh + out;
}

/** Находит N при котором agentCost впервые превышает ragCost */
function findBreakeven(agentParams, ragParams, pr = PR) {
  const rag = ragCost(ragParams, pr);
  for (let n = 1; n <= 200; n++) {
    const agent = agentCost({ ...agentParams, iterations: n }, pr);
    if (agent > rag) return { n, rag, agent };
  }
  return { n: '>200', rag, agent: agentCost({ ...agentParams, iterations: 200 }, pr) };
}

// ─── Scenarios ────────────────────────────────────────────────────
const SCENARIOS = [
  {
    name: 'Отладка кода (небольшой проект)',
    rag:   { docs: 50_000,  query: 1_000, answer: 3_000 },
    agent: { bootstrap: 25_000,  toolResult: 2_000, userMsg: 300, modelOutput: 1_000 },
    note: 'RAG тянет 50k релевантного кода → ответ. Агент: 25k curated context + bash/grep инструменты.',
  },
  {
    name: 'Анализ документации / исследование',
    rag:   { docs: 150_000, query: 1_000, answer: 5_000 },
    agent: { bootstrap: 80_000,  toolResult: 5_000, userMsg: 500, modelOutput: 2_500 },
    note: 'RAG тянет 150k docs → синтез. Агент: 80k index + итеративный поиск + synthesis.',
  },
  {
    name: 'Реализация фичи в большом кодовом репо',
    rag:   { docs: 300_000, query: 2_000, answer: 8_000 },
    agent: { bootstrap: 150_000, toolResult: 8_000, userMsg: 800, modelOutput: 3_000 },
    note: 'RAG тянет 300k кода → одна реализация. Агент: 150k архитектурного контекста + тест-итерации.',
  },
  {
    name: 'Задача с большим исходным контекстом (ваш кейс: 200k → 400k)',
    rag:   { docs: 200_000, query: 1_000, answer: 5_000 },
    agent: { bootstrap: 250_000, toolResult: 12_000, userMsg: 500, modelOutput: 3_000 },
    note: 'Ctx2 из симулятора: bootstrap 250k, мало итераций с крупными tool calls.',
  },
];

// ─── Print ────────────────────────────────────────────────────────
console.log('\n' + line('═'));
console.log(` AGENT vs ONE-SHOT RAG — экономический анализ   (${PR.name} + Prompt Caching)`);
console.log(line('═'));

for (const sc of SCENARIOS) {
  const rag   = ragCost(sc.rag);
  const mc    = marginalCost(sc.agent);
  const be    = findBreakeven(sc.agent, sc.rag);

  // cost at key iteration counts
  const costs = [1, 2, 3, 5, 8, 10, 15, 20, 30].map(n => ({
    n, cost: agentCost({ ...sc.agent, iterations: n }),
  }));

  // cost per "additional search step" beyond bootstrap
  const firstTurn  = agentCost({ ...sc.agent, iterations: 1 });
  const bootstrap  = firstTurn;     // 1 iter = just the bootstrap turn
  const perIterAfter = mc;

  console.log('\n' + line());
  console.log(` ${sc.name}`);
  console.log(line());
  console.log(` ${sc.note}`);
  console.log();
  console.log(` RAG (1 вызов)    : ${fmtCost(rag).padEnd(10)}  docs=${fmtN(sc.rag.docs)}, answer=${fmtN(sc.rag.answer)}`);
  console.log(` Agent turn 1     : ${fmtCost(firstTurn).padEnd(10)}  bootstrap=${fmtN(sc.agent.bootstrap)} (кэш пишется)`);
  console.log(` Agent marginal   : ${fmtCost(perIterAfter).padEnd(10)}  стоимость КАЖДОЙ дополнительной итерации (кэш читается)`);
  console.log(` Bootstrap кэш-скидка: ${fmtCost(sc.agent.bootstrap * (PR.input - PR.cacheRead) / 1e6).padEnd(10)}  экономия на bootstrap со 2-й итерации`);
  console.log();

  // Table
  console.log(` ${col('N итер.',8)} ${col('Агент $',11)} ${col('vs RAG',12)} ${col('за шаг',10)} Статус`);
  console.log(' ' + line('─', 65));
  for (const { n, cost } of costs) {
    const diff     = cost - rag;
    const diffStr  = (diff >= 0 ? '+' : '') + fmtCost(diff);
    const perStep  = fmtCost(cost / n);
    const status   = cost < rag ? '✓ дешевле RAG' : cost === rag ? '= паритет' : '✗ дороже RAG';
    console.log(` ${col(n,8)} ${col(fmtCost(cost),11)} ${col(diffStr,12)} ${col(perStep,10)} ${status}`);
  }

  console.log();
  if (typeof be.n === 'number') {
    console.log(` ► Break-even: агент дороже RAG при N ≥ ${be.n} итераций`);
    console.log(`   Агент может сделать до ${be.n - 1} итераций поиска/проверки — и всё ещё дешевле RAG.`);
  } else {
    console.log(` ► Агент ВСЕГДА дешевле RAG (даже при 200 итерациях) — RAG слишком дорог.`);
    console.log(`   При 200 итерациях агент стоит ${fmtCost(be.agent)} vs RAG ${fmtCost(be.rag)}`);
  }

  // Formula breakdown
  const N = typeof be.n === 'number' ? be.n - 1 : 200;
  const agAtN = agentCost({ ...sc.agent, iterations: N });
  const cachedBootstrapPaid = sc.agent.bootstrap * PR.cacheRead / 1e6 * Math.max(0, N - 1);
  const bootstrapFullPaid   = sc.agent.bootstrap * PR.input   / 1e6;
  console.log();
  console.log(` Декомпозиция при N=${N} итераций:`);
  console.log(`   Bootstrap (turn 1, полная цена) : ${fmtCost(bootstrapFullPaid)}`);
  if (N > 1)
  console.log(`   Bootstrap (turn 2..${N}, из кэша): ${fmtCost(cachedBootstrapPaid)}  (x${(PR.cacheRead/PR.input).toFixed(2)} скидка)`);
  console.log(`   Tool calls + outputs суммарно   : ${fmtCost(agAtN - bootstrapFullPaid - cachedBootstrapPaid)}`);
  console.log(`   ИТОГО агент                     : ${fmtCost(agAtN)}`);
}

// ─── Sensitivity table ────────────────────────────────────────────
console.log('\n' + line('═'));
console.log(' ЧУВСТВИТЕЛЬНОСТЬ: break-even при разных bootstrap и RAG doc sizes');
console.log(` Агент: toolResult=5k, userMsg=500, modelOutput=2k. ${PR.name} + кэш.`);
console.log(line('═'));

const ragSizes  = [30_000, 80_000, 150_000, 300_000];
const bootSizes = [10_000, 50_000, 100_000, 200_000];

console.log('\n Break-even N (агент дороже RAG начиная с этого N). >200 = агент всегда дешевле.');
console.log();
console.log(' Bootstrap\\RAG docs' + ragSizes.map(r => col(fmtN(r) + ' rag', 14)).join(''));
console.log(' ' + line('─', 18 + ragSizes.length * 14));
for (const boot of bootSizes) {
  let row = ` ${col('boot=' + fmtN(boot), 18)}`;
  for (const ragDocs of ragSizes) {
    const be = findBreakeven(
      { bootstrap: boot, toolResult: 5_000, userMsg: 500, modelOutput: 2_000 },
      { docs: ragDocs, query: 500, answer: 3_000 }
    );
    row += col(String(be.n), 14);
  }
  console.log(row);
}

console.log('\n Вывод: с кэшированием бутстрап становится "вычтенным" фиксированным взносом.');
console.log(' Маржинальная стоимость итерации агента = cache_read(boot) + delta ≈ маленькая.');
console.log(' Это позволяет агенту делать от 5 до >200 итераций дешевле одного RAG-вызова.\n');
