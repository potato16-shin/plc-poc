# PLC Real-World Benchmark v0.1

목표: PLC가 **실제 이슈 해결 성능**을 개선하는지 검증한다.

## 1) 평가 질문
- PLC를 적용하면 이슈 해결률이 올라가는가?
- PLC를 적용하면 해결당 토큰/시간/수정량이 줄어드는가?

## 2) 실험 설계
- 비교군
  - `baseline`: 기존 프롬프트 입력 방식
  - `plc`: `plc compile` 결과를 입력
- 통제
  - 동일 모델/동일 툴/동일 시간 제한/동일 저장소 상태
- 블라인드
  - 채점자는 baseline/plc 라벨을 모르게 평가

## 3) 데이터셋 포맷
`benchmark/tasks.jsonl`

필드:
- `task_id`: 문자열 (예: ADA-001)
- `repo_path`: 로컬 절대경로
- `issue_text`: 이슈 본문
- `acceptance`: 완료 조건(배열)
- `type`: bug|refactor|ci|docs|perf
- `difficulty`: 1~5
- `timebox_min`: 분

## 4) 실행 결과 포맷
`benchmark/runs.jsonl`

필드:
- `task_id`, `mode`(baseline|plc), `model`, `tool`
- `resolved`(bool)
- `first_pass_success`(bool)
- `reask_count`(int)
- `turns_to_done`(int)
- `human_edits`(int)
- `reopened_within_7d`(bool)
- `total_tokens_actual`(int)  // 세션 전체 토큰
- `prompt_tokens_actual`(int|null) // 프롬프트 입력 토큰(실측)
- `prompt_tokens_est`(int|null) // 프롬프트 입력 토큰(추정)
- `latency_sec`(number)
- `notes`

## 5) 합격 기준(초안)
- `closure_rate` +10%p 이상
- `reopened_rate` 감소
- `tokens_per_resolved_issue` 20% 이상 감소
- `human_edits_per_resolved` 감소

## 6) 실행 명령
```bash
# 템플릿 생성
node benchmark/runner.js init

# 1개 태스크 결과 기록(수동 입력)
node benchmark/runner.js record \
  --task ADA-001 --mode plc --model gpt-5.3-codex --tool codex \
  --resolved true --first-pass-success true --reask-count 0 --turns-to-done 3 \
  --human-edits 1 --reopened-within-7d false --total-tokens-actual 4200 --latency-sec 180

# 리포트 생성
node benchmark/runner.js report
```

## 7) 산출물
- `benchmark/report.md` : 요약 결과/합격 여부
- `benchmark/report.json` : 머신 리더블 결과
