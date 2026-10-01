use std::{
    collections::HashSet,
    error::Error,
    fmt,
    sync::{Mutex, PoisonError},
};

use cssparser::SourceLocation;
use style::{
    context::QuirksMode,
    error_reporting::{ContextualParseError, ParseErrorReporter},
    media_queries::MediaList,
    servo_arc::Arc,
    shared_lock::SharedRwLock,
    stylesheets::{AllowImportRules, DocumentStyleSheet, Origin, Stylesheet, UrlExtraData},
};
use url::Url;

/// Stylo에 전달하는 지원 CSS 출처입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CssOrigin {
    /// 런타임에 내장하는 기본 요소 규칙입니다.
    UserAgent,
    /// 앱 빌드에서 전달하는 작성자 규칙입니다.
    Author,
}

impl CssOrigin {
    fn as_stylo_origin(self) -> Origin {
        match self {
            Self::UserAgent => Origin::UserAgent,
            Self::Author => Origin::Author,
        }
    }
}

/// Stylo parser가 반환한 CSS 진단입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CssParseDiagnostic {
    /// 원본 CSS에서 0부터 시작하는 줄 번호입니다.
    pub line: u32,
    /// 원본 CSS에서 1부터 시작하는 UTF-16 코드 단위 열 번호입니다.
    pub column: u32,
    /// Stylo가 제공한 오류 설명입니다.
    pub message: String,
}

#[derive(Default)]
struct ParseDiagnostics(Mutex<Vec<CssParseDiagnostic>>);

impl ParseErrorReporter for ParseDiagnostics {
    fn report_error(
        &self,
        _url: &UrlExtraData,
        location: SourceLocation,
        error: ContextualParseError,
    ) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(CssParseDiagnostic {
                line: location.line,
                column: location.column,
                message: error.to_string(),
            });
    }
}

impl ParseDiagnostics {
    fn take(&self) -> Vec<CssParseDiagnostic> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain(..)
            .collect()
    }
}

/// Stylo parser에 등록할 CSS stylesheet 입력입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StylesheetSource {
    /// 문서 안에서 고유한 안정 ID입니다.
    pub id: String,
    /// `url()` 상대 참조 해석에 사용할 절대 stylesheet URL입니다.
    pub base_url: String,
    /// CSS 출처입니다.
    pub origin: CssOrigin,
    /// 파싱할 UTF-8 CSS 원문입니다.
    pub css: String,
}

/// 파싱된 Stylo stylesheet와 원본 입력의 대응 정보입니다.
pub struct RegisteredStylesheet {
    id: String,
    base_url: String,
    origin: CssOrigin,
    source_order: usize,
    source: String,
    sheet: DocumentStyleSheet,
    diagnostics: Vec<CssParseDiagnostic>,
}

impl RegisteredStylesheet {
    /// 문서별 stylesheet ID입니다.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// 상대 자원 URL 기준이 되는 stylesheet URL입니다.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// stylesheet의 CSS 출처입니다.
    pub const fn origin(&self) -> CssOrigin {
        self.origin
    }

    /// 모든 출처를 합친 등록 순서입니다.
    pub const fn source_order(&self) -> usize {
        self.source_order
    }

    /// 진단에 대응하는 UTF-8 원본 CSS입니다.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// Stylo가 파싱한 stylesheet입니다.
    pub fn stylo_sheet(&self) -> &DocumentStyleSheet {
        &self.sheet
    }

    /// 파싱 중 발생한 오류를 반환합니다.
    pub fn diagnostics(&self) -> &[CssParseDiagnostic] {
        &self.diagnostics
    }
}

/// 한 문서에 속한 불변 stylesheet 목록입니다.
///
/// 이 초기 계층은 Stylo stylesheet 파싱과 출처·등록 순서 보존을 소유합니다.
/// cascade 계산, stylesheet 교체·제거, CSSOM, `@import` 자원 해석은 포함하지 않습니다.
pub struct StylesheetRegistry {
    shared_lock: SharedRwLock,
    ids: HashSet<String>,
    stylesheets: Vec<RegisteredStylesheet>,
}

impl StylesheetRegistry {
    /// 빈 stylesheet 목록을 만듭니다.
    pub fn new() -> Self {
        Self {
            shared_lock: SharedRwLock::new(),
            ids: HashSet::new(),
            stylesheets: Vec::new(),
        }
    }

