#!/usr/bin/env node
import { runMenu } from '../src/app.js';
import { runSetup } from '../src/setup.js';
import { TAGLINE } from '../src/text.js';

const HELP = `${TAGLINE}

  clodr                  open the menu
  clodr setup            install shell integration
  clodr setup --remove   remove shell integration
  clodr --help           show this help

About setup
  Run it once after installing, and again after updating Clodr.
  It adds a marked block (# >>> clodr >>> ... # <<< clodr <<<) to your bash, zsh
  and PowerShell profiles, defining a clodr function that wraps the program:
    - after Claude exits, your terminal stays in the folder you picked
    - while Clodr runs, the terminal waits in the temp folder, so Windows lets
      Clodr delete the folder you were last in
    - if you quit without picking anything, you land back where you started
  Restart open terminals to pick it up.
  Re-running setup replaces the block; it never duplicates it.
  Without setup, Clodr still works; your terminal just stays where it was.
  --remove deletes the block from the profiles and leaves your config.
  Workspaces are managed inside Clodr: Settings > Manage workspaces.
`;

const [cmd, ...rest] = process.argv.slice(2);

async function main() {
  if (cmd === '-h' || cmd === '--help') { process.stdout.write(HELP); return 0; }
  if (cmd === 'setup') return runSetup(rest);
  if (cmd) { console.error(`Unknown argument: ${cmd}\n`); process.stderr.write(HELP); return 1; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('clodr needs an interactive terminal.'); return 1; }
  return runMenu();
}

process.exitCode = await main();
