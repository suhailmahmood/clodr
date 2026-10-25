import fs from 'node:fs';
import path from 'node:path';
import { getConfig, saveConfig, wsName, makeWorkspace } from '../config.js';
import { trimSep, pathKey, expandPath } from '../paths.js';
import { WIN } from '../platform.js';
import { T, RESET, header, hintLine, numberedRow, step, paint, readLine, confirm } from './common.js';
import { LIVE } from './term.js';

/** Settings > Manage workspaces: add / rename / remove / reorder, saved at once. */
export async function showWorkspaces(term) {
  const config = getConfig();
  const list = config.workspaces;
  let cur = 0;
  let status = '';
  let footerRow = 0;

  const rows = () => list.map((w) => `${wsName(w)} - ${w.path}`);

  const draw = () => {
    const w = term.width - 1;
    const lines = header('Settings › Workspaces');
    rows().forEach((r, i) => lines.push(numberedRow(i, r, w, i === cur ? T.clay : T.gray)));
    if (!list.length) lines.push(`${T.dim} No workspaces yet. Press a to add one.${RESET}`);
    lines.push('');
    footerRow = lines.length;
    lines.push(hintLine(list.length ? '↑/↓ move | Ctrl+↑/↓ reorder | Enter rename | d remove | a add | Esc/Bksp back | ^C quit' : 'a add | Esc/Bksp back | ^C quit', status, w));
    paint(term, lines);
  };

  const save = () => saveConfig(config);

  const addWorkspace = async () => {
    const w = term.width - 1;
    const t = await readLine(term, footerRow, w, 'Workspace folder, full path (Esc to cancel)');
    if (!t || !t.trim()) return;
    const p = expandPath(t);
    if (!path.isAbsolute(p)) { status = `Use a full path, e.g. ${WIN ? 'D:\\Workspace' : '/home/me/workspace'}`; return; }
    const full = trimSep(path.resolve(p));
    if (list.some((x) => pathKey(x.path) === pathKey(full))) { status = 'Already a workspace'; return; }
    const name = await readLine(term, footerRow, w, `Name (Enter = '${path.basename(full) || full}', Esc to cancel)`);
    if (name === null) return;
    try { fs.mkdirSync(full, { recursive: true }); } catch (e) { status = `Invalid path: ${e.message}`; return; }
    list.push(makeWorkspace(full, name.trim()));
    save();
    cur = list.length - 1;
    status = 'Added.';
  };

  draw();
  for (;;) {
    const k = await term.readKey(LIVE);
    status = '';
    const have = list.length > 0;
    const c = k.name === 'char' ? k.ch.toLowerCase() : '';
    if (k.name === 'up' || k.name === 'down') cur = step(cur, list.length, k.name);
    else if (k.name === 'escape' || k.name === 'backspace') return;
    else if (c === 'a') await addWorkspace();
    else if (have && (k.name === 'ctrl-up' || k.name === 'ctrl-down')) {
      const to = cur + (k.name === 'ctrl-up' ? -1 : 1);
      if (to >= 0 && to < list.length) {
        [list[cur], list[to]] = [list[to], list[cur]];
        cur = to;
        save();
      }
    } else if (have && c === 'd') {
      const w = list[cur];
      if (await confirm(term, footerRow, term.width - 1, `Remove workspace '${wsName(w)}'? Its folder is kept. [y/N] `)) {
        list.splice(cur, 1);
        save();
        cur = Math.max(0, Math.min(cur, list.length - 1));
        status = 'Removed.';
      }
    } else if (have && k.name === 'enter') {
      const w = list[cur];
      const t = await readLine(term, footerRow, term.width - 1, `Name for ${w.path} (empty = folder name, Esc to cancel)`);
      if (t !== null) {
        if (t.trim()) w.name = t.trim(); else delete w.name;
        save();
        status = 'Saved.';
      }
    }
    draw();
  }
}
