# 스피논 CLI와 MCP 설계 초안

CLI는 개발자가 프로젝트를 만들고 앱을 빌드·실행·진단하는 기본 인터페이스다. MCP는 에이전트가 같은 개발 정보를 구조화해 읽는 별도 인터페이스다. 둘이 앱 코어를 따로 구현하지 않는다. 현재 CLI 명령과 MCP 서버는 **계획**이며 구현 완료 기능이 아니다.

## 한 서비스, 두 인터페이스

```text
스피논 프로젝트 설정·기기 탐지·빌드·개발 서비스·진단 모델
                      ├─ CLI: 사람과 셸 자동화
                      └─ MCP: 에이전트의 구조화된 조회·도구 호출
                              ↓
                   같은 결과 스키마와 오류 코드
```

초기 CLI는 TypeScript/Node.js로 만들고 Vite·Rspack 플러그인과 설정·기기 탐지 코드를 공유한다. Rust 코어는 앱 안의 UI 트리·스타일·레이아웃 책임을 유지한다. CLI의 언어 선택은 런타임 코어의 언어 선택과 독립이다. 배포 실행 파일의 크기·시작 시간·설치 방식이 문제가 되면 CLI 패키징을 별도로 비교한다.

## CLI 명령 계약

| 단계 | 제안 명령 | 성공 결과와 실패 분류 |
| --- | --- | --- |
| 첫 수직 구현 | `spinon create`, `spinon dev --platform web|ios|android`, `spinon build`, `spinon doctor` | 예제 생성, 개발 서버·기기 실행, 재현 가능한 산출물, Xcode·SDK·V8 등 전제 조건 진단 |
| 개발 경험 확장 | `spinon devices`, `spinon logs`, `spinon inspect tree`, `spinon inspect node`, `spinon profile` | 기기 ID·앱 세션·트리 revision·원본 로그·계측 시간 범위를 명시 |
| 배포 단계 | `spinon package`, `spinon update verify` | 바이너리·에셋 버전·서명·호환 범위 검증. 실제 게시·롤아웃은 별도 명시적 명령과 정책 관문 뒤에 둔다. |

상호작용형 출력과 `--json` 출력을 분리한다. JSON 필드, 명령 종료 코드, stderr 오류 분류를 버전 관리하고 비밀 값은 출력에서 제외한다. `doctor`는 설치 상태를 보고하는 읽기 전용 명령으로 시작한다. 자동 수정 명령은 별도로 둔다.

## MCP 첫 범위

로컬 `stdio` 서버에서 시작한다. 에이전트가 읽기 쉬운 정보는 resource로, 인자를 받는 조회는 tool로 제공한다.

| 종류 | 예시 | 제한 |
| --- | --- | --- |
| Resource | 프로젝트 설정 요약, 지원 기능표, 현재 빌드·기기 상태 | 비밀 값과 개인 경로를 걸러낸 스냅샷 |
| Tool | `list_devices`, `get_diagnostics`, `inspect_node`, `get_logs`, `get_profile` | 대상 앱·기기·revision·시간 범위와 결과 크기를 제한 |
| 후속 쓰기 Tool | 앱 실행, HMR 강제 리로드, 빌드, 패키지 생성 | 명시적 작업 종류와 대상·결과를 표시하고 읽기 도구와 분리 |

MCP는 V8 Inspector/CDP를 그대로 중계하는 통로가 아니다. JS 중단점은 디버거가, UI 트리 조회는 스피논 진단 서비스가 담당한다. MCP 도구는 두 계층에서 필요한 상태를 안전한 스냅샷으로 가져온다. 원시 JS 평가, 임의 셸 명령, 릴리스 OTA 게시를 기본 도구로 열지 않는다.

## 연결과 보안

- 첫 MCP 서버는 개발자 컴퓨터의 `stdio` 프로세스로만 실행한다. 공개 Tailscale Funnel 미리보기와 연결하지 않는다.
- 원격 MCP가 실제로 필요해지면 별도 서버·인증·접근 범위·감사 기록을 설계한다. 로컬 개발 서버나 Inspector 포트를 인터넷에 직접 노출하지 않는다.
- 앱 로그·UI 텍스트에는 사용자 데이터가 들어갈 수 있으므로 민감 값 숨김, 크기 제한, 세션 수명과 수집 여부를 정한다.
- MCP 프로토콜과 SDK 버전은 구현 시점에 고정하고 호환성을 확인한다. 처음에는 공식 SDK의 로컬 전송을 검토하며, SDK가 앱 코어의 필수 의존성이 되게 하지 않는다.

## 완료 판정

1. 새 프로젝트에서 CLI 한 경로로 웹·Android·iOS 개발 빌드를 실행하고, 실패 시 대상·원인·조치가 구분된다.
2. 같은 기기·앱 세션에 대해 CLI `--json`과 MCP 조회가 동일한 revision·노드·진단 값을 돌려준다.
3. HMR 전후 노드 ID·revision이 올바르게 바뀌며 오래된 스냅샷 요청은 명시적으로 실패한다.
4. 개발 빌드 밖에서 MCP·Inspector가 연결되지 않고, 공개 미리보기 주소에서 진단·로그에 접근할 수 없다.

공식 기준: [MCP 명세](https://modelcontextprotocol.io/specification/2026-07-28), [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/), [V8 Inspector](https://v8.dev/docs/inspector).
