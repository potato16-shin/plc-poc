# PLC MVP Re-Design (v0)

## Product Thesis
PLC는 새로운 에이전트가 아니라 **Pre-send Context Optimizer**다.
기존 에이전틱 코딩 도구 호출 직전에 입력 컨텍스트를 최적화한다.

## North Star (Only 2)
1. Prompt input token 절감
2. First-pass success 유지 이상(비열화 금지)

---

## Strict Scope
### In
- Query 기반 관련 컨텍스트 선택(top-k)
- 중복 제거(dedup)
- 충돌 경고(conflict guard)
- 실행 슬롯 보강(DONE_WHEN / VALIDATION)
- baseline vs plc 측정/리포트

### Out
- 에이전트 실행 오케스트레이션
- 복잡한 자연어 DSL 설계
- 멀티모델 라우팅 자동화
- 품질 자동판정 AI 심사관

---

## Minimal Architecture
1. `ingest` — 파일 인덱싱(코드/설정/문서)
2. `select` — query 관련도 기반 선택
3. `normalize` — dedup + conflict + scaffold
4. `emit` — compiled prompt
5. `measure` — 실험 로그 + A/B report

LLM 보정은 기본 OFF, 필요할 때만 ON.

---

## CLI Contract (MVP)
- `plc compile`
- `plc run`
- `plc report`

이외 명령은 MVP 범위 밖.

---

## Benchmark Contract (MVP)
- 태스크 수: 최소 20
- 동일 조건 A/B: model/tool/timebox 동일
- 자동 채점 가능한 acceptance 우선

### Core KPI (4)
1. Prompt tokens per resolved issue
2. First-pass success rate
3. Re-ask rate
4. Reopened rate

### Go / No-Go
- Prompt tokens per resolved: **-30% 이상**
- First-pass success: **baseline 이상(비열화 금지)**
- Re-ask rate: **baseline 이하(비열화 금지)**

---

## 2-Week Execution Plan
### Week 1
- compile 안정화
- 측정 로그 신뢰성 보강
- 20-task benchmark set 확정

### Week 2
- A/B 실행
- KPI 산출
- Go/No-Go 의사결정
