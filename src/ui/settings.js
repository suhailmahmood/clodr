import { getConfig } from '../config.js';
import { CATEGORIES, scanCleanup } from '../cleanup.js';
import { header, hintLine, numberedRow, step, paint, T } from './common.js';
import { LIVE } from './term.js';
import { showCleanup } from './cleanup.js';
import { showWorkspaces } from './workspaces.js';

const tally = (found) => CATEGORIES.map((c) => `${found[c.id].length} ${c.tally}`).join(', ');

// Sub-pages of Settings, in display order. state = what the pages share: the latest cleanup scan.
const PAGES = [
  {
    label: () => { const n = getConfig().workspaces.length; return `Manage workspaces (${n} workspace${n === 1 ? '' : 's'})`; },
    run: (term) => showWorkspaces(term),
  },
  {
    label: (state) => `Cleanup: ${tally(state.counts)} (Enter to review / delete)`,
    run: async (term, state) => { state.counts = await showCleanup(term, state.counts); },
  },
];

/** Settings screen: a menu of sub-pages. */
export async function showSettings(term) {
  let cur = 0;
  const state = { counts: scanCleanup() };      // scans every session dir: done on entry; Cleanup hands back a fresh one

  const draw = () => {
    const w = term.width - 1;
    const lines = header('Settings');
    PAGES.forEach((p, i) => lines.push(numberedRow(i, p.label(state), w, i === cur ? T.clay : T.gray)));
    lines.push('', hintLine('↑/↓ move | Enter open | Esc back', '', w));
    paint(term, lines);
  };

  draw();
  for (;;) {
    const k = await term.readKey(LIVE);
    if (k.name === 'up' || k.name === 'down') cur = step(cur, PAGES.length, k.name);
    else if (k.name === 'escape') return;
    else if (k.name === 'enter') await PAGES[cur].run(term, state);
    draw();
  }
}
