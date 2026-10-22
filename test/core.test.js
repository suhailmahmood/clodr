import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, addSession, mkdirs } from './helpers.js';
import { kebabName, formatSize, TAGLINE } from '../src/text.js';
import { relPath, pathKey, encodeDir, expandPath } from '../src/paths.js';
import { parseKeys } from '../src/ui/term.js';
import { getConfig, saveConfig, nestedIn } from '../src/config.js';
import { globalFolders, workspaceFolders, outsideFolders, STATE, removeFolder, removeSessions, hasSession, sessionCount } from '../src/sessions.js';
import { derivePath, parsePurgeOutput } from '../src/cleanup.js';
import { upsertBlock, removeBlock } from '../src/setup.js';

let sb;
before(() => { sb = sandbox(); });
after(() => sb.cleanup());

test('kebabName', () => {
  assert.equal(kebabName('how blockchain works'), 'How-Blockchain-Works');
  assert.equal(kebabName("  what's -- up?  "), 'Whats-Up');
  assert.equal(kebabName('!!!'), '');
});

test('expandPath', () => {
  process.env.CM_TEST_VAR = 'zz';
  assert.equal(expandPath('%CM_TEST_VAR%/x'), 'zz/x');
  assert.ok(expandPath('~/x').endsWith('x') && !expandPath('~/x').startsWith('~'));
});

test('relPath boundaries', () => {
  const r = path.resolve('/tmp/Work');
  assert.equal(relPath(r, r), '');
  assert.equal(relPath(path.join(r, 'a'), r), 'a');
  assert.equal(relPath(path.join(r, 'a', 'b'), r), path.join('a', 'b'));
  assert.equal(relPath(`${r}shop`, r), null);
  assert.equal(relPath(path.resolve('/tmp'), r), null);
  assert.equal(pathKey(`${r}${path.sep}`), pathKey(r));
});

test('parseKeys', () => {
  const names = (s) => parseKeys(s).map((k) => k.name);
  assert.deepEqual(names('\x1b[A\x1b[B\x1b[C\x1b[D'), ['up', 'down', 'right', 'left']);
  assert.deepEqual(names('\x1b[1;5A\x1b[1;5B'), ['ctrl-up', 'ctrl-down']);
  assert.deepEqual(names('\x1b'), ['escape']);
  assert.deepEqual(names('\x1b[3~'), ['delete']);
  assert.deepEqual(names('\x1b[5~\x1b[6~\x1b[H\x1b[F'), ['pageup', 'pagedown', 'home', 'end']);
  assert.deepEqual(names('\r\x7f a'), ['enter', 'backspace', 'space', 'char']);
  assert.deepEqual(names('\x1bx'), ['unknown']);   // Alt+x is not Esc then x
});

test('config roundtrip + defaults', () => {
  assert.equal(getConfig().view, '');
  saveConfig({ workspaces: [{ path: sb.root, name: 'Main' }, { path: path.join(sb.root, 'x') }], view: 'else' });
  assert.deepEqual(getConfig(), { workspaces: [{ path: sb.root, name: 'Main' }, { path: path.join(sb.root, 'x') }], view: 'else' });
  fs.writeFileSync(path.join(sb.home, 'config.json'), '{nope');
  const warn = console.warn; console.warn = () => {};
  assert.equal(getConfig().view, '');
  console.warn = warn;
  saveConfig({ workspaces: [{ path: sb.root }], view: '' });
});

test('globalFolders states, dedupe, order', () => {
  const [a, b] = mkdirs(path.join(sb.root, 'Alpha'), path.join(sb.base, 'code', 'proj'));
  const gone = path.join(sb.base, 'deleted-folder');
  addSession(sb.claude, a, { ageH: 3 });
  addSession(sb.claude, b, { ageH: 1 });
  addSession(sb.claude, gone, { ageH: 5 });
  addSession(sb.claude, 'D:\\mystery\\x', { cwd: null, ageH: 6, dirName: 'D--mystery-x' });
  addSession(sb.claude, a, { ageH: 9, dirName: 'dup-of-alpha', id: 'b2' });   // same cwd, older: dropped
  const all = globalFolders();
  assert.deepEqual(all.map((f) => f.state), [STATE.OK, STATE.OK, STATE.GONE, STATE.UNKNOWN]);
  assert.equal(all[0].path, b);
  assert.equal(all.find((f) => f.state === STATE.UNKNOWN).leaf, 'D--mystery-x');
  assert.equal(all.filter((f) => f.path === a).length, 1);
});

test('workspace and outside views', () => {
  const deep = mkdirs(path.join(sb.root, 'Alpha', 'sub'))[0];
  addSession(sb.claude, deep, { ageH: 0 });
  const names = workspaceFolders(sb.root).map((t) => t.name);
  assert.ok(names.includes('Alpha'));
  assert.ok(names.includes(path.join('Alpha', 'sub')));
  assert.equal(names.includes('proj'), false);
  const projects = outsideFolders([sb.root]);
  assert.deepEqual(projects.map((p) => p.leaf), ['proj']);
});

