#!/usr/bin/env node
import {
  helpText,
  parseFlags,
  compileFromFlags,
  makeRunRow,
  appendRunLog,
  readJsonl,
  computeReport,
  renderReport
} from '../src/core.js';

const args = process.argv.slice(2);

async function main() {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(helpText());
    process.exit(0);
  }

  const cmd = args[0];
  const flags = parseFlags(args.slice(1));

  if (cmd === 'compile') {
    const { out, metrics } = compileFromFlags(flags);
    console.log(`Compiled prompt written to ${out}`);
    if (metrics.warnings.length) {
      console.log('Warnings:');
      for (const w of metrics.warnings) console.log(`- ${w}`);
    }
    console.log(JSON.stringify(metrics, null, 2));
    process.exit(0);
  }

  if (cmd === 'run') {
    const row = makeRunRow(flags);
    appendRunLog(row, flags.from || '.plc/logs/runs.jsonl');
    console.log(`Run logged: ${row.run_id}`);
    process.exit(0);
  }

  if (cmd === 'report') {
    const from = flags.from || '.plc/logs/runs.jsonl';
    const report = computeReport(readJsonl(from));
    console.log(renderReport(report, from));
    process.exit(0);
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((e) => {
  console.error('[PLC ERROR]', e.message);
  process.exit(1);
});
