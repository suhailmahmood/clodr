import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, addSession, mkdirs, fakeTerm, stubClaude } from './helpers.js';
import { getConfig, saveConfig } from '../src/config.js';
import { selectEntry } from '../src/ui/menu.js';
import { showSettings } from '../src/ui/settings.js';
import { showWorkspaces } from '../src/ui/workspaces.js';
import { scanCleanup, planOrphans, executeCleanup, runningSessions } from '../src/cleanup.js';
import { purgeSupported } from '../src/claude.js';
import { renderTabs } from '../src/ui/tabs.js';
import { claudeJsonPath } from '../src/paths.js';

let sb;
let stub;
let proj;
before(() => {
  sb = sandbox();
  stub = stubClaude(sb.base);
  saveConfig({ workspaces: [{ path: sb.root }], view: '' });
  const [a, b, c] = mkdirs(path.join(sb.root, 'Alpha'), path.join(sb.root, 'Beta'), path.join(sb.base, 'code', 'proj'));
  proj = c;
  addSession(sb.claude, a, { ageH: 1 });
  addSession(sb.claude, c, { ageH: 2 });
  fs.utimesSync(b, new Date(Date.now() - 5 * 3600_000), new Date(Date.now() - 5 * 3600_000));
});
after(() => sb.cleanup());

const menu = (term, view = '', extra = {}) => selectEntry(term, { workspaces: [{ path: sb.root }], view, ...extra });

test('menu: newest first, Enter selects', async () => {
  const t = fakeTerm().press('enter');
  const r = await menu(t);
  assert.deepEqual(r, { kind: 'folder', path: path.join(sb.root, 'Alpha') });
  assert.match(t.text, /1\. ●\s*Alpha/);
  assert.match(t.text, /2\.\s+Beta/);
});

test('menu: digits jump, arrows wrap, Esc/q quit', async () => {
  assert.deepEqual(await menu(fakeTerm().press('2', 'enter')), { kind: 'folder', path: path.join(sb.root, 'Beta') });
  assert.deepEqual(await menu(fakeTerm().press('up', 'enter')), { kind: 'folder', path: path.join(sb.root, 'Beta') });
  assert.equal(await menu(fakeTerm().press('q')), null);
  assert.equal(await menu(fakeTerm().press('q')), null);
});

test('menu: n asks for a project name, s opens settings', async () => {
  assert.deepEqual(await menu(fakeTerm().press('n').type('hi there').press('enter')), { kind: 'new', name: 'hi there', root: sb.root });
  assert.equal(await menu(fakeTerm().press('n', 'escape', 'q')), null);
  assert.deepEqual(await menu(fakeTerm().press('s')), { kind: 'settings' });
});

test('menu: tab switch is remembered; Everything else lists outside folders', async () => {
  const t = fakeTerm().press('right', 'enter');
  assert.deepEqual(await menu(t), { kind: 'folder', path: proj });
  assert.equal(getConfig().view, 'else');
  assert.match(t.text, /Everything else/);
  assert.match(t.text, /proj/);
  saveConfig({ workspaces: [{ path: sb.root }], view: '' });
});

test('menu: o opens the selected folder', async () => {
  const opened = [];
  await menu(fakeTerm().press('o', 'q'), '', { openFolder: (p) => opened.push(p) });
  assert.deepEqual(opened, [path.join(sb.root, 'Alpha')]);
});

test('menu: delete asks y/N, n keeps, y removes folder + sessions', async () => {
  const d = mkdirs(path.join(sb.root, 'Doomed'))[0];
  const pd = addSession(sb.claude, d, { ageH: 0 });
  let t = fakeTerm().press('d', 'n', 'q');
  await menu(t);
  assert.equal(fs.existsSync(d), true);
  assert.match(t.text, /Delete 'Doomed' and 1 Claude session\(s\)\?/);
  t = fakeTerm().press('d', 'y', 'q');
  await menu(t);
  assert.equal(fs.existsSync(d), false);
  assert.equal(fs.existsSync(pd), false);
  assert.match(t.text, /Deleted Doomed/);
});

test('menu: projects delete keeps the folder', async () => {
  const d = mkdirs(path.join(sb.base, 'code', 'p2'))[0];
  const pd = addSession(sb.claude, d, { ageH: 0 });
  const t = fakeTerm().press('delete', 'y', 'q');
  await menu(t, 'else');
  assert.equal(fs.existsSync(d), true);
  assert.equal(fs.existsSync(pd), false);
  assert.match(t.text, /The folder is kept/);
});

test('menu: empty views show a hint', async () => {
  const empty = path.join(sb.base, 'empty-ws');
  fs.mkdirSync(empty);
  const t = fakeTerm().press('q');
  await selectEntry(t, { workspaces: [{ path: empty }], view: '' });
  assert.match(t.text, /No projects yet/);
});

