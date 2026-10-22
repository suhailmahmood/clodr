import { T, RESET } from './common.js';

const MAX_LABEL = 20;

// Tab bar line. When all tabs do not fit, shows a window around the active one with ‹ / › for the hidden ones.
export function renderTabs(labels, active, width) {
  const lab = labels.map((l) => (l.length > MAX_LABEL ? `${l.slice(0, MAX_LABEL - 1)}…` : l));
  const last = lab.length - 1;
  const span = (a, b) => lab.slice(a, b + 1).reduce((n, l) => n + l.length + 3, 0) - 3 + (a > 0 ? 2 : 0) + (b < last ? 2 : 0);
  let lo = active;
  let hi = active;
  for (let grew = true; grew;) {
    grew = false;
    if (hi < last && span(lo, hi + 1) <= width - 1) { hi++; grew = true; }
    if (lo > 0 && span(lo - 1, hi) <= width - 1) { lo--; grew = true; }
  }
  const shown = lab.slice(lo, hi + 1).map((l, j) => (lo + j === active ? `${T.clay}${T.bold}${T.under}${l.slice(0, width - 1)}${RESET}` : `${T.gray}${l}${RESET}`));
  return ` ${lo > 0 ? `${T.dim}‹${RESET} ` : ''}${shown.join('   ')}${hi < last ? ` ${T.dim}›${RESET}` : ''}`;
}
