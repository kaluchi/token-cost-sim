/** Number/cost formatters — shared between CLI and browser */

export const fmtN = n =>
  n >= 1e6 ? (n / 1e6).toFixed(2) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k'
  : n.toFixed(0);

export const fmtMT = n => (n / 1e6).toFixed(3);

export const fmtCost = n =>
  '$' + (n < 0.005 ? n.toFixed(3)
    : n >= 100 ? n.toFixed(0)
    : n.toFixed(2));