const reset = () => saveConfig({ workspaces: [{ path: sb.root }], view: '' });

test('workspaces: add workspace with name, rename, reorder, remove', async () => {
  const next = path.join(sb.base, 'ws2');
  let t = fakeTerm().press('a').type(next).press('enter').type('Second').press('enter', 'escape');
  await showWorkspaces(t);
  assert.deepEqual(getConfig().workspaces, [{ path: sb.root }, { path: next, name: 'Second' }]);
  assert.equal(fs.existsSync(next), true);

  t = fakeTerm().press('down', 'ctrl-up', 'escape');             // move 2nd up
  await showWorkspaces(t);
  assert.deepEqual(getConfig().workspaces.map((w) => w.path), [next, sb.root]);

  t = fakeTerm().press('enter').type('Renamed').press('enter', 'escape');
  await showWorkspaces(t);
  assert.equal(getConfig().workspaces[0].name, 'Renamed');
  t = fakeTerm().press('enter', 'enter', 'escape');         // empty name clears it
  await showWorkspaces(t);
  assert.equal(getConfig().workspaces[0].name, undefined);

  t = fakeTerm().press('delete', 'n', 'escape');
  await showWorkspaces(t);
  assert.equal(getConfig().workspaces.length, 2);
  t = fakeTerm().press('delete', 'y', 'escape');
  await showWorkspaces(t);
  assert.deepEqual(getConfig().workspaces, [{ path: sb.root }]);
  assert.equal(fs.existsSync(next), true);                  // folder kept
  reset();
});

test('workspaces: relative path and duplicates rejected', async () => {
  let t = fakeTerm().press('a').type('rel/path').press('enter', 'escape');
  await showWorkspaces(t);
  assert.match(t.text, /Use a full path/);
  t = fakeTerm().press('a').type(sb.root).press('enter', 'escape');
  await showWorkspaces(t);
  assert.match(t.text, /Already a workspace/);
  assert.equal(getConfig().workspaces.length, 1);
});

test('settings: Manage workspaces opens the workspaces page', async () => {
  const t = fakeTerm().press('enter', 'escape', 'escape');
  await showSettings(t);
  assert.match(t.text, /Settings › Workspaces/);
  assert.match(t.text, /Manage workspaces/);
});

test('menu: crowded tab bar scrolls around the active tab', async () => {
  const workspaces = Array.from({ length: 12 }, (_, i) => ({ path: path.join(sb.base, `w${i}`), name: `Workspace-${i}` }));
  const t = fakeTerm({ width: 60 }).press('left', 'left', 'q');          // wraps to the last tab, then back one
  await selectEntry(t, { workspaces, view: '' });
  const bar = t.text.split(/\r?\n/).find((l) => l.includes('Everything else'));
  assert.ok(bar.length <= 60);
  assert.match(t.text, /‹/);
  assert.doesNotMatch(t.last, /Workspace-0 /);
});

test('menu: two workspaces + nested exclusion', async () => {
  const clones = path.join(sb.root, 'Clones');
  const repo = mkdirs(path.join(clones, 'r1'))[0];
  addSession(sb.claude, repo, { ageH: 0 });
  const workspaces = [{ path: sb.root, name: 'Main' }, { path: clones }];
  let t = fakeTerm().press('q');
  await selectEntry(t, { workspaces, view: '' });
  assert.match(t.text, /Main\s+Clones\s+Everything else/);
  assert.doesNotMatch(t.text, /r1/);
  t = fakeTerm().press('right', 'enter');
  assert.deepEqual(await selectEntry(t, { workspaces, view: '' }), { kind: 'folder', path: repo });
  assert.deepEqual(await selectEntry(fakeTerm().press('n').type('x').press('enter'), { workspaces, view: clones }), { kind: 'new', name: 'x', root: clones });
  assert.match((t = fakeTerm().press('left', 'n', 'q'), await selectEntry(t, { workspaces, view: '' }), t.text), /Switch to a workspace tab/);
  reset();
});

// ---- cleanup ----

test('purgeSupported follows claude purge --help', () => {
  assert.equal(purgeSupported(), true);
  process.env.STUB_NO_PURGE = '1';
  assert.equal(purgeSupported(), false);
  delete process.env.STUB_NO_PURGE;
});

