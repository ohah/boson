use std::fmt;
use std::num::NonZeroU64;

/// 한 UI 트리 수명에서 노드를 식별하는 0이 아닌 정수입니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct NodeId(NonZeroU64);

impl NodeId {
    /// 0이 아닌 값으로 노드 ID를 만듭니다.
    pub const fn new(value: u64) -> Option<Self> {
        match NonZeroU64::new(value) {
            Some(value) => Some(Self(value)),
            None => None,
        }
    }

    /// 정수 표현을 반환합니다.
    pub const fn get(self) -> u64 {
        self.0.get()
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.get().fmt(formatter)
    }
}

/// 트리에 적용된 변경 묶음의 번호입니다.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Revision(pub(crate) u64);

impl Revision {
    /// 정수 표현을 반환합니다.
    pub const fn get(self) -> u64 {
        self.0
    }
}

impl fmt::Display for Revision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.get().fmt(formatter)
    }
}

/// 한 스타일 입력 소유자의 상태 번호입니다.
///
/// 문서 세대 안에서만 비교하며, 증가 시 [`StyleRevision::checked_next`]를 사용합니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct StyleRevision(u64);

impl StyleRevision {
    /// 소유자의 초기 revision입니다.
    pub const INITIAL: Self = Self(0);

    /// 현재 상태 다음 번호를 반환합니다. 번호가 소진되면 `None`입니다.
    pub const fn checked_next(self) -> Option<Self> {
        match self.0.checked_add(1) {
            Some(next) => Some(Self(next)),
            None => None,
        }
    }

    /// 정수 표현을 반환합니다.
    pub const fn get(self) -> u64 {
        self.0
    }
}

impl Default for StyleRevision {
    fn default() -> Self {
        Self::INITIAL
    }
}

/// 한 플랫폼 환경 snapshot 소유자의 상태 번호입니다.
///
/// 같은 문서 세대의 모든 표면에서 공유해 증가하며, 표면 재생성만으로 값을 재사용하지 않습니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct EnvironmentRevision(u64);

impl EnvironmentRevision {
    /// 소유자의 초기 revision입니다.
    pub const INITIAL: Self = Self(0);

    /// 현재 상태 다음 번호를 반환합니다. 번호가 소진되면 `None`입니다.
    pub const fn checked_next(self) -> Option<Self> {
        match self.0.checked_add(1) {
            Some(next) => Some(Self(next)),
            None => None,
        }
    }

    /// 정수 표현을 반환합니다.
    pub const fn get(self) -> u64 {
        self.0
    }
}

impl Default for EnvironmentRevision {
    fn default() -> Self {
        Self::INITIAL
    }
}

#[cfg(test)]
mod revision_tests {
    use super::{EnvironmentRevision, StyleRevision};

    #[test]
    fn owner_revisions_increment_independently_and_fail_closed_at_capacity() {
        let style = StyleRevision::default();
        let environment = EnvironmentRevision::default();
        assert_eq!(style.get(), 0);
        assert_eq!(environment.get(), 0);
        assert_eq!(style.checked_next().unwrap().get(), 1);
        assert_eq!(environment.checked_next().unwrap().get(), 1);
        assert_eq!(StyleRevision(u64::MAX).checked_next(), None);
        assert_eq!(EnvironmentRevision(u64::MAX).checked_next(), None);
    }
}
