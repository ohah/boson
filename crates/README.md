# Rust 워크스페이스

루트 [`Cargo.toml`](../Cargo.toml)이 Rust 워크스페이스입니다. `spinon-core`는 UI 트리와 우선순위 선택기를, `spinon-style`은 컴파일 시 포함하는 기본 CSS 자원을, `spinon-layout`은 코어 트리의 계산 스타일 스냅샷과 Taffy Flex 프레임 계산을, `spinon-runtime`은 V8 세션·작업 큐·Isolate 소유 스레드를, `spinon-ffi`는 플랫폼에 노출하는 C ABI와 입력·출력 변환을 소유합니다. 의존 방향은 `spinon-layout → spinon-core`, `spinon-ffi → spinon-runtime → spinon-core`입니다. `spinon-style`의 UA 자원은 앱 바이너리에 포함되지만 Stylo 계산·레이아웃·GPU 표시 경로에는 아직 연결되지 않았습니다. 공개 앱 API는 아직 제공하지 않습니다. 실제 코드·내부 계약·테스트가 준비된 크레이트만 구성원으로 추가합니다.

예정 구조와 작업 순서는 [모노레포 구현 계획](../docs/plans/implementation.md)을 참고합니다. 공식 구현 상태와 완료 판정은 [상태 대장](../spec/STATUS.md)만 기준으로 삼습니다.
