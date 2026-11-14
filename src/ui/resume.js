import { TAGLINE, timeAgo, formatSize } from '../text.js';
import { openFolder as defaultOpen } from '../open.js';
import { removeSession } from '../sessions.js';
import { runningSessions } from '../cleanup.js';
import { T, RESET, header, hintLine, fit, step, paint, confirm } from './common.js';

const HINT = '↑/↓ move | Enter resume | n new session | e explore | d delete | Esc/Bksp back | ^C quit';
const AGE_W = 14;        // "59 minutes ago"
const SIZE_W = 9;        // "1023.9 KB"
const ROWS = 3;          // per session: name, id + age + size, blank

const clip = (s, width) => (s.length > width ? `${s.slice(0, Math.max(0, width - 3))}...` : s);

/**
 * Session picker for one folder: newest first, three rows each.
 * Resolves to {id} (resume it) | {id:null} (new session) | null (back, or the last session was deleted).
 * `d` deletes the highlighted session after a y/N; a session that is running is refused.
 * @param {object} term
 * @param {{dir:string, sessions:{id:string,title:string,mtime:Date,size:number}[]}} opts
 */
export async function showResume(term, { dir, sessions: initial, openFolder = defaultOpen, running = runningSessions, remove = (id) => removeSession(dir, id) }) {
  let sessions = [...initial];
  let status = '';
  let cur = 0;
  let off = 0;
  let page = 1;

  const draw = () => {
    const w = term.width - 1;
    const lines = header(TAGLINE);
    lines.push(`${T.dim} Sessions in ${fit(dir, w - 13)}${RESET}`, '');
    page = Math.max(1, Math.min(sessions.length, Math.floor((term.height - lines.length - 2) / ROWS)));
    if (cur < off) off = cur; else if (cur >= off + page) off = cur - page + 1;
    off = Math.max(0, Math.min(off, sessions.length - page));
    for (let i = off; i < off + page; i++) {
      const s = sessions[i];
      const prefix = `${String(i + 1).padStart(3)}. `;
      const pad = ' '.repeat(prefix.length);
      const title = clip(s.title || '(untitled)', w - prefix.length);
      const meta = fit(`${timeAgo(s.mtime).padEnd(AGE_W)} · ${formatSize(s.size).padEnd(SIZE_W)} · ${s.id}`, w - prefix.length);
      lines.push(`${i === cur ? T.clay : T.gray}${prefix}${title}${RESET}`, `${T.dim}${pad}${meta}${RESET}`, '');   // only the name highlights
    }
    lines.push(hintLine(HINT, status, w));
    paint(term, lines);
  };

  const deleteCurrent = async () => {
    const s = sessions[cur];
    if (running().some((r) => r.sessionId === s.id)) return 'Session is running. Close it first.';
    const q = `Delete session ${s.id}? This cannot be undone. [y/N] `;
    if (!(await confirm(term, term.height - 1, term.width - 1, q))) return '';
    const err = remove(s.id);
    if (err) return err;
    sessions = sessions.filter((x) => x !== s);
    cur = Math.min(cur, sessions.length - 1);
    return 'Session deleted';
  };

  draw();
  for (;;) {
    const k = await term.readKey({ live: true });
    status = '';
    const last = sessions.length - 1;
    switch (k.name) {
      case 'up': case 'down': cur = step(cur, sessions.length, k.name); break;
      case 'home': cur = 0; break;
      case 'end': cur = last; break;
      case 'pageup': cur = Math.max(0, cur - page); break;
      case 'pagedown': cur = Math.min(last, cur + page); break;
      case 'enter': return { id: sessions[cur].id };
      case 'escape': case 'backspace': return null;
      case 'char':
        if (k.ch.toLowerCase() === 'n') return { id: null };
        if (k.ch.toLowerCase() === 'e') openFolder(dir);
        if (k.ch.toLowerCase() === 'd') {
          status = await deleteCurrent();
          if (!sessions.length) return null;      // nothing left to pick: back to the menu
        }
        break;
      default:
    }
    draw();
  }
}
