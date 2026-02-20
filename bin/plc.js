#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`PLC PoC CLI v0.1.0

Usage:
  plc compile --context <paths> --query <text|@file> [--out compiled_prompt.md] [--small-model haiku]
  plc run --mode <baseline|plc> --tool <claude_code|cursor> --task-id <id> [metrics flags...]
  plc report [--from .plc/logs/runs.jsonl]

Compile options:
  --context      Comma-separated file/dir paths (markdown/txt)
  --query        Query text or @path/to/query.txt
  --out          Output markdown path (default: compiled_prompt.md)
  --small-model  Optional label for small-model refinement metadata

Run log options:
  --first-pass-success <true|false>
  --reask-count <n>
  --turns-to-done <n>
  --human-override <true|false>
  --constraint-violation <n>
  --total-tokens-actual <n>
  --latency-sec <n>
  --context-chars-in <n>
  --context-chars-out <n>
  --prompt-tokens-est-in <n>
  --prompt-tokens-est-out <n>
  --compile-ms <n>
  --lint-warnings <n>
`);
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function listFilesRecursively(p) {
  const stat = fs.statSync(p);
  if (stat.isFile()) return [p];
  const acc = [];
  for (const name of fs.readdirSync(p)) {
    const child = path.join(p, name);
    const st = fs.statSync(child);
    if (st.isDirectory()) {
      if (name === '.git' || name === 'node_modules') continue;
      acc.push(...listFilesRecursively(child));
    } else if (/\.(md|mdc|txt)$/i.test(name)) {
      acc.push(child);
    }
  }
  return acc;
}

function loadQuery(raw) {
  if (!raw) throw new Error('--query is required');
  if (raw.startsWith('@')) return fs.readFileSync(raw.slice(1), 'utf8');
  return raw;
}

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9가-힣_\-]+/g) || []).filter((w) => w.length > 1);
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function dedupLines(text) {
  const lines = text.split('\n');
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const k = line.trim().toLowerCase();
    if (!k) {
      out.push(line);
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(line);
  }
  return out.join('\n');
}

function detectConflicts(text) {
  const lower = text.toLowerCase();
  const warnings = [];
  const pairs = [
    ['never', 'always'],
    ['must not', 'must'],
    ['deny', 'allow'],
    ['forbid', 'require']
  ];
  for (const [a, b] of pairs) {
    if (lower.includes(a) && lower.includes(b)) warnings.push(`Potential conflict: '${a}' with '${b}'`);
  }
  return warnings;
}

function buildScaffold(query, context) {
  const q = query.trim();
  const hasDoneWhen = /done_when|완료\s*기준|acceptance criteria/i.test(context + '\n' + q);
  const hasValidation = /validate|test|검증|테스트/i.test(context + '\n' + q);

  const parts = [];
  if (!hasDoneWhen) {
    parts.push('- DONE_WHEN: 요청한 결과물이 생성되고, 핵심 요구사항이 충족됨');
  }
  if (!hasValidation) {
    parts.push('- VALIDATION: 변경/결과를 점검할 최소 검증 단계를 수행하고 요약 보고');
  }
  return parts;
}

function scoreChunk(chunk, queryTokens) {
  const tokens = tokenize(chunk);
  if (!tokens.length) return 0;
  let overlap = 0;
  const qset = new Set(queryTokens);
  for (const t of tokens) if (qset.has(t)) overlap++;
  return overlap / Math.sqrt(tokens.length + 1);
}

function compileContext(rawContext, query, smallModel) {
  const t0 = Date.now();
  const queryTokens = tokenize(query);
  const chunks = rawContext
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const scored = chunks.map((c) => ({ c, s: scoreChunk(c, queryTokens) }));
  const kept = scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 25)
    .map((x) => x.c);

  // fallback if query overlap too low
  const selected = kept.length ? kept : chunks.slice(0, 10);
  const deduped = dedupLines(selected.join('\n\n'));
  const conflictWarnings = detectConflicts(deduped);
  const scaffold = buildScaffold(query, deduped);

  const compiled = `# COMPILED_PROMPT\n\n## QUERY\n${query.trim()}\n\n## CONTEXT\n${deduped.trim()}\n\n## EXECUTION_SCAFFOLD\n${scaffold.length ? scaffold.join('\n') : '- (already present)'}\n\n## NOTES\n- compiler: plc-poc@0.1.0\n- small_model: ${smallModel || 'none'}\n- strategy: relevance_pruning + dedup + conflict_guard + scaffold\n`;

  const ms = Date.now() - t0;
  return {
    compiled,
    metrics: {
      context_chars_in: rawContext.length,
      context_chars_out: deduped.length,
      prompt_tokens_est_in: estimateTokens(rawContext + '\n' + query),
      prompt_tokens_est_out: estimateTokens(compiled),
      compile_ms: ms,
      lint_warnings: conflictWarnings.length,
      warnings: conflictWarnings
    }
  };
}

function appendRunLog(row, logPath = '.plc/logs/runs.jsonl') {
  const abs = path.resolve(logPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, JSON.stringify(row) + '\n', 'utf8');
}

