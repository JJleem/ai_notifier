# AI 특별 사용량 초기화 · 서비스 장애 Slack 알림

Node.js 24 + TypeScript strict 기반의 일회성 실행 봇입니다. Claude Code와 OpenAI Codex의 **운영사 특별 초기화 공지** 및 **해당 개발 도구에 영향을 주는 공식 서비스 장애·복구**를 감지해 한국어 Slack Block Kit 메시지를 보냅니다. 상시 서버, DB, 프론트엔드, 유료 LLM API는 사용하지 않습니다.

## 바로 배포하기

이 저장소에는 실행 코드, 의존성 잠금 파일, 테스트, 초기 상태 파일, 운영 및 CI workflow가 포함되어 있습니다. 코드를 추가로 작성하거나 빌드 결과물을 업로드할 필요가 없습니다.

1. `.github/`, `src/`, `tests/`, `state/`, `package.json`, `package-lock.json`, `tsconfig.json`을 포함한 프로젝트 전체를 GitHub 기본 브랜치에 업로드합니다. `.env`, `node_modules`, `dist`는 업로드하지 않습니다.
2. 저장소 **Settings → Secrets and variables → Actions**에 Secret **`SLACK_WEBHOOK_URL`** 하나를 등록합니다. 기본 운영에 다른 Secret이나 Variable은 필요 없습니다.
3. **Actions → Check special usage resets → Run workflow**로 최초 기준을 등록합니다. 이후 15분 간격 예약 실행이 동작하며 새 대상 이벤트가 있을 때만 Slack에 보냅니다.

workflow가 Node.js 24 준비, `npm ci`, 빌드·테스트, 실행, 변경된 상태 커밋을 수행합니다. 저장소 쓰기 권한도 workflow에 선언되어 있습니다. 일반 저장소에서는 이를 그대로 사용하며, 조직 정책이나 브랜치 보호가 봇의 쓰기를 제한한다면 저장소 관리자가 허용해야 합니다. 이는 코드에서 우회할 수 없는 GitHub 권한 제약입니다.

업로드/PR 시에는 Secret 없이 `Validate project` workflow가 빌드·타입 검사·테스트를 실행합니다. 운영 workflow는 PR에서 실행하지 않습니다. 최초 실행이 Slack에 과거 공지를 보내지 않는 것은 정상입니다. 기본 검증 정책은 `curated`만 허용하며 `upstream`/잠정 이벤트 허용은 아래 선택 설정을 참고하세요.

## 구조와 동작

```text
GitHub Actions (15분 간격 또는 수동)
  → 특별 초기화 검사 → seen-events.json
  → OpenAI 공식 장애 검사 → incident-events.json (openai)
  → Claude 공식 장애 검사 → incident-events.json (anthropic)
  → 전송할 이벤트만 Slack 전송 → 성공 상태 저장 → 두 상태 파일 Git 커밋/푸시
  ※ 각 검사의 오류를 기록한 뒤 다음 검사 진행, 최종 종료코드로 실패 보고
```

- `src/config.ts`: 환경변수 검증. Webhook은 Slack HTTPS 호스트만 허용합니다.
- `src/services/reset-api.ts`: Fetch 수집, 실제 API 스키마 검증, 원문 URL 정규화.
- `src/services/event-detector.ts`: 대상 이벤트 필터와 중복 판별.
- `src/services/state-store.ts`: 상태 검증, 임시 파일 + rename 저장, 로컬 실행 잠금.
- `src/services/slack.ts`: 서비스별 제목/색상, 일반·보관형 구분, 한국어 Block Kit.
- `src/utils/format.ts`: 유료 API 없는 규칙 기반 안내. 향후 요약기 교체 지점입니다.
- `src/runner.ts`: 최초 기준 등록과 전송/저장 순서 제어. 테스트에서 외부 의존성을 주입합니다.
- `src/services/status-api.ts`: 공식 장애 이력과 Claude 구성요소 수집·정규화.
- `src/services/incident-detector.ts`: 서비스 관련성, 발생/복구/완료 요약 판별.
- `src/services/incident-state.ts`, `src/types/incident.ts`: 초기화 상태와 독립된 장애 상태.
- `src/utils/incident-format.ts`: 장애 Block Kit, KST·실제 시각 기반 지속 시간.
- `src/checks.ts`: 기능별 오류 격리. 기존 `src/runner.ts`는 변경하지 않았습니다.

