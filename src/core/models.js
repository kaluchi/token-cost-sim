/**
 * Pricing in $/MTok — Claude 4.x family (May 2026)
 * Cache Write: 5-min TTL = 1.25× input; 1-hour TTL = 2× input (cacheWrite stores 5-min rate)
 * Source: platform.claude.com/docs/about-claude/models
 */
export const MODELS = {
  sonnet: { name: 'Claude Sonnet 4.6', input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  opus:   { name: 'Claude Opus 4.7',   input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  haiku:  { name: 'Claude Haiku 4.5',  input: 1.00, output:  5.00, cacheRead: 0.10, cacheWrite: 1.25 },
};

/** @typedef {{ input: number, output: number, cacheRead: number, cacheWrite: number }} Pricing */
/** @typedef {keyof typeof MODELS} ModelKey */