    /// stylesheet를 Stylo에 파싱하고 등록 순서 끝에 추가합니다.
    ///
    /// 문법 오류는 CSS 오류 복구 규칙에 따라 Stylo가 처리하고 진단을 보존합니다.
    /// `@import`는 외부 로더 없이 파싱하지 않으며 Stylo 진단으로 기록됩니다.
    pub fn append(
        &mut self,
        source: StylesheetSource,
    ) -> Result<&RegisteredStylesheet, StylesheetRegistryError> {
        if source.id.trim().is_empty() {
            return Err(StylesheetRegistryError::EmptyId);
        }
        if self.ids.contains(&source.id) {
            return Err(StylesheetRegistryError::DuplicateId(source.id));
        }
        let base_url = Url::parse(&source.base_url).map_err(|error| {
            StylesheetRegistryError::InvalidBaseUrl {
                reason: error.to_string(),
            }
        })?;
        let normalized_base_url = base_url.as_str().to_owned();

        let diagnostics = ParseDiagnostics::default();
        let stylesheet = Stylesheet::from_str(
            &source.css,
            UrlExtraData::from(base_url),
            source.origin.as_stylo_origin(),
            Arc::new(self.shared_lock.wrap(MediaList::empty())),
            self.shared_lock.clone(),
            None,
            Some(&diagnostics),
            QuirksMode::NoQuirks,
            AllowImportRules::No,
        );
        let registered = RegisteredStylesheet {
            id: source.id.clone(),
            base_url: normalized_base_url,
            origin: source.origin,
            source_order: self.stylesheets.len(),
            source: source.css,
            sheet: DocumentStyleSheet(Arc::new(stylesheet)),
            diagnostics: diagnostics.take(),
        };

        self.ids.insert(registered.id.clone());
        self.stylesheets.push(registered);
        Ok(self
            .stylesheets
            .last()
            .expect("방금 추가한 stylesheet가 있어야 합니다"))
    }

    /// 모든 출처를 합친 등록 순서로 stylesheet를 읽습니다.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = &RegisteredStylesheet> {
        self.stylesheets.iter()
    }

    /// 등록된 stylesheet 수를 반환합니다.
    pub fn len(&self) -> usize {
        self.stylesheets.len()
    }

    /// 등록된 stylesheet가 없는지 반환합니다.
    pub fn is_empty(&self) -> bool {
        self.stylesheets.is_empty()
    }
}

impl Default for StylesheetRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// stylesheet 등록을 거부한 이유입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StylesheetRegistryError {
    /// ID가 비어 있거나 공백뿐입니다.
    EmptyId,
    /// 같은 ID가 이미 등록되어 있습니다.
    DuplicateId(String),
    /// URL 기준이 절대 URL이 아니거나 파싱할 수 없습니다.
    InvalidBaseUrl { reason: String },
}

impl fmt::Display for StylesheetRegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyId => formatter.write_str("stylesheet ID는 비어 있을 수 없습니다"),
            Self::DuplicateId(id) => write!(formatter, "stylesheet ID가 중복됩니다: {id}"),
            Self::InvalidBaseUrl { reason } => {
                write!(
                    formatter,
                    "stylesheet 기준 URL을 파싱할 수 없습니다: {reason}"
                )
            }
        }
    }
}

impl Error for StylesheetRegistryError {}

#[cfg(test)]
mod tests {
    use style::stylesheets::StylesheetInDocument;

    use super::*;

    fn source(id: &str, origin: CssOrigin, css: &str) -> StylesheetSource {
        StylesheetSource {
            id: id.to_owned(),
            base_url: format!("https://spinon.invalid/styles/{id}.css"),
            origin,
            css: css.to_owned(),
        }
    }

