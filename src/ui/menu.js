import fs from 'node:fs';
import { getConfig, saveConfig, wsName, nestedIn, ELSE } from '../config.js';
import { projectDir, relPath, pathKey } from '../paths.js';
import { TAGLINE } from '../text.js';
import { globalFolders, workspaceFolders, outsideFolders, sessionCount, removeFolder, removeSessions } from '../sessions.js';
import { openFolder as defaultOpen } from '../open.js';
import { T, RESET, header, hintLine, fit, step, paint, confirm, readLine } from './common.js';
import { renderTabs } from './tabs.js';
import { LIVE } from './term.js';

const BLINK_MS = 530;
const PLACEHOLDER = 'type to search...';

// Two hint lines. Row 1 = what acts on a project; row 2 = navigation and global. Search focus types; list focus runs one-key actions.
const HINT_SEARCH = ['Type to search | Esc clear | ↓ choose a project', '←/→ tab | ↑/↓ move | ^N new project | ^S settings | ^C quit | ● = has session(s)'];
const HINT_LIST = ['Enter continue | n new session | e explore | d delete', '←/→ tab | ↑/↓ move | ^N new project | ^S settings | ^C quit | ● = has session(s)'];

/**
 * Main menu: one tab per workspace, then "Everything else".
 * Resolves to {kind:'folder',path,mode:'continue'|'new'} | {kind:'new',name,root} | {kind:'settings'} | null (quit).
 * @param {object} term
 * `memo` carries the selected project and search text between calls: written when the menu is left, read to come back to the same row.
 * @param {{workspaces:{path:string,name?:string}[], view?:string, status?:string, memo?:{path?:string,query?:string}, openFolder?:(p:string)=>void}} opts
 */
