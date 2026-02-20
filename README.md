# Prompt Linter & Compiler (PLC) PoC

PLC는 기존 agentic coding 워크플로우를 바꾸지 않고, 실행 직전 컨텍스트를 컴파일해 비용/성능을 개선하는 실험 CLI입니다.

## 설치/실행

```bash
npm i
node bin/plc.js --help
# 또는
npm link
plc --help
```

## 1) Compile

```bash
plc compile \
  --context "./" \
  --query "로그인 버그 수정하고 테스트까지 수행해줘" \
  --out compiled_prompt.md
```

기능:
- relevance pruning
- dedup/conflict guard
- execution scaffold(DONE_WHEN/VALIDATION) 보강

## 2) Run 로그 기록

```bash
plc run \
  --mode plc \
  --tool claude_code \
  --task-id TASK-001 \
  --first-pass-success true \
  --reask-count 0 \
  --turns-to-done 3 \
  --total-tokens-actual 4200
```

로그 파일: `.plc/logs/runs.jsonl`

## 3) Report

```bash
plc report --from .plc/logs/runs.jsonl
```

리포트:
- baseline vs plc KPI 비교
- 개선율(%)
- Go/No-Go 게이트 판정

## 배포

- GitHub: public repo
- 릴리즈: GitHub Release(v0.1.0)
- npm 배포는 계정/토큰 준비 시 `npm publish`로 진행 가능
