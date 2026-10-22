import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configFile } from './config.js';
import { which, runSync } from './proc.js';
import { WIN } from './platform.js';

const BEGIN = '# >>> clodr >>>';
const END = '# <<< clodr <<<';

// Wrappers: run the real binary with CLODR_CWDFILE set, then cd to the folder it wrote.
// While it runs, the shell waits in the temp dir: Windows cannot delete a folder that is any process's cwd.
// Afterwards it returns to where it was, or to the nearest folder that still exists.
const POSIX_WRAPPER = `clodr() {
  local f rc start="$PWD"
  f="$(mktemp)" || return
  cd "\${TMPDIR:-/tmp}" 2>/dev/null
  CLODR_CWDFILE="$f" command clodr "$@"
  rc=$?
  if [ -s "$f" ]; then cd "$(cat "$f")" 2>/dev/null
  else
    while [ ! -d "$start" ] && [ "$start" != / ]; do start="$(dirname "$start")"; done
    cd "$start" 2>/dev/null
  fi
  rm -f "$f"
  return $rc
}`;

const POWERSHELL_WRAPPER = `function clodr {
    $f = [IO.Path]::GetTempFileName()
    $start = (Get-Location).Path
    Set-Location -LiteralPath ([IO.Path]::GetTempPath())
    $env:CLODR_CWDFILE = $f
    try { & (Get-Command clodr -CommandType Application | Select-Object -First 1).Source @args }
    finally {
        Remove-Item Env:CLODR_CWDFILE -ErrorAction SilentlyContinue
        $d = Get-Content -LiteralPath $f -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($d) { Set-Location -LiteralPath $d.Trim() }
        else {
            while ($start -and -not (Test-Path -LiteralPath $start)) { $start = Split-Path -Parent $start }
            if ($start) { Set-Location -LiteralPath $start }
        }
        Remove-Item -LiteralPath $f -ErrorAction SilentlyContinue
    }
}`;

// Rc / profile file of a shell, when the shell is in use.
const bashFiles = () => {
  const bashrc = path.join(os.homedir(), '.bashrc');
  return fs.existsSync(bashrc) || /bash/.test(process.env.SHELL || '') ? [bashrc] : [];
};

const zshFiles = () => {
  const zshrc = path.join(process.env.ZDOTDIR || os.homedir(), '.zshrc');
  return !WIN && (fs.existsSync(zshrc) || /zsh/.test(process.env.SHELL || '')) ? [zshrc] : [];
};

// Profile path as the shell itself reports it (handles OneDrive-redirected Documents).
function psProfile(exe, fallback) {
  if (!which(exe)) return null;
  const r = runSync(exe, ['-NoProfile', '-NonInteractive', '-Command', '$PROFILE.CurrentUserCurrentHost']);
  return r.ok && r.out.trim() ? r.out.trim() : fallback;
}

function powershellFiles() {
  const home = os.homedir();
  const out = [];
  const pwsh = psProfile('pwsh', WIN
    ? path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'powershell', 'Microsoft.PowerShell_profile.ps1'));
  if (pwsh) out.push(pwsh);
  if (WIN) {
    const ps5 = psProfile('powershell', path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'));
    if (ps5 && ps5 !== pwsh) out.push(ps5);
  }
  return out;
}

// One entry per supported shell: the wrapper it gets and the files that load it.
const SHELLS = [
  { id: 'bash', wrapper: POSIX_WRAPPER, files: bashFiles },
  { id: 'zsh', wrapper: POSIX_WRAPPER, files: zshFiles },
  { id: 'powershell', wrapper: POWERSHELL_WRAPPER, files: powershellFiles },
];

const block = (shell) => {
  const s = SHELLS.find((x) => x.id === shell);
  if (!s) throw new Error(`Unknown shell "${shell}" (use ${SHELLS.map((x) => x.id).join(', ')})`);
  return `${BEGIN}\n${s.wrapper}\n${END}`;
};

const SPAN = `${BEGIN}[\\s\\S]*?${END}`;
const SPAN_RE = new RegExp(SPAN);
const REMOVE_RE = new RegExp(`\\r?\\n?${SPAN}\\r?\\n?`);

// Replaces the block where it stands; a file without one gets it appended.
export function upsertBlock(file, shell) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  const b = block(shell);
  if (SPAN_RE.test(text)) text = text.replace(SPAN_RE, () => b);
  else text = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${b}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// True if a block was removed.
export function removeBlock(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  if (!REMOVE_RE.test(text)) return false;
  fs.writeFileSync(file, text.replace(REMOVE_RE, '\n').replace(/^\n+/, ''));
  return true;
}

// Rc / profile files that get the wrapper: [{shell, file}]
export const shellTargets = () => SHELLS.flatMap((s) => s.files().map((file) => ({ shell: s.id, file })));

/**
 * clodr setup [--remove]
 * @param {string[]} argv
 */
export function runSetup(argv) {
  const bad = argv.find((a) => a !== '--remove');
  if (bad) { console.error(`Unknown argument: ${bad}`); return 1; }
  const targets = shellTargets();
  if (argv.includes('--remove')) {
    for (const t of targets) if (removeBlock(t.file)) console.log(`Removed shell integration from ${t.file}`);
    console.log(`Config left in place: ${configFile()}
To uninstall the program: npm uninstall -g clodr`);
    return 0;
  }
  if (!targets.length) { console.log('No bash, zsh or PowerShell found. Nothing to set up.'); return 1; }
  for (const t of targets) { upsertBlock(t.file, t.shell); console.log(`Shell integration: ${t.file}`); }
  console.log('Installed. Open a new terminal to see the effect.');
  return 0;
}
