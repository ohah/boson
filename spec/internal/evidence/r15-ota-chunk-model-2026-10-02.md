# R15 청크 OTA 호환 모델 근거

**산출물:** 내부 설계 초안 `0.1.0-draft` · **실행 코드:** 없음 · **공개 API:** 해당 없음

## 입력 문서

- [공식 상태 대장 R15·X01·D02~D04](../../STATUS.md)
- [실행·빌드·배포 명세](../../0004-runtime-build.md)
- [상위 OTA 흐름](../../../docs/ota-design.md)
- [C02 자원 그래프 비교 기준](../0008-css-bundler-c02.md)
- [C02 CSS 자원 snapshot 경계](../0011-css-resource-adapter-c02.md)

## 계약 추적

| R15 요구 | 초안의 결정 위치 | 뒤따를 검증·작업 |
| --- | --- | --- |
| 바이너리 런타임 식별·거부 | `runtimeId` 정확 일치; 앱 ID·플랫폼·ABI·Spinon/V8/호스트 API/스타일/GPU ABI 경계 | X01의 적합/부적합 manifest fixture; D02의 release envelope |
| 기능별 진입점과 청크 의존성 | `features → entryChunkId → static/dynamic (specifier, chunkId) edges → resource edges`; 내부 참조 닫힘과 원본 import completeness를 구분; orphan chunk/resource/object 거부 | C02 번들러 graph completeness·최종 emitted specifier fixture; X01 매핑·내부 참조 및 고아 노드 거부 fixture |
| JS·CSS·이미지·폰트 무결성 | 최종 바이트 SHA-256, 크기, 유형, digest 기반 객체 저장소; 전송/압축 해제 자원 한도 | 손상·누락·중복·공유 객체와 압축 해제 한도 fixture; D03/D04 전송 검증 |
| 기능 범위 배포와 공유 자원 | 전체 목표 snapshot + `changeSet`의 기준·발행자 변경 의도·`affectedScope`·그래프 diff 영향 기능·신규 객체; typed edge 종류·specifier·순서 포함; 최초·불확실 기준은 app scope/전체 객체 fallback; 정적·동적 객체 모두 사전 확보 후 전체 snapshot 활성화 | 같은 기능 변경·공유 의존성 변경·기능 제거·edge 순서 변경 fixture; 신규 채널만 baseline 생략, stale/CAS 거부, 앱 cohort 및 전체 객체 사전 확보 검증 |
| 서명 경계 | 서명은 대상 호환 정보와 전체 graph/resource hash 및 설치 의미 필드를 인증; hash는 bytes 무결성, 서명은 발행자 진위; rollback은 새 상향 sequence의 서명 명령 | D02 strict serialization·key rotation·anti-replay·rollback envelope 검증 |
| 원자 활성화와 rollback 경계 | staging 후 snapshot 포인터·high-water sequence를 transaction 또는 복구 journal로 전환; 기존 정상 snapshot 또는 내장 그래프만 복구 | D04 crash/중단/첫 시작 실패, 압축 bomb 한도와 이전 runtime ID 거부 fixture; 앱 백업/초기화 뒤 sequence 복원 위협은 별도 정의 |

## 문서 정합성 판정과 한계

초안은 C02의 실험 snapshot을 최종 OTA 매니페스트로 오인하지 않도록 분리했다. `docs/ota-design.md`의 “기능 버전 조합”은 임의 버전 혼합으로 해석되지 않게 완전한 목표 snapshot으로 구체화한다. `spec/0004-runtime-build.md`의 R15→X01→D02 관계는 그래프 본문, 로컬 loader, 서명 release envelope의 순서로 맞춘다. 기능 배포는 변경 콘텐츠만 내려받되 기기에서는 하나의 전체 snapshot으로 활성화한다.

이 문서는 모델 수준의 일관성을 확인하며 모바일 실행·네트워크 전송·암호 서명·rollback 시점을 시험하지 않는다. 서명 알고리즘·키 보관/교체, channel/cohort API, 데이터베이스·CDN, 서버 orphan 객체 보관·정리, 압축 전송/해제 한도 구현, 다운로드 재시도, 첫 실행 health threshold, 캐시 retention, OS 조건부 호스트 capability 형식, 앱 데이터 복원·초기화 뒤 sequence 보장과 정확한 정책 적합성은 각각 D02~D05/R09의 미완료 범위다. 첫 모델은 바이너리가 지원 OS 범위 전체에 보장한 호스트 API만 OTA 코드에서 허용한다. 이 문서만으로 OTA 또는 기능별 릴리스가 제품에서 동작한다고 주장하지 않는다.
