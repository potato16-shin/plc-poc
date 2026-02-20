# Prompt Linter & Compiler (PLC) PoC

PLC는 기존 agentic coding 워크플로우를 바꾸지 않고, 실행 직전 컨텍스트를 컴파일해 비용/성능을 개선하는 실험 프로젝트입니다.

## PoC 목표
- 토큰 비용 절감
- First-pass success 개선
- Re-ask 비율 감소

## 핵심 기능 (PoC)
1. Relevance Pruning
2. Dedup / Conflict Resolve
3. Execution Scaffold (DONE_WHEN, 검증 단계) 자동 보강

## 데이터 수집
런별 JSONL 로그를 남겨 baseline vs PLC 비교 리포트를 생성합니다.

