import { TAGLINE, timeAgo, formatSize } from '../text.js';
import { openFolder as defaultOpen } from '../open.js';
import { removeSession } from '../sessions.js';
import { PRICED_AS_OF, formatCost } from '../pricing.js';
import { runningSessions } from '../cleanup.js';
import { T, RESET, header, hintLine, rowNumber, fit, step, paint, confirm } from './common.js';
import { LIVE } from './term.js';

const HINT = '↑/↓ move | Enter resume | n new session | e explore | d delete | Esc/Bksp back | ^C quit';
const AGE_W = 14;        // "59 minutes ago"
const SIZE_W = 9;        // "1023.9 KB"
const COST_W = 9;        // "$1,234.56"
const ROWS = 3;          // per session: name, age + size + cost + id, blank
const PRICING_NOTE = `Costs estimated using Claude API pricing from ${PRICED_AS_OF.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

const clip = (s, width) => (s.length > width ? `${s.slice(0, Math.max(0, width - 3))}...` : s);

/**
 * Session picker for one folder: newest first, three rows each.
 * Resolves to {id} (resume it) | {id:null} (new session) | null (back, or the last session was deleted).
 * `d` deletes the highlighted session after a y/N; a session that is running is refused.
 * `status` is shown in the hint line until the first key.
 * @param {object} term
 * @param {{dir:string, sessions:{id:string,title:string,mtime:Date,size:number,cost:number}[], status?:string}} opts
 */
export async function showResume(term, { dir, sessions: initial, status: initialStatus = '', openFolder = defaultOpen, running = runningSessions, remove = (id) => removeSession(dir, id) }) {
  let sessions = [...initial];
  let status = initialStatus;
  let cur = 0;
  let off = 0;
  let page = 1;
  let hintRow = 0;

  const draw = () => {
    const w = term.width - 1;
    const lines = header(TAGLINE);
    const label = ' Sessions in ';
    const total = ` · ${formatCost(sessions.reduce((sum, s) => sum + s.cost, 0))} total`;
    lines.push(`${T.dim}${label}${fit(dir, w - label.length - total.length)}${total}${RESET}`, '');
    page = Math.max(1, Math.min(sessions.length, Math.floor((term.height - lines.length - 3) / ROWS)));
    if (cur < off) off = cur; else if (cur >= off + page) off = cur - page + 1;
    off = Math.max(0, Math.min(off, sessions.length - page));
    for (let i = off; i < off + page; i++) {
      const s = sessions[i];
      const prefix = rowNumber(i);
      const title = clip(s.title || '(untitled)', w - prefix.length);
      const meta = fit(`${timeAgo(s.mtime).padEnd(AGE_W)} · ${formatSize(s.size).padEnd(SIZE_W)} · ${formatCost(s.cost).padEnd(COST_W)} · ${s.id}`, w - prefix.length);
      lines.push(`${i === cur ? T.clay : T.gray}${prefix}${title}${RESET}`, `${T.dim}${' '.repeat(prefix.length)}${meta}${RESET}`, '');   // only the name highlights
    }
    hintRow = lines.length;
    lines.push(hintLine(HINT, status, w), `${T.dim}${fit(PRICING_NOTE, w)}${RESET}`);
    paint(term, lines);
  };

  const deleteCurrent = async () => {
    const s = sessions[cur];
    if (running().some((r) => r.sessionId === s.id)) return 'Session is running. Close it first.';
    if (!(await confirm(term, hintRow, `Delete session ${s.id}? This cannot be undone. [y/N] `))) return '';
    const err = remove(s.id);
    if (err) return err;
    sessions = sessions.filter((x) => x !== s);
    cur = Math.min(cur, sessions.length - 1);
    return 'Session deleted';
  };

  draw();
  for (;;) {
    const k = await term.readKey(LIVE);
    status = '';
    const last = sessions.length - 1;
    const c = k.name === 'char' ? k.ch.toLowerCase() : '';
    switch (k.name) {
      case 'up': case 'down': cur = step(cur, sessions.length, k.name); break;
      case 'home': cur = 0; break;
      case 'end': cur = last; break;
      case 'pageup': cur = Math.max(0, cur - page); break;
      case 'pagedown': cur = Math.min(last, cur + page); break;
      case 'enter': return { id: sessions[cur].id };
      case 'escape': case 'backspace': return null;
      case 'char':
        if (c === 'n') return { id: null };
        if (c === 'e') openFolder(dir);
        else if (c === 'd') {
          status = await deleteCurrent();
          if (!sessions.length) return null;      // nothing left to pick: back to the menu
        }
        break;
      default:
    }
    draw();
  }
}