test('scanCleanup finds orphans + config-only keys + legacy backups', () => {
  const gone = path.join(sb.base, 'gone-folder');
  addSession(sb.claude, gone, { ageH: 7 });
  addSession(sb.claude, 'x', { cwd: null, dirName: 'weird', ageH: 8 });
  fs.writeFileSync(claudeJsonPath(), JSON.stringify({ projects: { [gone.replace(/\\/g, '/')]: {}, [path.join(sb.base, 'only-in-config').replace(/\\/g, '/')]: {}, [proj.replace(/\\/g, '/')]: {} } }));
  fs.writeFileSync(`${claudeJsonPath()}.backup.123`, 'x');
  const s = scanCleanup();
  const labels = s.orphans.map((o) => o.label);
  assert.ok(labels.includes(gone), 'gone session dir');
  assert.ok(labels.some((l) => /only-in-config.*config entry only/.test(l)));
  assert.ok(labels.some((l) => /weird.*unknown folder/.test(l)));
  assert.equal(labels.filter((l) => l.startsWith(gone)).length, 1, 'gone folder not listed twice');
  assert.equal(labels.some((l) => l.includes('proj')), false, 'live folder untouched');
  assert.equal(s.backups.length, 1);
});

test('planOrphans: dry-run summary, skips nothing-to-purge and unresolvable', async () => {
  const plan = await planOrphans([
    { label: 'a', purgePath: path.join(sb.base, 'a'), source: 'sessions' },
    { label: 'b', purgePath: path.join(sb.base, 'nothing'), source: 'config' },
    { label: 'c', purgePath: null, source: 'sessions' },
  ]);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].summary, 'transcripts, config entry, 7 prompts');
  assert.equal(plan.items[0].partial, false);
  assert.equal(plan.skipped.length, 1);
});

test('executeCleanup refuses while claude runs', () => {
  const dir = path.join(sb.claude, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, cwd: sb.root, sessionId: 's' }));
  fs.writeFileSync(path.join(dir, '999999999.json'), JSON.stringify({ pid: 999999999 }));
  assert.equal(runningSessions().length, 1);
  const res = executeCleanup({ items: { orphans: [{ label: 'x', purgePath: 'x' }] } });
  assert.match(res.error, /running/);
  assert.equal(stub.log().some((l) => l.includes('--yes')), false);
  fs.rmSync(dir, { recursive: true });
});

test('executeCleanup: .bak copies, purge --yes, legacy backups deleted', () => {
  fs.writeFileSync(path.join(sb.claude, 'history.jsonl'), '{"a":1}\n');
  const scan = scanCleanup();
  const res = executeCleanup({ items: { orphans: [{ label: 'o', purgePath: path.join(sb.base, 'a') }], backups: scan.backups } });
  assert.equal(res.error, undefined);
  assert.deepEqual(res.done, { orphans: 1, backups: 1 });
  assert.equal(fs.existsSync(`${claudeJsonPath()}.bak`), true);
  assert.equal(fs.readFileSync(path.join(sb.claude, 'history.jsonl.bak'), 'utf8'), '{"a":1}\n');
  assert.equal(fs.existsSync(`${claudeJsonPath()}.backup.123`), false);
  assert.ok(stub.log().some((l) => l.startsWith('purge ') && l.endsWith('--yes')));
});

test('cleanup screen: review then y runs purge; n aborts', async () => {
  const { showCleanup } = await import('../src/ui/cleanup.js');
  fs.writeFileSync(`${claudeJsonPath()}.backup.9`, 'x');
  const before = stub.log().length;
  let t = fakeTerm().press('enter', 'n', 'escape');
  await showCleanup(t);
  assert.match(t.text, /Review/);
  assert.match(t.text, /transcripts, config entry, 7 prompts/);
  assert.equal(stub.log().slice(before).some((l) => l.includes('--yes')), false);
  assert.equal(fs.existsSync(`${claudeJsonPath()}.backup.9`), true);
  t = fakeTerm().press('enter', 'y', 'escape');
  await showCleanup(t);
  assert.ok(stub.log().slice(before).some((l) => l.includes('--yes')));
  assert.equal(fs.existsSync(`${claudeJsonPath()}.backup.9`), false);
  assert.match(t.text, /Removed \d+ project\(s\), 1 backup file\(s\)/);
});

test('cleanup screen: old claude disables orphans', async () => {
  const { showCleanup } = await import('../src/ui/cleanup.js');
  process.env.STUB_NO_PURGE = '1';
  const t = fakeTerm().press('escape');
  await showCleanup(t);
  delete process.env.STUB_NO_PURGE;
  assert.match(t.text, /claude purge needs Claude Code v2\.1\.288\+/);
});

test('renderTabs: fits, or windows around the active tab', () => {
  const strip = (l) => l.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(strip(renderTabs(['A', 'B'], 0, 40)).trim(), 'A   B');
  const many = Array.from({ length: 10 }, (_, i) => `Tab-${i}`);
  const bar = strip(renderTabs(many, 5, 30));
  assert.ok(bar.length <= 30);
  assert.match(bar, /^ ‹ .*Tab-5.* ›$/);
});
