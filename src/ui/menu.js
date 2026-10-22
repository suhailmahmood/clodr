import fs from 'node:fs';
import { getConfig, saveConfig, wsName, nestedIn, ELSE } from '../config.js';
import { projectDir, relPath, pathKey } from '../paths.js';
import { TAGLINE } from '../text.js';
import { globalFolders, workspaceFolders, outsideFolders, sessionCount, removeFolder, removeSessions } from '../sessions.js';
import { openFolder as defaultOpen } from '../open.js';
import { T, RESET, header, hintLine, fit, step, paint, confirm, readLine } from './common.js';
import { renderTabs } from './tabs.js';
import { LIVE } from './term.js';

const HINT = '←/→ tab | ↑/↓ move | Enter select | digits jump | n new | o open | s settings | Del/d delete | q quit | ● = session';

/**
 * Main menu: one tab per workspace, then "Everything else".
 * Resolves to {kind:'folder',path} | {kind:'new',name,root} | {kind:'settings'} | null (quit).
 * @param {object} term
 * @param {{workspaces:{path:string,name?:string}[], view?:string, openFolder?:(p:string)=>void}} opts
 */
export async function selectEntry(term, { workspaces, view = '', openFolder = defaultOpen }) {
  const tabs = [...workspaces.map((w, i) => ({ id: `w${i}`, ws: w, label: wsName(w) })), { id: ELSE, ws: null, label: 'Everything else' }];
  let tab = Math.max(0, tabs.findIndex((t) => (t.ws ? pathKey(t.ws.path) === pathKey(view) : view === ELSE)));   // unknown view: first tab
  const cache = {};                       // tab id -> folder list, loaded on first visit
  let all = null;                         // one scan of every session dir serves every tab
  let items = [];
  let leafLen = 0;
  let cur = 0;
  let off = 0;
  let buf = '';
  let status = '';
  let page = 3;
  let footerRow = 0;

  const ws = () => tabs[tab].ws;           // null on the "Everything else" tab
  const id = () => tabs[tab].id;
  const load = () => {
    if (!cache[id()]) {
      all ??= globalFolders();
      cache[id()] = ws() ? workspaceFolders(ws().path, all, nestedIn(workspaces, ws())) : outsideFolders(workspaces.map((w) => w.path), all);
    }
    items = cache[id()].map((f) => ({
      name: f.name, leaf: ws() ? '' : f.leaf, parent: ws() ? '' : f.parent,
      path: f.path, projDir: f.projDir, session: f.sessions > 0,
    }));
    leafLen = ws() ? 0 : Math.max(0, ...items.map((i) => i.leaf.length));
    cur = 0; off = 0; buf = '';
  };
  load();

  // One frame. Layout-dependent values (page size, footer row) are derived here from what is drawn.
  const draw = () => {
    const w = term.width - 1;
    const lines = header(TAGLINE);
    lines.push(renderTabs(tabs.map((t) => t.label), tab, w));
    const tag = ws() ? ws().path : 'All Claude Code sessions outside your workspaces';
    const empty = items.length ? ''
      : ws() ? 'No projects yet. Press n to start one.'
      : 'Nothing here yet. Run claude in any folder and it shows up here.';
    lines.push(`${T.dim} ${tag}${RESET}`, `${T.dim} ${empty}${RESET}`);

    page = Math.max(3, Math.min(items.length, term.height - lines.length - 3));   // rows: list + blank + hint
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
      if (i === cur) {
        lines.push(`${T.clay}${prefix}${it.session ? '●' : ' '}${lead}${tail}${RESET}`);   // orange text, no background
      } else {
        const mark = it.session ? `${T.cyan}●${T.gray}` : ' ';
        lines.push(`${T.gray}${prefix}${mark}${lead}${it.leaf ? T.dim : T.gray}${tail}${RESET}`);
      }
    }
    lines.push('');
    footerRow = lines.length;
    lines.push(hintLine(HINT, status, w));
    paint(term, lines);
  };

  const prune = (it) => {                  // workspace tab: deleting a folder also drops the deeper session folders under it
    const survives = (p) => (ws() ? relPath(p, it.path) === null : pathKey(p) !== pathKey(it.path));
    cache[id()] = cache[id()].filter((f) => survives(f.path));
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
    const k = await term.readKey(LIVE);
    status = '';
    if (!/^\d$/.test(k.ch)) buf = '';                      // a multi-digit jump ends at the first other key
    const last = Math.max(0, items.length - 1);
    let wantDelete = false;
    let wantNew = false;
    const c = k.name === 'char' ? k.ch.toLowerCase() : '';
    switch (k.name) {
      case 'up': case 'down': cur = step(cur, items.length, k.name); break;
      case 'home': cur = 0; break;
      case 'end': cur = last; break;
      case 'pageup': cur = Math.max(0, cur - page); break;
      case 'pagedown': cur = Math.min(last, cur + page); break;
      case 'enter': if (items.length) return { kind: 'folder', path: items[cur].path }; break;
      case 'delete': wantDelete = true; break;
      case 'left': case 'right': {
        tab = (tab + (k.name === 'right' ? 1 : tabs.length - 1)) % tabs.length;
        load();
        saveConfig({ ...getConfig(), view: ws() ? ws().path : ELSE });               // remember the last used view
        break;
      }
      default:
        if (c === 'q') return null;
        else if (c === 'd') wantDelete = true;
        else if (/^\d$/.test(c)) {
          const tryN = Number(buf + c);
          if (tryN >= 1 && tryN <= items.length) { buf += c; cur = tryN - 1; }
          else if (Number(c) >= 1 && Number(c) <= items.length) { buf = c; cur = Number(c) - 1; }
        }
        else if (c === 'n') wantNew = true;
        else if (c === 'o') { if (items.length || ws()) openFolder(items.length ? items[cur].path : ws().path); }   // nothing listed: workspace
        else if (c === 's') return { kind: 'settings' };
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
