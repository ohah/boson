# 0012 · C04 stylesheet 입력 목록

**상태:** 내부 구현 계약 초안 · **버전:** `0.1.0-draft` · **Stylo:** `0.22.0` · **제품 CSS 지원:** 미완료

## 목적과 범위

`spinon-style`이 CSS 원문을 Stylo stylesheet로 파싱하고 출처·입력 순서·정규화한 기준 URL·파서 진단을 보존한다. 이 계약은 이후 C04 cascade 단계가 사용할 입력 목록이다. 스타일 계산을 수행하거나 CSS 지원을 선언하는 API가 아니다.

| 입력 | 규칙 |
| --- | --- |
| `id` | 비어 있지 않은 문서별 문자열. 같은 목록 안에서 중복을 거부한다. |
| `base_url` | Stylo의 URL 값 해석에 전달하는 절대 URL. 파싱 후 정규화한 값을 목록에서 반환하며 네트워크 fetch를 수행하지 않는다. |
| `origin` | 현재 `UserAgent` 또는 `Author`. Stylo `Origin`에 그대로 대응한다. |
| `css` | UTF-8 문자열. CSS 인코딩 감지는 바이트 로더가 정해질 때 별도 계약으로 둔다. |

각 입력의 stylesheet-level media list는 비어 있다. CSS 안의 `@media` 규칙 처리를 구현하거나 증명한 것은 아니다.

각 입력은 한 번 등록되고 목록 끝에 추가된다. `source_order`는 목록에 추가된 순번이며 0부터 시작한다. 이는 서로 다른 cascade origin 사이의 우선순위를 나타내지 않는다. 실제 cascade는 Stylo가 소유해야 한다.

## 파싱과 오류

- 등록기는 Stylo `0.22.0`의 stylesheet 파서를 사용하고 `QuirksMode::NoQuirks`를 전달한다. `cssparser 0.38.0` 진단 위치를 보존한다.
- 문법 오류가 있어도 Stylo의 오류 복구로 유효한 규칙을 파싱할 수 있으면 stylesheet를 등록한다. 진단은 stylesheet ID와 원문을 통해 호출자가 찾는다.
- 진단의 줄 번호는 0부터 시작하고 열 번호는 1부터 시작하는 UTF-16 코드 단위다.
- 중복 ID, 공백뿐인 ID, 잘못된 절대 URL은 등록 전에 오류로 반환하며 기존 목록은 바뀌지 않는다. 오류 문구에는 입력 URL을 다시 포함하지 않는다.
- `@import`는 파서에서 허용하지 않는다. 자원 로더를 호출하지 않으며 Stylo 진단으로 보존한다. 번들 내 import 펼치기는 C02 제품 자원 그래프가 준비된 뒤 별도로 연결한다.
- CSS의 `url()` 값은 Stylo에 기준 URL과 함께 전달될 뿐이다. 폰트·이미지를 읽거나 네트워크 요청하지 않는다.

## 출처·수명

등록된 `DocumentStyleSheet`와 원문·진단은 `StylesheetRegistry` 수명 동안 보관한다. 등록 목록은 현재 append-only다. 제거·교체·CSSOM 수정과 snapshot 간 무효화는 제공하지 않는다. `StyloDocumentView`와 같은 revision의 문서 트리에 cascade를 실행하는 일도 이 단계에 포함하지 않는다.

## 비교 기준과 검증

비교 입력은 UA stylesheet와 author stylesheet를 교차 순서로 추가하는 고정 단위 사례다. 기대값은 입력 ID·origin의 직접 Stylo 매핑, 입력 순번, 오류 위치 보존, 거부된 등록 뒤 목록 불변성이다. 판정은 목록 순서·origin의 정확 일치와 parse diagnostic 위치의 정확 일치다. 독립 기준은 `Stylesheet::from_str`가 만든 `StylesheetContents.origin`과 Stylo parser 진단이며, 화면·computed style 동등성을 주장하지 않는다.

실행 사례와 결과는 [C04 검증 기록](evidence/css-c04-stylesheet-registry-2026-10-01.md)에 둔다. 다음 cascade 단계는 Chromium CSS 기준 fixture로 `source order`, specificity, `!important`, inheritance와 기본 UA 규칙을 먼저 고정한 뒤 연결한다. C01 전체 기능 inventory와 C04 전체 완료는 계속 미완료다.

## 제공하지 않는 기능

- Stylist 등록·규칙 매칭·cascade·computed style
- inline declaration·CSSOM 변경
- UA 규칙의 브라우저 동등성 및 Android/iOS 화면 적용
- `@import`의 URL·media·supports·layer 로딩, 순환 탐지와 실패 복구
- CSS `url()`의 로컬 번들·외부 네트워크 자원 로딩
- CSS 무효화, 재계산, 레이아웃 및 GPU 표시
