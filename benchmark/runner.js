#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const cmd = args[0];
const baseDir = process.cwd();
const tasksPath = path.join(baseDir, 'benchmark/tasks.jsonl');
const runsPath = path.join(baseDir, 'benchmark/runs.jsonl');
const reportPath = path.join(baseDir, 'benchmark/report.md');
const reportJsonPath = path.join(baseDir, 'benchmark/report.json');

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function rate(arr, pred) {
  return arr.length ? arr.filter(pred).length / arr.length : 0;
}

function pct(v) {
  return `${(v * 100).toFixed(2)}%`;
}

function init() {
  if (!fs.existsSync(tasksPath)) fs.writeFileSync(tasksPath, '', 'utf8');
  if (!fs.existsSync(runsPath)) fs.writeFileSync(runsPath, '', 'utf8');
  console.log('Initialized benchmark files');
}

function record(flags) {
  const req = [
    'task',
    'mode',
    'model',
    'tool',
    'resolved',
    'first-pass-success',
    'reask-count',
    'turns-to-done',
    'human-edits',
    'reopened-within-7d',
    'total-tokens-actual',
    'latency-sec'
  ];
  for (const r of req) if (flags[r] === undefined) throw new Error(`missing --${r}`);

  const row = {
    timestamp: new Date().toISOString(),
    task_id: flags.task,
    mode: flags.mode,
    model: flags.model,
    tool: flags.tool,
    resolved: String(flags.resolved).toLowerCase() === 'true',
    first_pass_success: String(flags['first-pass-success']).toLowerCase() === 'true',
    reask_count: Number(flags['reask-count']),
    turns_to_done: Number(flags['turns-to-done']),
    human_edits: Number(flags['human-edits']),
    reopened_within_7d: String(flags['reopened-within-7d']).toLowerCase() === 'true',
    total_tokens_actual: Number(flags['total-tokens-actual']),
    prompt_tokens_actual: flags['prompt-tokens-actual'] !== undefined ? Number(flags['prompt-tokens-actual']) : null,
    prompt_tokens_est: flags['prompt-tokens-est'] !== undefined ? Number(flags['prompt-tokens-est']) : null,
    latency_sec: Number(flags['latency-sec']),
    notes: flags.notes || ''
  };

  appendJsonl(runsPath, row);
  console.log('Recorded run:', row.task_id, row.mode);
}

function summarize(rows) {
  const byMode = (m) => rows.filter((r) => r.mode === m);

  const summarizeMode = (arr) => {
    const resolvedRows = arr.filter((r) => r.resolved);
    const resolvedWithPromptActual = resolvedRows.filter((r) => Number.isFinite(r.prompt_tokens_actual));
    const resolvedWithPromptAny = resolvedRows.filter((r) => Number.isFinite(r.prompt_tokens_actual) || Number.isFinite(r.prompt_tokens_est));

    return {
      n: arr.length,
      closure_rate: rate(arr, (r) => r.resolved),
      first_pass_rate: rate(arr, (r) => r.first_pass_success),
      reopened_rate: rate(arr, (r) => r.reopened_within_7d),
      reask_rate: rate(arr, (r) => r.reask_count > 0),
      turns_mean: mean(arr.map((r) => r.turns_to_done)),
      latency_mean: mean(arr.map((r) => r.latency_sec)),

      // full run cost
      total_tokens_per_resolved: resolvedRows.length ? mean(resolvedRows.map((r) => r.total_tokens_actual)) : 0,

      // prompt-only cost (actual if present, else estimate fallback)
      prompt_tokens_per_resolved_actual: resolvedWithPromptActual.length
        ? mean(resolvedWithPromptActual.map((r) => r.prompt_tokens_actual))
        : null,
      prompt_tokens_per_resolved_any: resolvedWithPromptAny.length
        ? mean(resolvedWithPromptAny.map((r) => (Number.isFinite(r.prompt_tokens_actual) ? r.prompt_tokens_actual : r.prompt_tokens_est)))
        : null,

      edits_per_resolved: resolvedRows.length ? mean(resolvedRows.map((r) => r.human_edits)) : 0
    };
  };

  const b = summarizeMode(byMode('baseline'));
  const p = summarizeMode(byMode('plc'));

  const pctDelta = (base, plc) => {
    if (!Number.isFinite(base) || base === 0 || !Number.isFinite(plc)) return null;
    return ((base - plc) / base) * 100;
  };

  const delta = {
    closure_pp: (p.closure_rate - b.closure_rate) * 100,
    reopened_pp: (b.reopened_rate - p.reopened_rate) * 100,
    edits_per_resolved_pct: pctDelta(b.edits_per_resolved, p.edits_per_resolved),

    total_tokens_per_resolved_pct: pctDelta(b.total_tokens_per_resolved, p.total_tokens_per_resolved),
    prompt_tokens_per_resolved_actual_pct: pctDelta(b.prompt_tokens_per_resolved_actual, p.prompt_tokens_per_resolved_actual),
    prompt_tokens_per_resolved_any_pct: pctDelta(b.prompt_tokens_per_resolved_any, p.prompt_tokens_per_resolved_any)
  };

  const gates = {
    closure: delta.closure_pp >= 10,
    tokens_total: (delta.total_tokens_per_resolved_pct ?? -Infinity) >= 20,
    tokens_prompt: ((delta.prompt_tokens_per_resolved_actual_pct ?? delta.prompt_tokens_per_resolved_any_pct ?? -Infinity) >= 20),
    reopened: delta.reopened_pp >= 0,
    edits: (delta.edits_per_resolved_pct ?? 0) >= 0
  };

  return { baseline: b, plc: p, delta, gates };
}