function readJsonl(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readFileSync(abs, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function boolRate(rows, key) {
  if (!rows.length) return 0;
  const t = rows.filter((r) => r[key] === true).length;
  return t / rows.length;
}

function delta(base, plc, lowerIsBetter = true) {
  if (base === 0) {
    if (plc === 0) return 0;
    return 100;
  }
  const raw = ((plc - base) / base) * 100;
  return lowerIsBetter ? -raw : raw;
}

async function main() {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const cmd = args[0];
  const flags = parseFlags(args.slice(1));

  if (cmd === 'compile') {
    if (!flags.context) throw new Error('--context is required');
    const query = loadQuery(flags.query);
    const out = flags.out || 'compiled_prompt.md';
    const contextPaths = String(flags.context).split(',').map((s) => s.trim()).filter(Boolean);

    const files = [];
    for (const p of contextPaths) {
      const abs = path.resolve(p);
      if (!fs.existsSync(abs)) continue;
      files.push(...listFilesRecursively(abs));
    }

    const rawContext = files
      .map((f) => `\n\n<!-- source: ${path.relative(process.cwd(), f)} -->\n` + fs.readFileSync(f, 'utf8'))
      .join('\n');

    const { compiled, metrics } = compileContext(rawContext, query, flags['small-model']);
    fs.writeFileSync(path.resolve(out), compiled, 'utf8');

    console.log(`Compiled prompt written to ${out}`);
    if (metrics.warnings.length) {
      console.log('Warnings:');
      for (const w of metrics.warnings) console.log(`- ${w}`);
    }
    console.log(JSON.stringify(metrics, null, 2));
    process.exit(0);
  }

  if (cmd === 'run') {
    const required = ['mode', 'tool', 'task-id'];
    for (const r of required) if (!flags[r]) throw new Error(`--${r} is required`);

    const toNum = (k, d = 0) => Number(flags[k] ?? d);
    const toBool = (k, d = false) => {
      if (flags[k] === undefined) return d;
      return String(flags[k]).toLowerCase() === 'true';
    };

    const row = {
      run_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      tool: String(flags.tool),
      mode: String(flags.mode),
      task_id: String(flags['task-id']),
      context_chars_in: toNum('context-chars-in'),
      context_chars_out: toNum('context-chars-out'),
      prompt_tokens_est_in: toNum('prompt-tokens-est-in'),
      prompt_tokens_est_out: toNum('prompt-tokens-est-out'),
      compile_ms: toNum('compile-ms'),
      lint_warnings: toNum('lint-warnings'),
      first_pass_success: toBool('first-pass-success'),
      reask_count: toNum('reask-count'),
      turns_to_done: toNum('turns-to-done'),
      human_override: toBool('human-override'),
      constraint_violation: toNum('constraint-violation'),
      total_tokens_actual: toNum('total-tokens-actual'),
      latency_sec: toNum('latency-sec')
    };

    appendRunLog(row, flags.from || '.plc/logs/runs.jsonl');
    console.log(`Run logged: ${row.run_id}`);
    process.exit(0);
  }

  if (cmd === 'report') {
    const from = flags.from || '.plc/logs/runs.jsonl';
    const rows = readJsonl(from);
    const base = rows.filter((r) => r.mode === 'baseline');
    const plc = rows.filter((r) => r.mode === 'plc');

    const m = (arr) => ({
      n: arr.length,
      tokens_per_task: mean(arr.map((r) => r.total_tokens_actual || r.prompt_tokens_est_out || 0)),
      first_pass_rate: boolRate(arr, 'first_pass_success'),
      reask_rate: mean(arr.map((r) => (r.reask_count > 0 ? 1 : 0))),
      turns_to_done: mean(arr.map((r) => r.turns_to_done || 0)),
      violations: mean(arr.map((r) => r.constraint_violation || 0))
    });

    const mb = m(base);
    const mp = m(plc);

    const tokenGain = delta(mb.tokens_per_task, mp.tokens_per_task, true);
    const fpsGain = delta(mb.first_pass_rate, mp.first_pass_rate, false);
    const reaskGain = delta(mb.reask_rate, mp.reask_rate, true);

    console.log('=== PLC Report ===');
    console.log(`source: ${from}`);
    console.log(`baseline n=${mb.n}, plc n=${mp.n}`);
    console.log('');
    console.log('KPI (baseline -> plc):');
    console.log(`- Tokens/task: ${mb.tokens_per_task.toFixed(2)} -> ${mp.tokens_per_task.toFixed(2)} (improvement ${tokenGain.toFixed(2)}%)`);
    console.log(`- First-pass success: ${(mb.first_pass_rate * 100).toFixed(2)}% -> ${(mp.first_pass_rate * 100).toFixed(2)}% (improvement ${fpsGain.toFixed(2)}%)`);
    console.log(`- Re-ask rate: ${(mb.reask_rate * 100).toFixed(2)}% -> ${(mp.reask_rate * 100).toFixed(2)}% (improvement ${reaskGain.toFixed(2)}%)`);
    console.log(`- Turns to done: ${mb.turns_to_done.toFixed(2)} -> ${mp.turns_to_done.toFixed(2)}`);
    console.log(`- Violations: ${mb.violations.toFixed(2)} -> ${mp.violations.toFixed(2)}`);

    const passTokens = tokenGain >= 20;
    const passFps = fpsGain >= 15;
    const passReask = reaskGain >= 25;
    const passCount = [passTokens, passFps, passReask].filter(Boolean).length;

    console.log('');
    console.log('Go/No-Go gates:');
    console.log(`- token reduction >=20%: ${passTokens ? 'PASS' : 'FAIL'}`);
    console.log(`- first-pass increase >=15%: ${passFps ? 'PASS' : 'FAIL'}`);
    console.log(`- re-ask reduction >=25%: ${passReask ? 'PASS' : 'FAIL'}`);
    console.log(`=> Decision: ${passCount >= 2 ? 'GO' : 'NO-GO'}`);
    process.exit(0);
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((e) => {
  console.error('[PLC ERROR]', e.message);
  process.exit(1);
});
