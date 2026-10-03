use super::{injected_failure, is_supported_failure_kind, DrawFailure};

#[test]
fn recovery_failures_have_stable_host_codes() {
    assert_eq!(DrawFailure::SurfaceLost.code(), -3);
    assert_eq!(DrawFailure::SurfaceOutdated.code(), -4);
    assert_eq!(DrawFailure::DeviceLost.code(), -5);
    assert_eq!(DrawFailure::Temporary("timeout".to_owned()).code(), -2);
}

#[test]
fn injected_failure_kinds_cover_recovery_and_non_recovery_paths() {
    for (kind, expected_code) in [(1, -3), (2, -5), (3, -4), (4, -2)] {
        assert_eq!(
            injected_failure(kind).map(|failure| failure.code()),
            Some(expected_code)
        );
        assert!(is_supported_failure_kind(kind));
    }
    assert!(!is_supported_failure_kind(0));
    assert!(!is_supported_failure_kind(5));
}