test('nested workspace: its sessions leave the parent and stay out of everything else', () => {
  const [clones, repo] = mkdirs(path.join(sb.root, 'Clones'), path.join(sb.root, 'Clones', 'a', 'repo'));
  addSession(sb.claude, repo, { ageH: 0 });
  addSession(sb.claude, clones, { ageH: 0, id: 'b1' });
  const list = [{ path: sb.root }, { path: clones }];
  const parent = workspaceFolders(sb.root, undefined, nestedIn(list, list[0])).map((t) => t.name);
  assert.equal(parent.some((n) => n.startsWith('Clones')), false);
  assert.ok(parent.includes('Alpha'));
  assert.deepEqual(workspaceFolders(clones, undefined, nestedIn(list, list[1])).map((t) => t.name).sort(), ['a', path.join('a', 'repo')]);
  assert.equal(outsideFolders(list.map((w) => w.path)).some((p) => p.path.startsWith(clones)), false);
  assert.ok(workspaceFolders(sb.root).some((t) => t.name === 'Clones'));   // without nesting it is a plain folder
});

test('session counting', () => {
  const a = path.join(sb.root, 'Alpha');
  assert.equal(hasSession(a), true);
  assert.equal(sessionCount(a), 1);
  assert.equal(hasSession(path.join(sb.root, 'Nope')), false);
});

test('removeFolder refuses outside root, deletes folder + sessions', () => {
  assert.match(removeFolder(path.join(sb.base, 'code', 'proj'), sb.root), /^Refusing/);
  assert.match(removeFolder(sb.root, sb.root), /^Refusing: .* is the workspace root/);
  const d = mkdirs(path.join(sb.root, 'Temp-Folder'))[0];
  const pd = addSession(sb.claude, d);
  assert.equal(removeFolder(d, sb.root), null);
  assert.equal(fs.existsSync(d), false);
  assert.equal(fs.existsSync(pd), false);
});

test('removeSessions keeps the folder', () => {
  const d = mkdirs(path.join(sb.base, 'code', 'keepme'))[0];
  const pd = addSession(sb.claude, d);
  assert.equal(removeSessions(d, pd), null);
  assert.equal(fs.existsSync(d), true);
  assert.equal(fs.existsSync(pd), false);
});

test('derivePath round-trips only when encoding matches', () => {
  if (process.platform === 'win32') {
    assert.equal(derivePath('D--Projects-z-TestBed-POC'), 'D:\\Projects\\z\\TestBed\\POC');
    assert.equal(encodeDir(derivePath('D--a-b')), 'D--a-b');
    assert.equal(derivePath('weird'), null);
  } else {
    assert.equal(derivePath('-home-me-proj'), '/home/me/proj');
    assert.equal(derivePath('weird'), null);
  }
});

test('parsePurgeOutput', () => {
  const out = `
Purge plan for X:

  dir:    C:\\c\\file-history\\s1
           file edit history for session s1
  dir:    C:\\c\\file-history\\s2
           file edit history for session s2
  dir:    C:\\c\\projects\\p
           project transcripts (.jsonl) and memory/
  config: projects["x"]
           project entry in ~/.claude.json (trust, history, MCP servers)
  filter: C:\\c\\history.jsonl
           56 prompt(s) typed in this project

Dry run: 5 item(s) would be deleted.`;
  const r = parsePurgeOutput(out);
  assert.equal(r.items.length, 5);
  assert.equal(r.summary, 'transcripts, 2 file-history, config entry, 56 prompts');
  assert.deepEqual(parsePurgeOutput('nothing').items, []);
});

test('shell block insert is idempotent and removable', () => {
  const f = path.join(sb.base, 'rc', '.bashrc');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'export A=1\n');
  upsertBlock(f, 'bash');
  upsertBlock(f, 'bash');
  const t = fs.readFileSync(f, 'utf8');
  assert.equal(t.split('# >>> clodr >>>').length, 2);
  assert.ok(t.startsWith('export A=1\n'));
  assert.equal(removeBlock(f), true);
  assert.equal(fs.readFileSync(f, 'utf8').trim(), 'export A=1');
  assert.equal(removeBlock(f), false);
});

test('removeFolder works when our own cwd is inside the folder', () => {
  const d = mkdirs(path.join(sb.root, 'Held', 'sub'))[0];
  const before = process.cwd();
  process.chdir(d);
  try {
    assert.equal(removeFolder(path.join(sb.root, 'Held'), sb.root), null);
    assert.equal(fs.existsSync(path.join(sb.root, 'Held')), false);
  } finally { try { process.chdir(before); } catch { process.chdir(sb.base); } }
});

test('removeFolder refuses to delete a folder that holds a workspace', () => {
  const inner = mkdirs(path.join(sb.root, 'Outer', 'Inner'))[0];
  assert.match(removeFolder(path.join(sb.root, 'Outer'), sb.root, [inner]), /^Refusing: workspace .* is inside it/);
  assert.equal(fs.existsSync(inner), true);
  assert.equal(removeFolder(path.join(sb.root, 'Outer'), sb.root), null);
});

test('shell block is replaced where it stands', () => {
  const f = path.join(sb.base, 'rc', '.zshrc');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'export A=1\n');
  upsertBlock(f, 'bash');
  fs.appendFileSync(f, 'export B=2\n');
  const once = fs.readFileSync(f, 'utf8');
  upsertBlock(f, 'bash');
  assert.equal(fs.readFileSync(f, 'utf8'), once);
  assert.ok(once.endsWith('export B=2\n'));
});

test('package.json and README carry the tagline', () => {
  const root = path.join(import.meta.dirname, '..');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).description, TAGLINE);
  assert.ok(fs.readFileSync(path.join(root, 'README.md'), 'utf8').includes(`${TAGLINE}.`));
});

test('formatSize', () => {
  assert.equal(formatSize(10), '10 B');
  assert.equal(formatSize(2048), '2.0 KB');
});
