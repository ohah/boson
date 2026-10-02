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
| 기능별 진입점과 청크 의존성 | `features → entryChunkId → static/dynamic chunk edges → resource edges` | C02·X02·X03 graph 수집; X01 ESM 로더 |
| JS·CSS·이미지·폰트 무결성 | 최종 바이트 SHA-256, 크기, 유형, digest 기반 객체 저장소 | 손상·누락·중복·공유 객체 fixture; D03/D04 전송 검증 |
| 기능 범위 배포와 공유 자원 | 전체 목표 snapshot + `changeSet`의 기준·발행자 변경 의도·그래프 diff에서 계산한 영향 기능·신규 객체; 이전/새 closure의 노드 차이를 입증할 수 없으면 전체 앱으로 확장; 기능 버전 임의 혼합 금지 | 같은 기능 변경·공유 의존성 변경·기능 제거 diff fixture; 오래된 기준 publish 거부와 서버 cohort 검증 |
| 서명 경계 | 서명은 대상 호환 정보와 전체 graph/resource hash 및 설치 의미 필드를 인증; hash는 bytes 무결성, 서명은 발행자 진위 | D02 strict serialization·key rotation·anti-replay 검증 |
| 원자 활성화와 rollback 경계 | staging 후 snapshot 포인터 단일 전환; 기존 정상 snapshot 또는 내장 그래프 | D04 crash/중단/첫 시작 실패와 이전 runtime ID 거부 fixture |

## 문서 정합성 판정과 한계

초안은 C02의 실험 snapshot을 최종 OTA 매니페스트로 오인하지 않도록 분리했다. `docs/ota-design.md`의 “기능 버전 조합”은 임의 버전 혼합으로 해석되지 않게 완전한 목표 snapshot으로 구체화한다. `spec/0004-runtime-build.md`의 R15→X01→D02 관계는 그래프 본문, 로컬 loader, 서명 release envelope의 순서로 맞춘다. 기능 배포는 변경 콘텐츠만 내려받되 기기에서는 하나의 전체 snapshot으로 활성화한다.

이 문서는 모델 수준의 일관성을 확인하며 모바일 실행·네트워크 전송·암호 서명·rollback 시점을 시험하지 않는다. 서명 알고리즘·키 보관/교체, channel/cohort API, 데이터베이스·CDN, 다운로드 제한/재시도, 첫 실행 health threshold, 캐시 retention, 정확한 정책 적합성은 각각 D02~D05/R09의 미완료 범위다. 이 문서만으로 OTA 또는 기능별 릴리스가 제품에서 동작한다고 주장하지 않는다.
