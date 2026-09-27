# JavaScript 워크스페이스

루트 [`package.json`](../package.json)의 Bun 워크스페이스에는 구현된 패키지만 추가합니다. 현재 문서 생성기인 [`@spinon/docs`](docs/package.json)는 내부 도구 패키지입니다. React·Vue·Svelte 어댑터, Vite·Rspack 통합, CLI는 각각 실제 코드가 준비될 때 독립 패키지로 추가하며 공개 API와 지원 범위는 `spec/` 명세에 먼저 정의합니다.

예정 구조와 책임은 [모노레포 구현 계획](../docs/plans/implementation.md), 공식 지원 상태는 [상태 대장](../spec/STATUS.md)을 기준으로 합니다. 이 인덱스는 구현 또는 패키지 배포를 뜻하지 않습니다.
