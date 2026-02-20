import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  helpText,
  parseFlags,
  listFilesRecursively,
  loadQuery,
  tokenize,
  estimateTokens,
  dedupLines,
  detectConflicts,
  buildScaffold,
  scoreChunk,
  compileContext,
  appendRunLog,
  readJsonl,
  mean,
  boolRate,
  delta,
  makeRunRow,
  computeReport,
  renderReport,
  compileFromFlags,
  isLikelyCodeTask,
  fileTypeWeight,
  shouldIncludeFile
} from '../src/core.js';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plc-'));
}

test('helpText contains usage', () => {
  assert.match(helpText(), /Usage:/);
  assert.match(helpText(), /plc compile/);
});

test('parseFlags parses values and boolean flags', () => {
  const flags = parseFlags(['--a', '1', '--b', '--c', 'x', 'ignored']);
  assert.deepEqual(flags, { a: '1', b: true, c: 'x' });
});

test('listFilesRecursively supports file and directory filtering', () => {
  const dir = mkTmp();
  const md = path.join(dir, 'a.md');
  const txt = path.join(dir, 'b.txt');
  const js = path.join(dir, 'c.js');
  const json = path.join(dir, 'd.json');
  const badExt = path.join(dir, 'e.bin');
  const huge = path.join(dir, 'f.md');
  fs.writeFileSync(md, 'a');
  fs.writeFileSync(txt, 'b');
  fs.writeFileSync(js, 'c');
  fs.writeFileSync(json, '{}');
  fs.writeFileSync(badExt, 'nope');
  fs.writeFileSync(huge, 'x'.repeat(210_000));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'x.md'), 'skip');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'y.md'), 'skip');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'z.mdc'), 'ok');

  assert.deepEqual(listFilesRecursively(md), [md]);
  const files = listFilesRecursively(dir).sort();
  assert.equal(files.length, 5);
  assert.ok(files.some((f) => f.endsWith('a.md')));
  assert.ok(files.some((f) => f.endsWith('b.txt')));
  assert.ok(files.some((f) => f.endsWith('c.js')));
  assert.ok(files.some((f) => f.endsWith('d.json')));
  assert.ok(files.some((f) => f.endsWith('z.mdc')));
  assert.ok(!files.some((f) => f.endsWith('e.bin')));
  assert.ok(!files.some((f) => f.endsWith('f.md')));

  const broken = path.join(dir, 'broken-link');
  try {
    fs.symlinkSync(path.join(dir, 'no-file'), broken);
  } catch {
    // ignore on fs that doesn't allow symlink in test env
  }
  assert.doesNotThrow(() => listFilesRecursively(dir));

  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir);
  const dirLink = path.join(dir, 'dir-link');
  try {
    fs.symlinkSync(targetDir, dirLink, 'dir');
  } catch {
    // ignore on fs that doesn't allow symlink in test env
  }

  const fileLink = path.join(dir, 'file-link.md');
  try {
    fs.symlinkSync(md, fileLink);
  } catch {
    // ignore on fs that doesn't allow symlink in test env
  }

  const binLink = path.join(dir, 'bin-link.md');
  try {
    fs.symlinkSync(badExt, binLink);
  } catch {
    // ignore on fs that doesn't allow symlink in test env
  }

  const badSuffixLink = path.join(dir, 'skip-link.bin');
  try {
    fs.symlinkSync(md, badSuffixLink);
  } catch {
    // ignore on fs that doesn't allow symlink in test env
  }

  const filesAfter = listFilesRecursively(dir);
  assert.ok(!filesAfter.some((f) => f.endsWith('dir-link')));
  if (fs.existsSync(fileLink)) {
    assert.ok(filesAfter.some((f) => f.endsWith('file-link.md')));
  }
  // symlink extension follows link name, so binLink may be included when suffix is .md
  if (fs.existsSync(badSuffixLink)) {
    assert.ok(!filesAfter.some((f) => f.endsWith('skip-link.bin')));
  }

  assert.equal(shouldIncludeFile(path.join(dir, 'not-exists.md')), false);
  assert.equal(shouldIncludeFile(dir), false);
  assert.deepEqual(listFilesRecursively(path.join(dir, 'not-exists')), []);
  assert.deepEqual(listFilesRecursively(`/definitely/not/exists/${Date.now()}`), []);
});

test('loadQuery supports raw and @file and required guard', () => {
  const dir = mkTmp();
  const qf = path.join(dir, 'q.txt');
  fs.writeFileSync(qf, 'hello');
  assert.equal(loadQuery('hi'), 'hi');
  assert.equal(loadQuery(`@${qf}`), 'hello');
  assert.throws(() => loadQuery(''), /--query is required/);
});

test('tokenize estimate dedup detect', () => {
  assert.deepEqual(tokenize('A b test 테스트 aa'), ['test', '테스트', 'aa']);
  assert.deepEqual(tokenize('x'), []);
  assert.equal(estimateTokens('1234'), 1);
  assert.equal(estimateTokens(), 0);
  assert.equal(dedupLines('A\na\n\nB\nb'), 'A\n\nB');
  const c = detectConflicts('never always must not must deny allow forbid require');
  assert.equal(c.length, 4);
  assert.deepEqual(detectConflicts('clean text'), []);
});

test('buildScaffold adds missing and keeps existing', () => {
  const add = buildScaffold('작업해줘', 'context');
  assert.equal(add.length, 2);
  const keep = buildScaffold('DONE_WHEN and test', 'acceptance criteria validate');
  assert.equal(keep.length, 0);
});

