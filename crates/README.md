# Rust 워크스페이스

루트 [`Cargo.toml`](../Cargo.toml)이 Rust 워크스페이스입니다. `spinon-core`는 실험용 `Tree`, 내부 우선순위 선택기와 R03 `HostDocument` 모델을 소유합니다. `HostDocument` snapshot은 C03에서 Stylo DOM·selector adapter에 연결했습니다. `spinon-style`은 컴파일 시 포함하는 기본 CSS 자원과 Stylo stylesheet 파싱·출처·등록 순서를 소유하며 C04.1 fixture에서 기본 cascade·computed style을 고정 Chromium reference와 비교합니다. 이 계산 경로는 제품 runtime·layout에 아직 연결되지 않았습니다. `spinon-layout`은 S01 `Tree` 또는 HostDocument 요소 하위 트리를 입력 snapshot으로 투영해 Taffy Flex 프레임을 계산합니다. 스타일은 호출자가 전달하며 CSS cascade·텍스트 측정은 연결되지 않았습니다. `spinon-runtime`은 V8 세션·작업 큐·Isolate 소유 스레드를, `spinon-ffi`는 플랫폼 C ABI와 입력·출력 변환을 소유합니다. 의존 방향은 `spinon-style → spinon-core`, `spinon-layout → spinon-core`, `spinon-ffi → spinon-runtime → spinon-core`입니다. 공개 앱 API는 아직 제공하지 않습니다. 실제 코드·내부 계약·테스트가 준비된 크레이트만 구성원으로 추가합니다.

예정 구조와 작업 순서는 [모노레포 구현 계획](../docs/plans/implementation.md)을 참고합니다. 공식 구현 상태와 완료 판정은 [상태 대장](../spec/STATUS.md)만 기준으로 삼습니다.