    #[test]
    fn append_preserves_source_order_and_stylo_origin() {
        let mut registry = StylesheetRegistry::new();
        let mut first = source(
            "author-before-ua",
            CssOrigin::Author,
            ".before { color: red; }",
        );
        first.base_url = "HTTPS://SPINON.INVALID:443/styles/../author.css".to_owned();
        registry.append(first).unwrap();
        registry
            .append(source(
                "ua",
                CssOrigin::UserAgent,
                "@namespace \"http://www.w3.org/1999/xhtml\"; div { display: block; }",
            ))
            .unwrap();
        registry
            .append(source(
                "author-after-ua",
                CssOrigin::Author,
                ".after { color: blue; }",
            ))
            .unwrap();

        let sheets = registry.iter().collect::<Vec<_>>();
        assert_eq!(sheets.len(), 3);
        assert_eq!(sheets[0].id(), "author-before-ua");
        assert_eq!(sheets[0].base_url(), "https://spinon.invalid/author.css");
        assert_eq!(sheets[0].origin(), CssOrigin::Author);
        assert_eq!(sheets[0].source_order(), 0);
        assert_eq!(sheets[1].id(), "ua");
        assert_eq!(sheets[1].origin(), CssOrigin::UserAgent);
        assert_eq!(sheets[1].source_order(), 1);
        assert_eq!(sheets[2].id(), "author-after-ua");
        assert_eq!(sheets[2].origin(), CssOrigin::Author);
        assert_eq!(sheets[2].source_order(), 2);

        let guard = sheets[0].stylo_sheet().0.shared_lock.read();
        assert_eq!(
            sheets[0].stylo_sheet().contents(&guard).origin,
            Origin::Author
        );
        assert_eq!(
            sheets[1].stylo_sheet().contents(&guard).origin,
            Origin::UserAgent
        );
        assert_eq!(
            sheets[2].stylo_sheet().contents(&guard).origin,
            Origin::Author
        );
    }

    #[test]
    fn invalid_or_duplicate_registration_does_not_mutate_registry() {
        let mut registry = StylesheetRegistry::new();
        registry
            .append(source("app", CssOrigin::Author, ".x { color: red; }"))
            .unwrap();

        assert!(matches!(
            registry.append(source(
                "app",
                CssOrigin::UserAgent,
                "div { display: none; }"
            )),
            Err(StylesheetRegistryError::DuplicateId(id)) if id == "app"
        ));
        assert!(matches!(
            registry.append(StylesheetSource {
                id: " \n\t".to_owned(),
                base_url: "https://spinon.invalid/blank.css".to_owned(),
                origin: CssOrigin::Author,
                css: ".x { color: green; }".to_owned(),
            }),
            Err(StylesheetRegistryError::EmptyId)
        ));
        assert!(matches!(
            registry.append(StylesheetSource {
                id: "bad-url".to_owned(),
                base_url: "relative.css".to_owned(),
                origin: CssOrigin::Author,
                css: ".x { color: blue; }".to_owned(),
            }),
            Err(StylesheetRegistryError::InvalidBaseUrl { .. })
        ));
        assert_eq!(registry.len(), 1);
        assert_eq!(registry.iter().next().unwrap().id(), "app");
    }

    #[test]
    fn parser_errors_keep_source_location_and_valid_sheets_are_registered() {
        let mut registry = StylesheetRegistry::new();
        let sheet = registry
            .append(source(
                "invalid-value",
                CssOrigin::Author,
                ".title { color: red;\n width: ???; }",
            ))
            .unwrap();

        assert!(!sheet.diagnostics().is_empty());
        assert!(
            sheet
                .diagnostics()
                .iter()
                .any(|diagnostic| { diagnostic.line == 1 && diagnostic.column == 2 })
        );
        assert_eq!(sheet.source(), ".title { color: red;\n width: ???; }");
        let guard = sheet.stylo_sheet().0.shared_lock.read();
        assert_eq!(
            sheet
                .stylo_sheet()
                .contents(&guard)
                .rules
                .read_with(&guard)
                .0
                .len(),
            1
        );
    }

    #[test]
    fn import_without_a_loader_is_diagnosed_instead_of_requested() {
        let mut registry = StylesheetRegistry::new();
        let sheet = registry
            .append(source(
                "external-import",
                CssOrigin::Author,
                "@import url(\"https://spinon.invalid/remote.css\"); .title { color: red; }",
            ))
            .unwrap();

        assert!(!sheet.diagnostics().is_empty());
        let guard = sheet.stylo_sheet().0.shared_lock.read();
        assert_eq!(
            sheet
                .stylo_sheet()
                .contents(&guard)
                .rules
                .read_with(&guard)
                .0
                .len(),
            1
        );
        drop(guard);
        assert_eq!(registry.len(), 1);
    }
}
