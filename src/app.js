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

// After claude exits, tell the shell wrapper where to cd (it sets CLODR_CWDFILE).
function leaveShellIn(dir) {
  if (process.env.CLODR_CWDFILE) {
    try { fs.writeFileSync(process.env.CLODR_CWDFILE, dir); } catch { /* shell just stays put */ }
  }
}

async function runIn(dir, args) {
  const code = await launchClaude(dir, args);
  leaveShellIn(dir);
  return code;
}

export async function resumeIn(dir) {
  if (hasSession(dir)) return runIn(dir, ['-r']);
  console.log(`\x1b[33mNo session in ${dir}, starting new\x1b[0m`);
  return runIn(dir, []);
}

// One key from the raw terminal, outside any alt screen.
async function askKey(term, text) {
  term.write(text);
  term.start();
  const k = await term.readKey();
  term.stop();
  term.write('\n');
  return k.ch;
}

async function newProject(sel, term) {
  const name = kebabName(sel.name);
  if (!name) { console.warn('Empty project name'); return 1; }
  const dir = path.join(sel.root, name);
  const isNew = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  if (isNew) {
    const ans = await askKey(term, `Initialize git in ${name}? [Y/n] `);
    if (ans !== 'n' && ans !== 'N') initGit(dir);
  }
  return runIn(dir, []);
}

// What the menu can ask for once it closes, by result kind. (Settings is a page inside the menu loop.)
const ACTIONS = {
  folder: (sel) => resumeIn(sel.path),
  new: newProject,
};

/** Interactive menu loop. */
export async function runMenu(term = createTerm()) {
  getConfig();                                 // a config warning prints here, before the screen takes over
  let sel;
  term.start();
  term.enterScreen();                          // one alt screen for every page
  try {
    for (;;) {
      const cfg = getConfig();                 // re-read each pass: Settings may have changed it
      for (const w of cfg.workspaces) {
        if (!isDir(path.dirname(w.path))) continue;     // parent missing (unplugged drive): do not build the tree
        try { fs.mkdirSync(w.path, { recursive: true }); } catch { /* not writable */ }
      }
      sel = await selectEntry(term, { workspaces: cfg.workspaces, view: cfg.view });
      if (!sel) return 0;
      if (sel.kind === 'settings') { await showSettings(term); continue; }
      break;
    }
  } finally { term.exitScreen(); term.stop(); }

  return ACTIONS[sel.kind](sel, term);
}