function formatDelta(v, suffix = '%') {
  if (!Number.isFinite(v)) return 'n/a';
  return `${v.toFixed(2)}${suffix}`;
}

function report() {
  const rows = readJsonl(runsPath);
  const summary = summarize(rows);

  const md = `# PLC Benchmark Report\n\n` +
`- baseline n: ${summary.baseline.n}\n` +
`- plc n: ${summary.plc.n}\n\n` +
`## Core Quality Metrics\n` +
`- Closure rate: ${pct(summary.baseline.closure_rate)} -> ${pct(summary.plc.closure_rate)} (Δ ${summary.delta.closure_pp.toFixed(2)}pp)\n` +
`- Reopened rate: ${pct(summary.baseline.reopened_rate)} -> ${pct(summary.plc.reopened_rate)} (Δ ${summary.delta.reopened_pp.toFixed(2)}pp)\n` +
`- Human edits per resolved: ${summary.baseline.edits_per_resolved.toFixed(2)} -> ${summary.plc.edits_per_resolved.toFixed(2)} (Δ ${formatDelta(summary.delta.edits_per_resolved_pct)})\n\n` +
`## Cost Metrics\n` +
`- Total tokens per resolved: ${summary.baseline.total_tokens_per_resolved.toFixed(2)} -> ${summary.plc.total_tokens_per_resolved.toFixed(2)} (Δ ${formatDelta(summary.delta.total_tokens_per_resolved_pct)})\n` +
`- Prompt tokens per resolved (actual): ${summary.baseline.prompt_tokens_per_resolved_actual ?? 'n/a'} -> ${summary.plc.prompt_tokens_per_resolved_actual ?? 'n/a'} (Δ ${formatDelta(summary.delta.prompt_tokens_per_resolved_actual_pct)})\n` +
`- Prompt tokens per resolved (actual-or-est): ${summary.baseline.prompt_tokens_per_resolved_any ?? 'n/a'} -> ${summary.plc.prompt_tokens_per_resolved_any ?? 'n/a'} (Δ ${formatDelta(summary.delta.prompt_tokens_per_resolved_any_pct)})\n\n` +
`## Gates\n` +
`- closure (+10pp): ${summary.gates.closure ? 'PASS' : 'FAIL'}\n` +
`- total tokens (-20%): ${summary.gates.tokens_total ? 'PASS' : 'FAIL'}\n` +
`- prompt tokens (-20%): ${summary.gates.tokens_prompt ? 'PASS' : 'FAIL'}\n` +
`- reopened (non-increase): ${summary.gates.reopened ? 'PASS' : 'FAIL'}\n` +
`- edits (non-increase): ${summary.gates.edits ? 'PASS' : 'FAIL'}\n`;

  fs.writeFileSync(reportPath, md, 'utf8');
  fs.writeFileSync(reportJsonPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(md);
}

try {
  if (cmd === 'init') init();
  else if (cmd === 'record') record(parseFlags(args.slice(1)));
  else if (cmd === 'report') report();
  else {
    console.log('Usage: node benchmark/runner.js <init|record|report>');
    process.exit(1);
  }
} catch (e) {
  console.error('[benchmark error]', e.message);
  process.exit(1);
}
