# PLC PoC Spec v0.1

## Scope
- Targets: Claude Code, Cursor
- Input: Context files + turn Query
- Output: compiled_prompt.md

## Compiler (MVP)
1. Relevance Pruning
2. Dedup / Conflict Handling
3. Execution Scaffold Injection

## Optional Small Model
- `--small-model` 옵션으로 ambiguity 문장 최소 리라이트

## Logging Schema (JSONL)
- run_id, timestamp, tool, mode, task_id
- context_chars_in/out
- prompt_tokens_est_in/out
- compile_ms, lint_warnings
- first_pass_success, reask_count, turns_to_done
- human_override, constraint_violation
- total_tokens_actual, latency_sec

Path: `.plc/logs/runs.jsonl`

## Report
- KPI summary
- baseline vs plc delta
- go/no-go gate

## Success Gates
- Tokens per successful task: -20%
- First-pass success: +15%
- Re-ask rate: -25%
- Authoring overhead: <= +10%