test('scoreChunk and compileContext normal path', () => {
  assert.equal(scoreChunk('', ['a']), 0);
  const { compiled, metrics } = compileContext('foo bar\n\nbar baz', 'foo', 'haiku');
  assert.match(compiled, /COMPILED_PROMPT/);
  assert.match(compiled, /small_model: haiku/);
  assert.ok(metrics.context_chars_in > 0);
  assert.ok(metrics.prompt_tokens_est_out > 0);

  assert.equal(isLikelyCodeTask('build failed on CI'), true);
  assert.equal(isLikelyCodeTask('온보딩 문서 작성'), false);
  assert.ok(fileTypeWeight('a.ts', true) > fileTypeWeight('a.md', true));
  assert.equal(fileTypeWeight('a.json', true), 1.1);
  assert.ok(fileTypeWeight('a.md', false) > fileTypeWeight('a.ts', false));
  assert.equal(fileTypeWeight('a.yaml', false), 1.0);
});

test('compileContext fallback and conflict warning path', () => {
  const { metrics, compiled } = compileContext('never always', 'zzzz', undefined);
  assert.equal(metrics.lint_warnings, 1);
  assert.match(compiled, /small_model: none/);

  const done = compileContext('acceptance criteria\nvalidate', 'DONE_WHEN test', undefined);
  assert.match(done.compiled, /\(already present\)/);
});

test('appendRunLog + readJsonl with invalid json line', () => {
  const dir = mkTmp();
  const log = path.join(dir, 'runs.jsonl');
  appendRunLog({ a: 1 }, log);
  fs.appendFileSync(log, '{bad}\n');
  const rows = readJsonl(log);
  assert.equal(rows.length, 1);
  assert.equal(readJsonl(path.join(dir, 'none.jsonl')).length, 0);
});

test('mean boolRate delta helpers', () => {
  assert.equal(mean([]), 0);
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(boolRate([], 'x'), 0);
  assert.equal(boolRate([{ x: true }, { x: false }], 'x'), 0.5);
  assert.equal(delta(0, 0), 0);
  assert.equal(delta(0, 1), 100);
  assert.equal(delta(10, 5, true), 50);
  assert.equal(delta(10, 5, false), -50);
});

test('makeRunRow parses and validates fields', () => {
  const row = makeRunRow({
    mode: 'plc',
    tool: 'claude_code',
    'task-id': 'T1',
    'first-pass-success': 'true',
    'human-override': 'false',
    'reask-count': '2'
  });
  const rowDefaultBool = makeRunRow({ mode: 'baseline', tool: 'cursor', 'task-id': 'T2' });
  assert.equal(row.mode, 'plc');
  assert.equal(row.first_pass_success, true);
  assert.equal(row.human_override, false);
  assert.equal(row.reask_count, 2);
  assert.equal(rowDefaultBool.first_pass_success, false);
  assert.throws(() => makeRunRow({ mode: 'plc' }), /--tool is required/);
});

test('computeReport and renderReport', () => {
  const rows = [
    { mode: 'baseline', total_tokens_actual: 100, first_pass_success: false, reask_count: 1, turns_to_done: 3, constraint_violation: 1 },
    { mode: 'plc', total_tokens_actual: 60, first_pass_success: true, reask_count: 0, turns_to_done: 2, constraint_violation: 0 }
  ];
  const report = computeReport(rows);
  assert.equal(report.gates.decision, 'GO');
  const out = renderReport(report, 'x.jsonl');
  assert.match(out, /PLC Report/);
  assert.match(out, /Decision: GO/);
});

test('computeReport no-go branch', () => {
  const rows = [
    { mode: 'baseline', total_tokens_actual: 10, first_pass_success: true, reask_count: 1, turns_to_done: 1, constraint_violation: 0 },
    { mode: 'plc', total_tokens_actual: 30, first_pass_success: false, reask_count: 1, constraint_violation: 1 },
    { mode: 'plc', total_tokens_actual: 40, first_pass_success: false, reask_count: 1, turns_to_done: 2, constraint_violation: 1 }
  ];
  const report = computeReport(rows);
  assert.equal(report.gates.decision, 'NO-GO');
  const out = renderReport(report, 'y.jsonl');
  assert.match(out, /FAIL/);
});

test('computeReport uses prompt token and zero fallbacks', () => {
  const rows = [
    { mode: 'baseline', prompt_tokens_est_out: 5, first_pass_success: false, reask_count: 0 },
    { mode: 'plc' }
  ];
  const report = computeReport(rows);
  assert.equal(report.baseline.tokens_per_task, 5);
  assert.equal(report.optimized.turns_to_done, 0);
});

test('compileFromFlags writes output and handles missing context', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'ctx.md'), '로그인 test never always');
  fs.writeFileSync(path.join(dir, 'q.txt'), '로그인');
  const r = compileFromFlags({ context: '.', query: `@${path.join(dir, 'q.txt')}`, out: 'out.md' }, dir);
  assert.ok(fs.existsSync(path.join(dir, 'out.md')));
  assert.equal(r.out, 'out.md');

  const r2 = compileFromFlags({ context: 'missing-path', query: 'x', out: 'x.md' }, dir);
  assert.ok(fs.existsSync(path.join(dir, 'x.md')));

  const r3 = compileFromFlags({ context: '.', query: '기본 out' }, dir);
  assert.equal(path.basename(r3.outAbs), 'compiled_prompt.md');

  assert.throws(() => compileFromFlags({ context: '.' }, dir), /--query is required/);
  assert.throws(() => compileFromFlags({ query: 'x' }, dir), /--context is required/);
});
