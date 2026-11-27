import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config.js';
import { kebabName } from './text.js';
import { isDir } from './paths.js';
import { listSessions } from './sessions.js';
import { launchClaude } from './claude.js';
import { initGit } from './git.js';
import { selectEntry } from './ui/menu.js';
import { showSettings } from './ui/settings.js';
import { showResume } from './ui/resume.js';
import { createTerm } from './ui/term.js';
import { askYesNo } from './ui/common.js';

const resumeIn = (dir, id) => launchClaude(dir, ['--resume', id]);
const newSessionIn = (dir) => launchClaude(dir);

// Creates the project folder, asking about git on the menu screen. Returns {dir, gitError}, or null for an unusable name.
async function prepareProject(sel, term) {
  const name = kebabName(sel.name);
  if (!name) return null;
  const dir = path.join(sel.root, name);
  const isNew = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  const gitError = isNew && await askYesNo(term, `Initialize git in ${name}? [Y/n] `) ? initGit(dir) : '';
  return { dir, gitError };
}

// Runs claude to completion on the main screen, then returns to the alt screen. Claude's exit chatter ("Resume
// this session with: ...") is erased without a clear, which would push lines into scrollback: reserve a few blank
// lines, save the cursor, and erase downwards from it afterwards.
// Returns why claude could not start (shown in the next page's status row), or ''.
const RESERVE = 5;
async function runOutside(term, fn) {
  term.exitScreen();
  term.write(`${'\n'.repeat(RESERVE)}\x1b[${RESERVE}A\x1b7`);   // newlines scroll if at the bottom; DECSC remembers the row
  term.stop();
  try { return (await fn()).error || ''; } finally { term.write('\x1b8\x1b[J'); term.start(); term.enterScreen(); }
}

/**
 * Interactive menu loop; ^C exits from the terminal layer. Enter on a folder with sessions opens its session list;
 * after claude exits, that project's session list comes back (the menu if the project has no sessions).
 */
export async function runMenu(term = createTerm()) {
  getConfig();                                 // a config warning prints here, before the screen takes over
  term.start();
  term.enterScreen();                          // one alt screen for every page
  let status = '';
  let listFor = null;                          // {dir, sessions?}: session list to show next, instead of the menu
  const memo = {};                             // menu row to come back to
  const run = async (dir, fn) => { status = await runOutside(term, fn); listFor = { dir }; };
  try {
    for (;;) {
      if (listFor) {
        const { dir, sessions = listSessions(dir) } = listFor;
        listFor = null;
        if (sessions.length) {
          const pick = await showResume(term, { dir, sessions, status });
          status = '';
          if (pick) await run(dir, () => (pick.id ? resumeIn(dir, pick.id) : newSessionIn(dir)));
          continue;                            // no pick (Esc/Bksp, or the last session deleted): the menu
        }
      }
      const cfg = getConfig();                 // re-read each pass: Settings may have changed it
      for (const w of cfg.workspaces) {
        if (!isDir(path.dirname(w.path))) continue;     // parent missing (unplugged drive): do not build the tree
        try { fs.mkdirSync(w.path, { recursive: true }); } catch { /* not writable */ }
      }
      const sel = await selectEntry(term, { workspaces: cfg.workspaces, view: cfg.view, status, memo });
      status = '';
      if (sel.kind === 'settings') { await showSettings(term); continue; }
      if (sel.kind === 'new') {
        const p = await prepareProject(sel, term);
        if (p) {
          Object.assign(memo, { path: p.dir, query: '' });   // the menu comes back on the new project's row
          await run(p.dir, () => newSessionIn(p.dir));
          status ||= p.gitError;
        }
        continue;
      }
      const sessions = sel.mode === 'continue' ? listSessions(sel.path) : [];
      if (sessions.length) listFor = { dir: sel.path, sessions };
      else await run(sel.path, () => newSessionIn(sel.path));
    }
  } finally { term.exitScreen(); term.stop(); }
}
