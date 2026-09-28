# Rust 워크스페이스

루트 [`Cargo.toml`](../Cargo.toml)이 Rust 워크스페이스입니다. `spinon-core`는 UI 트리와 변경 묶음을 소유하고, `spinon-ffi`는 현재 V8 부팅 smoke의 C ABI를 소유합니다. 두 크레이트는 서로 의존하지 않으며 공개 앱 API를 제공하지 않습니다. 실제 코드·내부 계약·테스트가 준비된 크레이트만 구성원으로 추가합니다.

예정 구조와 작업 순서는 [모노레포 구현 계획](../docs/plans/implementation.md)을 참고합니다. 공식 구현 상태와 완료 판정은 [상태 대장](../spec/STATUS.md)만 기준으로 삼습니다.
