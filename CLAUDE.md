# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server (hot reload)
npm run build        # Production build → dist/
npm test             # Run all tests (vitest run)
npm run test:watch   # Watch mode
npx vitest run tests/simulate.test.js  # Single test file

node simulate.js                 # CLI: Ctx1 vs Ctx2 comparison
node simulate.js --no-cache      # CLI without prompt caching
node simulate.js --model opus    # CLI with different model
node analysis.js                 # CLI: Agent vs RAG analysis
```

## Architecture

**Two execution targets from one core:**
- `src/core/` — pure functions, no DOM, shared by both CLI and browser
- `src/web/` — browser UI (Chart.js charts, sliders, localStorage persistence)
- `simulate.js`, `analysis.js` — Node CLI scripts importing the same core

**Core engine (`src/core/simulate.js`):**
The `simulate()` function models stateless LLM API cost: each turn pays for the full accumulated context. Key insight: N turns with δ tokens/turn → total input ≈ δ·N²/2 (quadratic). With prompt caching, turns 1+ read previous context at ~10% price (cacheRead rate).

Analytics sweeps (`sweepBreakeven`, `sweepGranularity`, `sweepFixedContext`, `sweepROI`, `findCrossover`) are also in this file and used by both CLI and browser.

**Pricing (`src/core/models.js`):** Claude model pricing in $/MTok. Three presets: sonnet, opus, haiku.

**Web pages — each is independent:**
Each HTML page in `pages/` loads one JS entry from `src/web/` that owns its sliders, charts, and update loop. All four pages follow the same pattern: `loadFromStorage()` → `sv()` (sync slider labels) → `update()` (recompute + redraw). The `update()` function is exposed on `window` and called from inline `oninput`/`onchange` handlers.

**Vite config:** multi-page build with `base: '/token-cost-sim/'` for GitHub Pages. All five HTML files are explicit rollup inputs.

## Language

All UI text, comments, and variable names for display are in Russian. Code identifiers are English.

## Visualization order convention

When showing cost comparisons: show full-price first, then cached. Never label cached savings as "экономия" — show it as the actual cached cost.
