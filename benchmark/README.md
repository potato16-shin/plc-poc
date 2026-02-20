# PLC Benchmark (MVP-focused)

목표: PLC가 **실제 이슈 해결에서 입력비용을 줄이면서 품질을 비열화 없이 유지**하는지 검증한다.

## Evaluation Questions
1. PLC가 resolved issue당 prompt token을 줄이는가?
2. PLC가 first-pass success를 유지/개선하는가?
3. PLC가 re-ask/reopen을 악화시키지 않는가?

## A/B Protocol
- `baseline`: 기존 방식
- `plc`: `plc compile` 결과 사용
- 통제: 동일 model/tool/timebox/repo state

## Dataset
- 최소 20 tasks
- 자동 채점 가능한 acceptance 우선
- 형식: `benchmark/tasks.jsonl`

예시 필드:
- `task_id`, `repo_path`, `issue_text`, `acceptance[]`, `type`, `difficulty`, `timebox_min`

## Run Logs
- 파일: `benchmark/runs.jsonl`
- 핵심 필드:
  - `task_id`, `mode`, `model`, `tool`
  - `resolved`, `first_pass_success`, `reask_count`, `reopened_within_7d`
  - `total_tokens_actual`
  - `prompt_tokens_actual` (optional)
  - `prompt_tokens_est` (optional)
  - `latency_sec`, `human_edits`

## Commands
```bash
node benchmark/runner.js init

node benchmark/runner.js record \
  --task ADA-001 --mode plc --model gpt-5.3-codex --tool codex \
  --resolved true --first-pass-success true --reask-count 0 --turns-to-done 3 \
  --human-edits 1 --reopened-within-7d false --total-tokens-actual 4200 \
  --prompt-tokens-est 950 --latency-sec 180

node benchmark/runner.js report
```

## Gates (MVP)
- Prompt tokens per resolved: **-30% 이상**
- First-pass success: **baseline 이상**
- Re-ask: **baseline 이하**

보조 지표:
- reopened rate (non-increase)
- human edits per resolved (non-increase)

## Outputs
- `benchmark/report.md`
- `benchmark/report.json`
