import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config.js';
import { kebabName } from './text.js';
import { isDir } from './paths.js';
import { hasSession } from './sessions.js';
import { launchClaude } from './claude.js';
import { initGit } from './git.js';
import { selectEntry } from './ui/menu.js';
import { showSettings } from './ui/settings.js';
import { createTerm } from './ui/term.js';
import { T, RESET } from './ui/common.js';

const CLEAR = '\x1b[2J\x1b[H';

const runIn = (dir, args) => launchClaude(dir, args);

export const resumeIn = (dir) => runIn(dir, hasSession(dir) ? ['-r'] : []);   // no session: start a new one

export const newSessionIn = (dir) => runIn(dir, []);

// Yes/no on the bottom row of the current screen. Enter or y = yes, n = no.
async function askYesNo(term, text) {
  const w = term.width - 1;
  term.cursor(term.height - 1);
  term.write(`${T.yellow}${text.slice(0, w).padEnd(w)}${RESET}`);
  for (;;) {
    const k = await term.readKey();
    if (k.name === 'enter' || k.ch === 'y' || k.ch === 'Y') return true;
    if (k.ch === 'n' || k.ch === 'N') return false;
  }
}

// Creates the project folder (asking about git on the menu screen) and returns its path, or null.
async function prepareProject(sel, term) {
  const name = kebabName(sel.name);
  if (!name) return null;
  const dir = path.join(sel.root, name);
  const isNew = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  if (isNew && await askYesNo(term, `Initialize git in ${name}? [Y/n] `)) initGit(dir);
  return dir;
}

// Leaves the menu screen, runs claude to completion, comes back to the menu screen.
// Returns why claude could not start (shown in the menu), or ''.
async function runOutside(term, fn) {
  term.exitScreen();
  term.write(CLEAR);                 // blank screen: claude starts clean, no old terminal text during its startup
  term.stop();
  try { return (await fn()).error || ''; } finally { term.start(); term.enterScreen(); }
}

/** Interactive menu loop: pick, run claude, return to the (refreshed) menu until the user quits. */
export async function runMenu(term = createTerm()) {
  getConfig();                                 // a config warning prints here, before the screen takes over
  term.start();
  term.enterScreen();                          // one alt screen for every page
  let status = '';
  try {
    for (;;) {
      const cfg = getConfig();                 // re-read each pass: Settings may have changed it
      for (const w of cfg.workspaces) {
        if (!isDir(path.dirname(w.path))) continue;     // parent missing (unplugged drive): do not build the tree
        try { fs.mkdirSync(w.path, { recursive: true }); } catch { /* not writable */ }
      }
      const sel = await selectEntry(term, { workspaces: cfg.workspaces, view: cfg.view, status });
      status = '';
      if (!sel) return 0;
      if (sel.kind === 'settings') { await showSettings(term); continue; }
      if (sel.kind === 'new') {
        const dir = await prepareProject(sel, term);
        if (dir) status = await runOutside(term, () => runIn(dir, []));
      } else {
        status = await runOutside(term, () => (sel.mode === 'new' ? newSessionIn(sel.path) : resumeIn(sel.path)));
      }
    }
  } finally { term.exitScreen(); term.stop(); }
}
