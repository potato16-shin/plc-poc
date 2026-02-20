import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cli = path.join(root, 'bin', 'plc.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plc-e2e-'));
}

function run(args, cwd) {
  return execFileSync('node', [cli, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

test('E2E: compile -> run(baseline/plc) -> report', () => {
  const dir = mkTmp();

  fs.writeFileSync(path.join(dir, 'ctx.md'), [
    'auth login flow',
    'never deploy secrets',
    'always run tests'
  ].join('\n'));

  const compileOut = run([
    'compile',
    '--context', '.',
    '--query', '로그인 버그 수정하고 테스트',
    '--out', 'compiled_prompt.md'
  ], dir);

  assert.match(compileOut, /Compiled prompt written to compiled_prompt.md/);
  assert.ok(fs.existsSync(path.join(dir, 'compiled_prompt.md')));

  const baseline = run([
    'run',
    '--mode', 'baseline',
    '--tool', 'claude_code',
    '--task-id', 'E2E-1',
    '--first-pass-success', 'false',
    '--reask-count', '1',
    '--turns-to-done', '5',
    '--total-tokens-actual', '7000'
  ], dir);
  assert.match(baseline, /Run logged:/);

  const plc = run([
    'run',
    '--mode', 'plc',
    '--tool', 'claude_code',
    '--task-id', 'E2E-1',
    '--first-pass-success', 'true',
    '--reask-count', '0',
    '--turns-to-done', '3',
    '--total-tokens-actual', '5000'
  ], dir);
  assert.match(plc, /Run logged:/);

  const report = run(['report', '--from', '.plc/logs/runs.jsonl'], dir);
  assert.match(report, /=== PLC Report ===/);
  assert.match(report, /baseline n=1, plc n=1/);
  assert.match(report, /Decision: GO/);
});