export async function selectEntry(term, { workspaces, view = '', status: initialStatus = '', memo = {}, openFolder = defaultOpen }) {
  const tabs = [...workspaces.map((w, i) => ({ id: `w${i}`, ws: w, label: wsName(w) })), { id: ELSE, ws: null, label: 'Everything else' }];
  let tab = Math.max(0, tabs.findIndex((t) => (t.ws ? pathKey(t.ws.path) === pathKey(view) : view === ELSE)));   // unknown view: first tab
  const cache = {};                       // tab id -> folder list, loaded on first visit
  let all = null;                         // one scan of every session dir serves every tab
  let base = [];                          // every folder of the tab
  let items = [];                         // base filtered by the search text
  let query = '';
  let focus = 'search';                   // 'search' | 'list'
  let caretOn = true;                     // blink phase of the search caret
  let leafLen = 0;
  let cur = 0;
  let off = 0;
  let status = initialStatus;
  let page = 3;
  let footerRow = 0;

  const ws = () => tabs[tab].ws;           // null on the "Everything else" tab
  const id = () => tabs[tab].id;
  const load = () => {
    if (!cache[id()]) {
      all ??= globalFolders();
      cache[id()] = ws() ? workspaceFolders(ws().path, all, nestedIn(workspaces, ws())) : outsideFolders(workspaces.map((w) => w.path), all);
    }
    base = cache[id()].map((f) => ({
      name: f.name, leaf: ws() ? '' : f.leaf, parent: ws() ? '' : f.parent,
      path: f.path, projDir: f.projDir, session: f.sessions > 0,
    }));
    leafLen = ws() ? 0 : Math.max(0, ...base.map((i) => i.leaf.length));
    query = ''; focus = 'search';
    refilter();
  };

  // Case-insensitive: names starting with the text first, then the rest that contain it. Order within each group is kept.
  function refilter() {
    const q = query.toLowerCase();
    if (!q) items = base;
    else {
      const key = (i) => (i.leaf || i.name).toLowerCase();
      const hay = (i) => `${i.name} ${i.leaf} ${i.parent}`.toLowerCase();
      const starts = base.filter((i) => key(i).startsWith(q));
      items = [...starts, ...base.filter((i) => !starts.includes(i) && hay(i).includes(q))];
    }
    cur = 0; off = 0;
  }
  load();
  if (memo.path) {                        // back from a project: same search, same row (found by path: the list is re-sorted by recency)
    query = memo.query || '';
    refilter();
    const at = items.findIndex((i) => pathKey(i.path) === pathKey(memo.path));
    if (at >= 0) { focus = 'list'; cur = at; }
  }

  // One frame. Layout-dependent values (page size, footer row) are derived here from what is drawn.
  const draw = () => {
    const w = term.width - 1;
    const lines = header(TAGLINE);
    lines.push(renderTabs(tabs.map((t) => t.label), tab, w));
    const tag = ws() ? ws().path : 'All Claude Code sessions outside your workspaces';
    const empty = items.length ? ''
      : query ? 'No match.'
      : ws() ? 'No projects yet. Press ^N to start one.'
      : 'Nothing here yet. Run claude in any folder and it shows up here.';
    const searching = focus === 'search';
    const caret = searching ? (caretOn ? `${T.clay}█${RESET}${T.gray}` : ' ') : '';
    const box = query ? `${query}${caret}`
      : searching && caretOn ? `${T.clay}\x1b[7m${PLACEHOLDER[0]}${RESET}${T.faint}${PLACEHOLDER.slice(1)}${RESET}`   // block caret (inverse) over the first letter
      : `${T.faint}${PLACEHOLDER}${RESET}`;
    lines.push(`${T.dim} ${tag}${RESET}`, `${T.gray} Search: ${box}${RESET}`, `${T.dim} ${empty}${RESET}`);

    page = Math.max(3, Math.min(items.length, term.height - lines.length - 4));   // rows: list + blank + 2 hint lines
    cur = Math.min(cur, Math.max(0, items.length - 1));
    off = Math.max(0, Math.min(off, items.length - page));
    if (cur < off) off = cur; else if (cur >= off + page) off = cur - page + 1;
    const leafW = !ws() ? Math.min(leafLen, Math.max(10, Math.min(30, Math.floor((w - 4 - 2) / 2)))) : 0;

    for (let row = 0; row < page; row++) {
      const i = off + row;
      if (i >= items.length) { lines.push(''); continue; }
      const it = items[i];
      const prefix = `${String(i + 1).padStart(3)}. `;
      let leaf = it.leaf;
      if (leaf && leaf.length > leafW) leaf = `${leaf.slice(0, leafW - 1)}…`;
      let rest = leaf ? (it.parent ? ` ${leaf.padEnd(leafW)}  ${it.parent}` : ` ${leaf}`) : ` ${it.name}`;
      rest = fit(rest, w - prefix.length - 1);                                   // 1 = session mark column
      const lead = it.leaf ? rest.slice(0, Math.max(leaf.length, leafW) + 1) : rest;
      const tail = rest.slice(lead.length);
      if (i === cur && focus === 'list') {
        lines.push(`${T.clay}${prefix}${it.session ? '●' : ' '}${lead}${tail}${RESET}`);   // orange text, no background
      } else {
        const mark = it.session ? `${T.cyan}●${T.gray}` : ' ';
        lines.push(`${T.gray}${prefix}${mark}${lead}${it.leaf ? T.dim : T.gray}${tail}${RESET}`);
      }
    }
    lines.push('');
    const [h1, h2] = focus === 'search' ? HINT_SEARCH : HINT_LIST;
    lines.push(hintLine(h1, '', w));
    footerRow = lines.length;                // prompts and status take the second hint line
    lines.push(hintLine(h2, status, w));
    paint(term, lines);
  };

  const prune = (it) => {                  // workspace tab: deleting a folder also drops the deeper session folders under it
    const survives = (p) => (ws() ? relPath(p, it.path) === null : pathKey(p) !== pathKey(it.path));
    cache[id()] = cache[id()].filter((f) => survives(f.path));
    base = base.filter((x) => survives(x.path));
    items = items.filter((x) => survives(x.path));
  };

  const doDelete = async () => {
    const it = items[cur];
    const n = sessionCount(it.path);
    const width = term.width - 1;
    const q = !ws()
      ? `Delete ${n} Claude session(s) of '${it.leaf}'? The folder is kept. [y/N] `   // leaf: a full path would push the message off-screen
      : `Delete '${it.name}' and ${n} Claude session(s)? This cannot be undone. [y/N] `;
    if (!(await confirm(term, footerRow, width, q))) return;
    const err = !ws() ? removeSessions(it.path, it.projDir) : removeFolder(it.path, ws().path, workspaces.map((x) => x.path));
    status = err || (!ws() ? `Deleted sessions of ${it.name}` : `Deleted ${it.name}`);
    const gone = !ws() ? !fs.existsSync(it.projDir || projectDir(it.path)) : !fs.existsSync(it.path);
    if (gone) prune(it);
  };

  draw();
  for (;;) {
    const k = await term.readKey(focus === 'search' ? { ...LIVE, timeout: BLINK_MS } : LIVE);
    if (k.name === 'tick') { caretOn = !caretOn; draw(); continue; }
    caretOn = true;                                        // a key press shows the caret solid
    status = '';
    const last = Math.max(0, items.length - 1);
    let wantDelete = false;
    let wantNew = false;
    const inList = focus === 'list';
    const c = k.name === 'char' && inList ? k.ch.toLowerCase() : '';
    const remember = () => { memo.path = inList ? items[cur]?.path : null; memo.query = query; };
    const pick = (mode) => { remember(); return { kind: 'folder', path: items[cur].path, mode }; };
    const settings = () => { remember(); return { kind: 'settings' }; };
    switch (k.name) {
      case 'down':
        if (!inList) { if (items.length) { focus = 'list'; cur = 0; } } else cur = step(cur, items.length, 'down');
        break;
      case 'up':
        if (inList && cur === 0) focus = 'search';
        else if (inList) cur--;
        break;
      case 'home': if (inList) cur = 0; break;
      case 'end': if (inList) cur = last; break;
      case 'pageup': if (inList) cur = Math.max(0, cur - page); break;
      case 'pagedown': if (inList) cur = Math.min(last, cur + page); break;
      case 'enter': if (inList && items.length) return pick('continue'); break;
      case 'ctrl-enter': if (inList && items.length) return pick('new'); break;
      case 'escape': if (query) { query = ''; refilter(); } break;
      case 'ctrl-s': return settings();
      case 'ctrl-n': wantNew = true; break;
      case 'backspace':
        if (inList) focus = 'search';                       // back to the search field
        else if (query) { query = query.slice(0, -1); refilter(); }
        break;
      case 'left': case 'right': {
        tab = (tab + (k.name === 'right' ? 1 : tabs.length - 1)) % tabs.length;
        load();
        saveConfig({ ...getConfig(), view: ws() ? ws().path : ELSE });               // remember the last used view
        break;
      }
      case 'char': case 'space':
        if (!inList) { query += k.ch; refilter(); }
        else if (c === 'd') wantDelete = true;
        else if (c === 'n') { if (items.length) return pick('new'); }
        else if (c === 'e') { if (items.length || ws()) openFolder(items.length ? items[cur].path : ws().path); }   // nothing listed: workspace
        else if (c === 's') return settings();
        break;
      default:
    }
    if (wantNew && !ws()) status = workspaces.length ? 'Switch to a workspace tab to start a project' : 'Add a workspace in Settings first';
    else if (wantNew) {
      const t = await readLine(term, footerRow, term.width - 1, 'New project (Esc to cancel)');
      if (t && t.trim()) return { kind: 'new', name: t, root: ws().path };
    }
    if (wantDelete && items.length) await doDelete();
    draw();                          // re-derives page size, cursor/scroll clamps and the footer row from the new state
  }
}
