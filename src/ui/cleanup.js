import { CATEGORIES, emptyScan, scanCleanup, planCleanup, executeCleanup, runningSessions } from '../cleanup.js';
import { T, RESET, header, hintLine, numberedRow, step, bar, isYes, fit, paint } from './common.js';
import { LIVE } from './term.js';

// "3 project(s), 1 backup file(s)": a count for every category.
const summarize = (count) => CATEGORIES.map((c) => `${count(c)} ${c.noun}`).join(', ');

// Scrollable preview of exactly what will be removed, ending in one red y/N bar. True = confirmed.
async function preview(term, plan) {
  const body = [];
  for (const c of CATEGORIES) {
    const items = plan.items[c.id];
    if (!items.length) continue;
    body.push(c.reviewTitle);
    for (const it of items) body.push(...c.reviewLines(it));
  }
  if (plan.skipped.length) {
    body.push('Skipped:');
    for (const s of plan.skipped) body.push(`  ${s}`);
  }
  for (const c of CATEGORIES) if (c.note && plan.items[c.id].length) body.push('', c.note);
  let off = 0;
  const q = `Delete ${summarize((c) => plan.items[c.id].length)}? This cannot be undone. [y/N] `;
  for (;;) {
    const w = term.width - 1;
    const lines = header('Settings › Cleanup › Review');
    const room = Math.max(1, term.height - lines.length - 2);
    off = Math.max(0, Math.min(off, body.length - room));
    for (let i = 0; i < room; i++) {
      const l = body[off + i];
      lines.push(l === undefined ? '' : `${/^\s/.test(l) ? T.dim : T.gray}${fit(l, w)}${RESET}`);
    }
    lines.push('', bar(q, w));
    paint(term, lines);
    const k = await term.readKey(LIVE);
    if (isYes(k)) return true;
    if (k.name === 'up') off--;
    else if (k.name === 'down') off++;
    else if (k.name === 'pageup') off -= room;
    else if (k.name === 'pagedown') off += room;
    else if (k.name !== 'resize') return false;
  }
}

/**
 * Settings > Cleanup: checkbox list -> review -> single y/N -> run.
 * `initial`: a scan the caller already has. Returns the latest scan when the page is left.
 */
export async function showCleanup(term, initial) {
  let status = 'Scanning…';
  let scan = initial ?? emptyScan();
  let running = [];
  let sel = {};                                // category id -> checked
  const unavailable = {};                      // category id -> why it cannot run
  let cur = 0;

  const reason = (c) => unavailable[c.id] || (scan[c.id].length ? '' : 'none found');

  const draw = () => {
    const w = term.width - 1;
    const lines = header('Settings › Cleanup');
    CATEGORIES.forEach((c, i) => {
      const why = reason(c);
      const box = why ? '[-]' : sel[c.id] ? '[x]' : '[ ]';
      const extra = why || c.hint(scan[c.id]);
      lines.push(numberedRow(i, `${box} ${c.title}: ${scan[c.id].length}${extra ? ` (${extra})` : ''}`, w, i === cur ? T.clay : why ? T.dim : T.gray));
    });
    if (running.length) lines.push('', `${T.yellow} Claude is running (${running.length} session(s)): close it to perform cleanup.${RESET}`);
    lines.push('', hintLine('↑/↓ move | Space toggle | Enter review | Esc/Bksp back | ^C quit', status, w));
    paint(term, lines);
  };

  const refresh = (found) => {
    scan = found;
    running = runningSessions();
    sel = Object.fromEntries(CATEGORIES.map((c) => [c.id, !reason(c)]));
  };

  draw();
  for (const c of CATEGORIES) {
    const why = c.unavailable?.();
    if (why) unavailable[c.id] = why;
  }
  refresh(initial ?? scanCleanup());
  status = '';
  for (;;) {
    draw();
    const k = await term.readKey(LIVE);
    status = '';
    const c = CATEGORIES[cur];
    if (k.name === 'escape' || k.name === 'backspace') return scan;
    if (k.name === 'up' || k.name === 'down') cur = step(cur, CATEGORIES.length, k.name);
    else if (k.name === 'space') { if (!reason(c)) sel[c.id] = !sel[c.id]; }
    else if (k.name === 'enter') {
      const ids = CATEGORIES.filter((x) => sel[x.id] && !reason(x)).map((x) => x.id);
      if (!ids.length) { status = 'Nothing selected'; continue; }
      if (running.length) { status = 'Claude is running. Close it first.'; continue; }
      status = 'Checking what will be removed…';
      draw();
      const plan = await planCleanup(scan, ids);
      status = '';
      if (!CATEGORIES.some((x) => plan.items[x.id].length)) { status = 'Nothing to remove'; refresh(scanCleanup()); continue; }
      if (!(await preview(term, plan))) continue;
      const res = executeCleanup(plan, (m) => { term.cursor(term.height - 1); term.write(`${T.yellow}${fit(m, term.width - 1).padEnd(term.width - 1)}${RESET}`); });
      refresh(scanCleanup());
      status = res.error
        || (res.failures.length ? `Done with ${res.failures.length} failure(s): ${res.failures[0]}`
          : `Removed ${summarize((x) => res.done[x.id])}`);
    }
  }
}
