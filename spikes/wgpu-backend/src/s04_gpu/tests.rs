use super::geometry::{build_vertices, srgb_to_linear, FIXTURE_HEIGHT, FIXTURE_WIDTH};
use super::readback::{sample_columns, validate_samples, READBACK_BYTES_PER_ROW, READBACK_SIZE};
use crate::s04_snapshot;

#[test]
fn fixture_surface_maps_css_points_once_and_letterboxes_without_stretching() {
    let snapshot = s04_snapshot::build_snapshot().expect("S04 snapshot");
    let surface_vertices = build_vertices(&snapshot, 1080, 2400, 3.0).expect("surface vertices");
    let readback_vertices =
        build_vertices(&snapshot, FIXTURE_WIDTH, FIXTURE_HEIGHT, 1.0).expect("readback vertices");
    assert_eq!(surface_vertices.len(), 4 * 6 * 6);
    assert_eq!(readback_vertices.len(), 4 * 6 * 6);
    assert!(surface_vertices.iter().all(|value| value.is_finite()));
    assert!((surface_vertices[0] + 0.8361111).abs() < 0.001);
    assert!((surface_vertices[6] - 0.8361111).abs() < 0.001);
    assert!((surface_vertices[1] - 0.05).abs() < 0.001);
    assert!((surface_vertices[13] + 0.05).abs() < 0.001);
    assert_eq!(readback_vertices[0], -1.0);
    assert_eq!(readback_vertices[1], 1.0);
    assert_eq!(readback_vertices[13], -1.0);
}

#[test]
fn fixture_readback_samples_use_the_pinned_columns_rows_and_padded_stride() {
    let snapshot = s04_snapshot::build_snapshot().expect("S04 snapshot");
    let mut bytes = vec![0; READBACK_SIZE as usize];
    for y in [0_u32, 20, 39] {
        for x in sample_columns() {
            let offset = (y * READBACK_BYTES_PER_ROW + x * 4) as usize;
            bytes[offset..offset + 4].copy_from_slice(
                &super::readback::expected_color(&snapshot, x, y).expect("fixture sample color"),
            );
        }
    }
    validate_samples(&snapshot, &bytes).expect("fixed readback sample agreement");
    bytes[20 * READBACK_BYTES_PER_ROW as usize + 51 * 4] ^= 1;
    assert!(validate_samples(&snapshot, &bytes).is_err());
}

#[test]
fn srgb_transfer_function_preserves_exact_linear_endpoints() {
    assert_eq!(srgb_to_linear(0.0), 0.0);
    assert_eq!(srgb_to_linear(1.0), 1.0);
    assert!((srgb_to_linear(0.04045) - 0.0031308).abs() < 0.000001);
}

#[test]
fn sample_column_table_contains_fourteen_distinct_positions() {
    let columns: Vec<_> = sample_columns().collect();
    assert_eq!(columns.len(), 14);
    assert!(columns.windows(2).all(|pair| pair[0] < pair[1]));
}
