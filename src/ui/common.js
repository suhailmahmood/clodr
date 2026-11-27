// Screen pieces shared by every screen. Screens build frames as arrays of lines; paint() writes a whole frame in a
// single write. Prompts take over one row of the frame.

const e = '\x1b';
export const RESET = `${e}[0m`;
const EL = `${e}[K`;
export const T = {
  gray: `${e}[38;2;190;190;190m`,   // light gray (truecolor; palette gray follows the terminal theme)
  dim: `${e}[38;2;120;120;120m`,
  faint: `${e}[38;2;85;85;85m`,        // placeholders
  clay: `${e}[38;2;217;119;87m`,    // Claude orange #D97757
  cyan: `${e}[36m`,
  yellow: `${e}[33m`,
  danger: `${e}[48;2;170;30;30m${e}[38;2;255;255;255m`,   // white on red: destructive prompts
  bold: `${e}[1m`,
  under: `${e}[4m`,
};

const LETTERS = [
  ['╭──', '│  ', '╰──'],   // C
  ['│  ', '│  ', '╰──'],   // L
  ['╭─╮', '│ │', '╰─╯'],   // O
  ['┌─╮', '│ │', '└─╯'],   // D
  ['┌─╮', '├─╯', '│ \\'],   // R
];

const logoLines = () => [0, 1, 2].map((r) => `${T.clay} ${LETTERS.map((l) => l[r]).join(' ')}${RESET}`);

export const fit = (s, width) => (s.length > width ? s.slice(0, width) : s);

// Top of every screen: logo, a title line, a blank line.
export const header = (title) => [...logoLines(), `${T.gray} ${title}${RESET}`, ''];

// Bottom hint line; a status message replaces the hint (yellow). Cut to the width.
export const hintLine = (hint, status, width) => `${status ? T.yellow : T.gray}${fit(status || hint, width)}${RESET}`;

// " 12. ": the number column of list rows.
export const rowNumber = (i) => `${String(i + 1).padStart(3)}. `;

// A list row: " 12. text", cut to the width.
export const numberedRow = (i, text, width, color = T.gray) => `${color}${fit(rowNumber(i) + text, width)}${RESET}`;

// Cursor movement in a wrapping list of n rows.
export function step(cur, n, keyName) {
  const len = Math.max(1, n);
  if (keyName === 'up') return (cur - 1 + len) % len;
  if (keyName === 'down') return (cur + 1) % len;
  return cur;
}

// Full-width red bar.
export const bar = (text, width) => `${T.danger}${fit(text, width).padEnd(width)}${RESET}`;

export const isYes = (k) => k.ch === 'y' || k.ch === 'Y';

export function paint(term, lines) {
  term.cursor(0);
  term.write(lines.map((l) => l + EL).join('\r\n') + `${e}[J`);
}

// Yellow message across the bottom row of the current frame.
export function showBottom(term, text) {
  const w = term.width - 1;
  term.cursor(term.height - 1);
  term.write(`${T.yellow}${fit(text, w).padEnd(w)}${RESET}`);
}

// Yes/no on the bottom row. Enter or y = yes, n = no.
export async function askYesNo(term, question) {
  showBottom(term, question);
  for (;;) {
    const k = await term.readKey();
    if (k.name === 'enter' || isYes(k)) return true;
    if (k.ch === 'n' || k.ch === 'N') return false;
  }
}

// Red y/N bar on the given row. True only for y/Y.
export async function confirm(term, row, question) {
  term.cursor(row);
  term.write(bar(question, term.width - 1));
  return isYes(await term.readKey());
}

// Prompt on the given row. Returns the text, or null on Esc.
export async function readLine(term, row, prompt) {
  term.cursor(row);
  term.write(' '.repeat(term.width - 1));
  term.cursor(row);
  term.cursorVisible(true);
  term.write(`${prompt}: `);
  let text = '';
  try {
    for (;;) {
      const k = await term.readKey();
      if (k.name === 'escape') return null;
      if (k.name === 'enter' || k.name === 'ctrl-enter') return text;
      if (k.name === 'backspace') { if (text) { text = text.slice(0, -1); term.write('\b \b'); } }
      else if (k.name === 'char' || k.name === 'space') { text += k.ch; term.write(k.ch); }
    }
  } finally { term.cursorVisible(false); }
}