## 서비스 장애 알림 (추가 기능)

### 기존 배포에 적용

기존 `state/seen-events.json`을 **덮어쓰거나 초기화하지 말고 그대로 유지**하세요. 새 `state/incident-events.json` 및 추가/변경 코드를 커밋하면 기존 스케줄이 초기화 검사와 장애 검사를 함께 수행합니다. **추가 GitHub Secret·환경변수는 없습니다.** 기존 `SLACK_WEBHOOK_URL`을 재사용하고 `DRY_RUN`도 두 기능에 공통 적용합니다. 초기화 관련 환경변수와 필터는 유지됩니다.

장애 상태에는 provider별 `initializedAt`이 있습니다. 처음 정상 수집한 provider의 기존 관련 사건을 한 번에 기준 등록하며 과거 알림을 보내지 않습니다. OpenAI가 실패하고 Claude만 성공하면 Claude만 초기화됩니다. 첫 장애 실행 당시 진행 중이던 사건도 발생 알림은 생략하지만, 이후 공식 `resolved`를 확인하면 복구 알림은 전송합니다. 이미 완료된 기준 사건은 이후에도 알리지 않습니다.

### 공식 출처와 스키마

| 공급사 | 수집 주소 | 실제 확인한 차이 |
| --- | --- | --- |
| OpenAI | [incidents.json](https://status.openai.com/api/v2/incidents.json) | 사건의 `components`가 누락되어 있음 |
| Anthropic | [incidents.json](https://status.claude.com/api/v2/incidents.json) | `components`, `started_at`, 업데이트별 `affected_components` 제공 |
| Anthropic | [summary.json](https://status.claude.com/api/v2/summary.json) | Claude Code 등 구성요소 ID·이름 제공 |

`id`, `name`, `status`, `impact`, `created_at`, `updated_at`, `resolved_at`, `incident_updates`를 검증합니다. `components`, `started_at`, `display_at`, `affected_components`는 실제로 제공된 경우에만 읽습니다. UTC `Z`, 소수초, 명시된 UTC offset을 지원합니다. API가 제공하지 않은 범위/시각을 만들어 넣지 않습니다. `resolved_at`이 없으면 공식 resolved 업데이트의 `display_at` 또는 `created_at`만 복구 시각으로 사용할 수 있습니다.

공식 상세 링크는 해당 운영사 상태 페이지의 `/incidents/{검증된 ID}`로 구성합니다. 외부 응답의 임의 URL을 메시지에 그대로 넣지 않습니다.

### 관련 장애 판별

1. 사건의 `components` 및 업데이트의 `affected_components`에서 Codex/Claude Code 구성요소를 우선 확인합니다. 구성요소 이름이 없고 ID만 있으면 Claude summary의 ID→이름을 사용합니다.
2. 구성요소만으로 판단할 수 없으면 제목/업데이트에서 `Codex` 또는 `Claude Code`에 대한 명시적 언급을 확인합니다. `Codex is not affected`, `does not affect Claude Code`와 같은 비영향 문장은 긍정 증거로 쓰지 않습니다.
3. API 전반/ChatGPT/Claude 모델 장애라고 해서 해당 개발 도구의 장애로 추정하지 않습니다. Claude API 장애도 Claude Code 구성요소 또는 명시적 영향 언급이 필요합니다. 광범위 장애도 같은 원칙입니다.

OpenAI의 hosted Code Reviews 사건은 [공식 상세 페이지](https://status.openai.com/incidents/01M5Y60NQGGN514EB3943V94EN)도 직접 확인했지만 구성요소가 지정되어 있지 않았습니다. 봇은 이를 Codex 장애라고 추정하지 않습니다. **상세 HTML 자동 수집·추론은 구현하지 않았으며**, 공식 API에서 충분한 근거가 없는 사건은 생략합니다. 따라서 관련성이 본문에 명시되지 않은 실제 장애를 놓칠 수 있습니다. 영어 비영향 문구 처리는 보수적인 규칙이며 모든 자연어 표현을 이해하는 것은 아닙니다.

### 생명주기와 전송 정책

| 공식 상태 | 한국어 | 기본 알림 |
| --- | --- | --- |
| `investigating` | 조사 중 | 새 사건이면 발생 1회 |
| `identified` | 원인 파악 | 처음 발견한 진행 사건이면 발생 1회, 중간 변경은 생략 |
| `monitoring` | 복구 확인 중 | 처음 발견한 진행 사건이면 발생 1회, 반복 변경은 생략 |
| `resolved` | 해결됨 | 공식 상태 확인 후 복구 1회 |
| `postmortem` | 사후 분석 | 별도 전송 없음, resolved로 추정하지 않음 |

- 목록에서 사라졌다는 이유로 복구 처리하지 않습니다. 재등장하면 기존 플래그를 사용합니다. 이전보다 `updated_at`이 오래된 스냅샷은 무시합니다.
- 같은 `provider:incidentId`의 발생과 복구는 각각 성공 플래그를 관리합니다. 같은 ID가 다른 공급사에 있어도 충돌하지 않습니다.
- 처음 발견했을 때 이미 `resolved`인 사건은 발생 알림을 뒤늦게 보내지 않습니다. **시작 시각(`started_at`, 없으면 등록 시각)이 최근 24시간 이내이고, 복구가 해당 provider의 설치 기준 이후이며 미래가 아닐 때** 완료 요약 1건만 전송합니다. 그 외 완료 이력은 저장만 합니다.
- 늦게 게시된 **진행 중** 사건은 생성 시각이 오래되어도 발생 알림을 보냅니다. 늦게 게시된 완료 사건은 위 24시간 조건에 따라 요약 또는 생략합니다. 최초 `postmortem`으로 발견한 사건에는 완료 요약을 보내지 않습니다.
- 복구 메시지는 공식 `started_at`과 복구 시각이 있을 때만 지속 시간을 계산합니다. `created_at`만 있으면 사건 등록 시각을 별도로 표시하고 실제 시작/지속 시간은 `공식 공지 확인 필요`로 표시합니다. 등록 시각을 실제 장애 발생 시각으로 단정하지 않습니다.
- 한국어 제목/상태/필드와 KST를 사용하며 영향 설명은 번역으로 의미를 바꾸지 않도록 **길이를 제한한 공식 원문**으로 표시합니다. 외부 문구는 plain text와 특수문자 처리로 멘션/마크다운 실행을 방지합니다.

### 상태·오류 격리

`state/incident-events.json`은 기존 초기화 파일과 독립된 버전 1 상태입니다. 레코드는 `provider`, `incidentId`, `originalStatus`, `lastKnownStatus`, `firstDetectedAt`, `lastCheckedAt`, `sourceUpdatedAt`, 전송 성공 플래그, 과거 알림 억제 플래그를 보관합니다. `lastCheckedAt`은 **영속 상태가 변경된 마지막 확인 시각**이며 같은 스냅샷을 재검사할 때마다 Git 커밋을 만들지 않습니다.

Slack 성공 응답 이후에만 성공 플래그를 저장합니다. 실패한 이벤트는 완료 처리하지 않으며 다음 검사에서 상태에 따라 재시도합니다. 발생 전송에 실패한 사이 사건이 해결되면, 과거 발생 알림 대신 최근 완료 요약 정책이 적용됩니다. 한 provider의 Slack 실패는 해당 검사를 중단하지만 다른 provider 검사는 계속합니다. 기존 성공 건은 건별 체크포인트로 보존합니다. 최초 기준 등록만큼은 부분 초기화가 남지 않도록 전체를 한 번에 원자적으로 저장합니다.

기존 workflow·고정 concurrency 그룹을 재사용해 별도 workflow 간 상태 경쟁을 만들지 않았습니다. 두 상태 파일을 하나의 커밋에 포함하고, 나중 검사 실패에도 앞선 성공 상태를 커밋합니다. 실행 진입점은 기존 파일 잠금도 전체 검사 동안 유지합니다. 별도 workflow보다 Secret/설치/잠금 설정이 단순하고, 체크별 오류 격리로 API 한 곳의 실패가 다른 검사를 막지 않습니다. 대신 모든 검사가 같은 실행 시간을 공유합니다.

초기화 API 오류, OpenAI API 오류, Claude API 오류는 각각 로그에 기록하며 모든 검사를 수행한 뒤 실패 종료합니다. Claude summary는 보조 정보이므로 실패 시 경고 후 사건 자체의 구성요소/본문으로 처리합니다. 잘못된 사건 JSON/스키마는 해당 provider의 상태를 변경하지 않습니다. 장애 파일 손상/누락은 자동 초기화하지 않으며 장애 검사만 실패합니다. 초기화 검사는 계속할 수 있습니다.

HTTP 타임아웃·429/5xx 백오프는 기존 공통 HTTP 구현을 재사용합니다. 정상 실행당 기존 초기화 API 1회 + 장애 관련 API 3회이며, 무분별한 상세 페이지 폴링은 하지 않습니다. GitHub 예약 실행 지연, 제공처의 제한된 이력(검증 당시 OpenAI 25건·Claude 50건), 미게시/늦은 게시 때문에 모든 장애를 포착할 수는 없습니다. 오래 진행 중인 사건이 이력 목록에서 밀려나면 개별 상세 API로 추가 추적하지 않으므로 복구를 놓칠 수 있습니다.

복구 알림도 Slack 응답 유실 또는 전송 후 디스크/커밋/푸시 실패 시 중복될 수 있습니다. `reset-state-recovery-*` artifact에는 이제 **두 상태 파일 모두** 포함됩니다. 복구 시 공급사별 초기화 시각과 성공 플래그가 유실되지 않도록 확인하세요.

### 추가 검증 결과

2026-10-28에 세 공식 API를 직접 요청했습니다. 내려받은 실제 응답을 파서로 검증한 결과 **OpenAI 25건 중 관련 5건, Claude 50건 중 관련 37건**, Claude summary 구성요소 6개를 확인했습니다. 이 시점의 사건은 모두 resolved였으며 관련성은 구성요소·공식 문구를 사용한 규칙 판별 결과입니다. 실제 장애가 진행되는 상황의 재현 결과로 해석하지 마세요.

추가 합성 fixture/Mock 테스트는 두 서비스의 신규·복구 각 1회, 중간 상태 반복/목록 소실/postmortem, 관련성/비영향 필터, 최초 기준 원자성, 공급사별 독립 상태, 늦은 게시, 폴링 사이 완료 요약, API/Slack 실패·재시도, 두 응답 스키마, summary 보완/장애, 오류 격리, KST/지속 시간/안전한 메시지, 상태 손상을 검증합니다. **기존 27개 + 신규 25개 = 총 52개 테스트가 통과**했습니다.

별도로 실제 Node Fetch 기반 전체 `DRY_RUN`에서 기존 초기화 89건과 두 장애 검사 모두 성공했고 Slack 호출·두 상태 파일 변경이 없음을 확인했습니다. 실제 Slack 수신 및 GitHub 원격 커밋/스케줄은 사용자 배포 환경에서 확인해야 합니다.

## 데이터 출처와 이용 조건

주 데이터는 [Claude Resets 실시간 API](https://claude-resets.com/api/resets)입니다. 이 서비스는 Anthropic/OpenAI의 공식 API가 아니라 공개 발표를 정리하는 **제3자 데이터 제공처**입니다. 공식 원문과 제공처를 Slack에 모두 표시합니다. 공식 X 게시물을 직접 수집하거나 독립 검증했다고 주장하지 않습니다.

- [Claude Resets 데이터 계약 및 라이선스](https://claude-resets.com/llms.txt): 카탈로그는 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 원문 인용의 권리는 작성자에게 있으며 Codex 행의 원천은 Codex Resets입니다.
- [Codex Resets API 이용 안내](https://codex-resets.com/api/docs): 무료, API 키 불필요, 데이터를 표시하는 곳에 Codex Resets 링크를 요구합니다. Slack의 Codex 메시지에 해당 링크를 포함합니다. 별도의 포괄적인 재배포 라이선스는 확인하지 못했으므로 전체 원천 데이터는 저장소에 포함하지 않습니다. 제품화·원문 재배포 시 조건을 다시 확인하세요.
- 데이터셋 요약을 한국어 규칙 기반 안내로 변환하며 제공처 기준 범위임을 표시합니다. 영어 원문을 무제한 복제하지 않습니다.
- 상태에는 식별자와 중복 방지용 정규화 원문 URL만 저장합니다. 원문 게시글 및 요약 전체를 저장하지 않습니다.

2026-10-28 실제 URL 요청으로 확인한 구조:

```typescript
{
  providers: {
    claude: { name, product, account, accountUrl, events: [...] },
    codex: { name, product, account, accountUrl, events: [...] }
  },
  meta: { detector: { status }, codexSync: { status }, ... }
}
// event: id, date, kind, resetType?, usableUntil?, account?, scope?, note?, url?, verification?
```

Claude 20건(policy 포함), Codex 69건을 직접 내려받고 구현한 파서로 총 89건을 검증했습니다. `verification`에는 `curated`와 `upstream`이 있었으며 문서에는 `provisional`도 정의되어 있습니다. 메타데이터는 확장 가능하므로 파서가 무시하고, 필수 provider/배열/이벤트 필드는 엄격히 검증합니다. 누락된 `verification`은 `unknown`입니다.

보조 [정적 JSON](https://claude-resets.com/data/resets.json)은 실제 응답에 검증 필드가 없었습니다. [Codex 사이트](https://codex-resets.com/)와 `llms.txt`는 출처·스키마 검토에 사용합니다. **자동 fallback 또는 HTML 스크래핑은 구현하지 않았습니다.** 오래된 대체 데이터로 오발송하는 것보다 실패하고 다음 실행을 기다리는 방식을 택했습니다. `RESET_API_URL` 변경 시에도 동일한 스키마와 필터가 적용됩니다.

## 알림 대상과 제한

- provider는 `claude`/`codex`, `kind`는 `reset`인 항목만 처리합니다.
- 기본 검증 정책은 `curated`만 허용합니다. 이는 **제공처의 카탈로그 등재**를 뜻하며 봇의 독립적인 공식 확인은 아닙니다.
- `upstream`은 Codex 상위 제공처의 분류 결과입니다. 최신 Codex 이벤트가 이 상태라면 기본 설정에서는 curated 등재까지 기다립니다. 신속한 제공처 기반 알림을 원하면 `ALLOW_UPSTREAM_EVENTS=true`로 설정하세요. `provisional`은 별도 `ALLOW_PROVISIONAL_EVENTS=true`로 허용합니다.
- 유효한 UTC ISO 시간과 출처 URL이 있어야 합니다. X/Twitter status 링크와 코드에 명시된 공식 발표 호스트만 허용합니다. 새로운 공식 발표 도메인은 검토 후 허용 목록에 추가하세요. X 계정의 운영사 소속 여부는 제공처 큐레이션에 의존합니다.
- `resetType` 생략 또는 `regular`는 일반 특별 초기화, `banked`는 사용자가 적용하는 초기화권입니다.
- 범위가 명시된 reset 문구만 제한적으로 추출합니다. 단순 한도 증가 문구를 초기화 범위로 추론하지 않습니다. 대상 플랜은 구조화된 `scope`만 사용하고, 모르면 `공식 공지 확인 필요`를 표시합니다.
- policy/요금제/일반 뉴스/주기적 5시간·주간 회복은 제외합니다. 상위 제공처가 잘못 `reset`으로 분류하면 오탐 가능성은 있습니다.
- 설치 시각 이전 공지, 미래 공지, **발표 후 7일 초과** 공지, 이미 사용 기한이 지난 보관형 이벤트는 제외합니다. 지연된 등재·장애가 7일을 넘으면 알림이 생략되는 보수적 정책입니다.
- `usableUntil`이 있는 경우에만 사용 기한과 알림 생성 시점의 남은 기간을 표시합니다. 이 데이터 계약은 날짜만 명시된 기한을 해당 일자 **23:59:59 UTC**로 정규화합니다. 원문이 정확한 시각을 제시했는지와 실제 적용 조건은 반드시 공식 링크에서 확인하세요. 이력은 개인 계정의 남은 초기화권 잔고가 아닙니다.
- 계산/저장은 UTC, 표시만 `Asia/Seoul`입니다. 외부 문구는 plain text 필드 및 특수문자 이스케이프를 사용하고, 외부 원문을 mrkdwn이나 멘션으로 삽입하지 않습니다.

## Slack Webhook 발급

1. [Slack 앱 만들기](https://api.slack.com/apps)에서 워크스페이스용 앱을 생성합니다.
2. **Incoming Webhooks → Activate Incoming Webhooks**를 켭니다.
3. **Add New Webhook to Workspace**에서 받을 채널을 선택하고 승인합니다.
4. 발급받은 URL을 GitHub Secret 또는 로컬 `.env`에 저장합니다. Webhook은 해당 채널과 연결되며 코드에서 채널을 바꾸지 않습니다.

자세한 절차는 [Slack 공식 문서](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)를 참고하세요. URL은 비밀이며 코드/커밋/스크린샷에 넣지 마세요. 앱은 HTTP 응답 본문과 URL을 오류 로그에 출력하지 않습니다.

## 로컬 실행

Node.js 24가 필요합니다. 런타임 외부 패키지는 없고 TypeScript와 Node 타입만 개발 의존성으로 설치합니다.

```sh
npm ci
npm test
cp .env.example .env
```

PowerShell에서는 `Copy-Item .env.example .env`를 사용하세요. npm.ps1 실행 정책에 막히면 `npm.cmd`를 사용합니다.

`.env`의 `DRY_RUN=true`를 유지한 상태에서:

```sh
npm run build
npm start
```

Node가 `.env`를 읽습니다. **DRY_RUN은 Slack을 호출하지 않고 상태도 변경하지 않습니다.** 최초 미초기화 상태에서는 기준 등록 예정 건수만 출력하고, 초기화된 상태에서는 전송 예정 서비스/ID만 출력합니다. 실제 공지를 흉내 낸 샘플을 전송하지 않습니다.

실제 운영은 `SLACK_WEBHOOK_URL`을 채우고 `DRY_RUN=false`로 변경 후 `npm start`를 실행합니다. 로컬과 GitHub에서 서로 독립적인 상태로 운영하면 중복될 수 있으므로 하나의 운영 실행처만 사용하세요. 로컬에서 운영 상태를 바꿨다면 GitHub 스케줄 재개 전에 상태를 동기화해야 합니다.

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `SLACK_WEBHOOK_URL` | 없음 | 실전송 시 필수. Slack Incoming Webhook HTTPS URL |
| `RESET_API_URL` | `https://claude-resets.com/api/resets` | 동일 계약의 JSON API, 인증정보 없는 HTTPS URL |
| `DRY_RUN` | `false` | `true`이면 전송/상태 저장 생략 |
| `ALLOW_PROVISIONAL_EVENTS` | `false` | 제공처의 잠정 분류 이벤트 허용 |
| `ALLOW_UPSTREAM_EVENTS` | `false` | Codex 상위 제공처 분류 이벤트 허용 |

Boolean은 정확히 `true`/`false`만 허용합니다. `.env.example`은 안전한 확인을 위해 DRY_RUN을 true로 설정합니다. 실제 `.env`는 `.gitignore`로 제외합니다. 별도 LLM/공급사 로그인/API 키는 필요 없습니다.

## GitHub 배포

1. GitHub에서 빈 저장소를 생성합니다. 현재 프로젝트를 업로드하세요.

   ```sh
   git init
   git add .
   git commit -m "Implement special reset notifier"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/ai-reset-notifier.git
   git push -u origin main
   ```

   이미 Git 저장소/remote가 있다면 해당 초기화 단계는 생략하고 기존 브랜치를 사용하세요. `.env`가 stage되지 않았는지 확인하세요. `state/seen-events.json`과 `package-lock.json`은 커밋해야 합니다.

2. **Settings → Secrets and variables → Actions → Secrets**에 `SLACK_WEBHOOK_URL`을 등록합니다. 필요한 사용자 Secret은 이것 하나입니다. `GITHUB_TOKEN`은 Actions가 자동 발급합니다.
3. 같은 화면의 **Variables**에서 필요할 때 `ALLOW_UPSTREAM_EVENTS`, `ALLOW_PROVISIONAL_EVENTS`, `RESET_API_URL`을 설정합니다. 문자열 `true`/`false`를 사용하세요. workflow는 `DRY_RUN=false`로 운영합니다.
4. **Settings → Actions → General → Workflow permissions → Read and write permissions**를 허용합니다. workflow도 `permissions: contents: write`를 지정합니다. 조직 정책/브랜치 보호가 봇 커밋을 막지 않아야 합니다. 운영 전 상태 커밋/푸시가 가능한 전용 저장소인지 확인하세요. 보호 규칙을 무작정 해제하기보다 운영 저장소의 권한 정책을 결정하세요.
5. Actions 사용을 활성화하고 기본 브랜치에 `.github/workflows/check-resets.yml`이 존재하도록 합니다.
6. **Actions → Check special usage resets → Run workflow**로 처음 실행합니다. 수동 실행에서도 항상 최신 기본 브랜치를 체크아웃합니다.
7. 최초 실행 로그와 상태 커밋이 생성되었는지 확인합니다. **최초 실행에서는 Slack이 오지 않는 것이 정상**입니다. 기존 이벤트를 전부 기준 등록한 뒤 이후 새 이벤트만 보냅니다.

cron은 UTC 매시 7/22/37/52분으로 15분 간격입니다. 정각 집중을 피했지만 [GitHub의 schedule 실행](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)은 지연되거나 누락될 수 있어 실시간/15분 이내 수신을 보장하지 않습니다. 공개 저장소는 장기간 활동이 없으면 예약 실행이 비활성화될 수 있으므로 Actions 탭을 주기적으로 확인하세요.

## 상태와 중복 방지

`state/seen-events.json`의 `initializedAt: null`은 배포 전 초기 상태입니다. 첫 정상 실행에서 UTC 설치 시각과 기존 전체 이벤트 식별자를 저장하며 과거 알림을 보내지 않습니다. DRY_RUN은 이 파일을 바꾸지 않습니다.

- `provider:id`로 서비스별 ID를 관리합니다.
- 원문 URL도 저장합니다. X/Twitter 도메인, 계정명, tracking query 차이를 정규화해 같은 status ID는 하나의 공지로 취급합니다. 서로 다른 소스/ID/서비스에 같은 원문이 들어와도 한 번만 알립니다.
- 서로 다른 원문 게시물이 실제로 같은 사건을 가리키는 경우에는 확실한 연결 필드가 없어 자동 합치지 않습니다. 문구 유사도로 합치면 별개 공지를 누락시킬 수 있습니다.
- 성공 응답 `ok`를 확인한 이벤트만 즉시 저장합니다. 같은 실행에서 나중 이벤트가 실패해도 이전 성공 상태를 workflow의 `always()` 단계에서 커밋합니다. 변화가 없으면 파일 저장/커밋을 하지 않습니다.
- workflow 전체에 고정 [concurrency 그룹](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)과 `cancel-in-progress: false`를 적용합니다. 다른 브랜치의 수동 실행도 같은 그룹을 쓰며 진행 중 전송을 새 실행이 취소하지 않습니다. 대기 실행은 GitHub 정책에 따라 교체될 수 있습니다.
- 로컬에서는 `wx` 파일 잠금으로 같은 상태의 동시 실행을 거부합니다. 강제 종료로 `.lock`이 남았다면 실제 프로세스가 종료되었는지 확인한 뒤 잠금 파일만 제거하세요. 상태 파일을 지우면 안 됩니다.
- 푸시는 강제 덮어쓰기를 하지 않습니다. 사람이 동시에 기본 브랜치에 커밋하면 non-fast-forward로 실패할 수 있습니다. 자동 rebase/상태 병합으로 오염시키지 않습니다.

**정확히 한 번 전송은 보장할 수 없습니다.** Slack 성공 후 디스크 저장/커밋/푸시 실패, 또는 Slack이 요청을 수신했지만 응답이 유실된 경우 재전송될 수 있습니다. Incoming Webhook은 상태 파일과 트랜잭션이나 idempotency key를 공유하지 않습니다. HTTP 재시도 자체도 이런 상황에서는 중복을 만들 수 있습니다.

실패 시 workflow가 `reset-state-recovery-실행ID` artifact에 상태 체크포인트를 7일 보관합니다. 상태 저장 자체가 실패하면 artifact도 마지막 저장분까지만 포함합니다. 푸시가 실패하면 예약 실행을 잠시 중지하고 Slack 수신 내역과 artifact를 확인한 다음, **기존 seenIds/seenSources를 유실하지 않도록 합쳐** 상태를 커밋하고 재개하세요. 상태가 손상/누락되면 봇은 재초기화하지 않고 실패합니다. Git 이력 또는 artifact에서 복구하세요. 단순히 빈 상태로 교체하면 과거 미발송 내역도 기준 등록되어 누락됩니다.

## 장애 대응과 요청 제한

- 기본은 실행당 API 1회이며 오류 시 최대 총 3회입니다. 정상 시 약 96회/일입니다. 공개 문서에서 수치화된 호출 한도는 확인하지 못했습니다. 제공처의 변경된 정책을 우선 따르세요.
- 요청 및 본문 읽기에 15초 제한, 네트워크 오류/429/5xx에는 제한된 지수 백오프와 jitter를 적용합니다. `Retry-After`가 있으면 기다립니다. 대기가 60초를 초과하면 조기 실패하고 다음 스케줄로 넘깁니다. 일반 4xx는 재시도하지 않습니다.
- 잘못된 JSON/필수 필드/필수 이벤트 배열 누락/잘못된 날짜는 전체 실행 실패입니다. API 장애를 신규 이벤트 0건으로 취급해 상태를 덮어쓰지 않습니다.
- 빈 이벤트 배열은 유효하지만 설치 기준 시각과 7일 제한을 유지하므로 이후 오래된 데이터가 복구되어도 새 공지로 처리하지 않습니다.
- `meta.detector`/`meta.codexSync`의 상태가 stale/offline이어도 유효한 카탈로그 기록 자체는 사용할 수 있습니다. 봇은 이를 실시간 수집 보장으로 해석하지 않으며 제공처가 수집하지 못한 공지는 알 수 없습니다.
- Slack 오류는 실패로 종료하며 해당 이벤트를 완료 처리하지 않습니다. Actions 실패 로그를 확인하고 Webhook 유효성/채널/권한을 점검하세요.

## 테스트와 검증 범위

```sh
npm ci
npm test
npm run check
```

Node 내장 테스트 러너를 사용합니다. 외부 Slack 없이 테스트용 합성 이벤트와 `tests/fixtures/catalog.json`으로 실행합니다. 테스트는 최초 알림 생략, 두 provider 신규 감지, 중복, 보관형/KST, policy 제외, provisional/upstream 정책, 전송 실패 체크포인트, 정렬, 과거/미래/만료 제외, URL 중복, API 장애/잘못된 데이터, 429/5xx/네트워크/요청 및 본문 타임아웃, Slack 응답, 멘션 처리, 환경변수, 파일 손상/잠금을 검증합니다. 샘플은 테스트에서만 쓰며 실전송 경로에 주입하지 않습니다.

구현 환경에서 `npm test` **27개 통과**, `npm run check` 통과를 확인했습니다. 실제 API 응답은 내려받아 파서로 89건을 확인했고, Node Fetch를 사용하는 실제 `DRY_RUN` 실행에서도 최초 기준 등록 89건·Slack 전송 없음·상태 미변경을 확인했습니다. 실제 Slack 채널 전송과 GitHub의 예약 실행/커밋 권한은 사용자의 Webhook 및 저장소 설정이 필요하므로 로컬 테스트만으로 보장하지 않습니다. 첫 수동 실행과 이후 실제 신규 이벤트에서 배포 환경을 확인하세요.

## 비용과 운영 제약

상시 서버/DB/LLM 비용은 없습니다. GitHub Actions runner 시간·artifact 저장 비용은 저장소 유형과 계정 제공량/정책에 따라 달라집니다. 하루 약 96회 실행되며 매번 npm 설치/테스트를 하므로 Actions 사용량을 확인하세요. Slack/제공처의 요금·정책도 변경될 수 있습니다. 저장소 상태 파일은 운영이 지속되면서 증가합니다.

제공처 누락/오분류/정정, X 게시물 삭제, 신규 공식 도메인, GitHub 실행 지연, 외부 API 장애 때문에 누락·지연 가능성이 있습니다. 데이터 제공처와 공식 원문 링크를 항상 최종 기준으로 삼으세요.
