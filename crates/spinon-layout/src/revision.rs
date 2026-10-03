use spinon_core::{
    DocumentGeneration, DocumentRevision, EnvironmentRevision, RenderTreeRevision, Revision,
    StyleRevision,
};

/// 레이아웃 입력을 만든 코어 snapshot의 revision 출처입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutSourceRevision {
    /// S01의 단순 트리 snapshot입니다.
    Tree(Revision),
    /// 혼합 노드를 지원하는 HostDocument snapshot입니다.
    HostDocument {
        generation: DocumentGeneration,
        document: DocumentRevision,
        render_tree: RenderTreeRevision,
    },
}

impl Default for LayoutSourceRevision {
    fn default() -> Self {
        Self::Tree(Revision::default())
    }
}

/// 한 계산 결과가 사용한 문서·스타일·플랫폼 환경 입력의 출처입니다.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct LayoutInputRevision {
    source: LayoutSourceRevision,
    style: StyleRevision,
    environment: EnvironmentRevision,
}

impl LayoutInputRevision {
    /// 세 입력 출처를 함께 묶습니다.
    pub const fn new(
        source: LayoutSourceRevision,
        style: StyleRevision,
        environment: EnvironmentRevision,
    ) -> Self {
        Self {
            source,
            style,
            environment,
        }
    }

    /// 코어 트리 또는 HostDocument snapshot의 revision입니다.
    pub const fn source(self) -> LayoutSourceRevision {
        self.source
    }

    /// 스타일 입력 소유자가 제공한 revision입니다.
    pub const fn style(self) -> StyleRevision {
        self.style
    }

    /// 플랫폼 환경 snapshot 소유자가 제공한 revision입니다.
    pub const fn environment(self) -> EnvironmentRevision {
        self.environment
    }
}
