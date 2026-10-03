use spinon_render::StaticRenderSnapshot;

use super::geometry::FIXTURE_HEIGHT;

const SAMPLE_X: [u32; 14] = [
    24, 47, 49, 51, 52, 54, 102, 149, 151, 153, 154, 156, 228, 300,
];
const SAMPLE_Y: [u32; 3] = [0, 20, 39];
pub(super) const SAMPLE_COUNT: usize = SAMPLE_X.len() * SAMPLE_Y.len();
pub(super) const READBACK_BYTES_PER_ROW: u32 = 1280;
pub(super) const READBACK_SIZE: u64 = READBACK_BYTES_PER_ROW as u64 * FIXTURE_HEIGHT as u64;

pub(super) enum ReadbackState {
    NotStarted,
    Pending(std::sync::mpsc::Receiver<Result<(), String>>),
    Complete,
}

pub(super) fn validate_samples(
    snapshot: &StaticRenderSnapshot,
    bytes: &[u8],
) -> Result<(), String> {
    let expected_size =
        usize::try_from(READBACK_SIZE).map_err(|_| "S04 readback 크기가 범위를 벗어났습니다")?;
    if bytes.len() != expected_size {
        return Err(format!(
            "S04 readback 길이가 다릅니다: 실제 {} bytes, 기대 {expected_size} bytes",
            bytes.len()
        ));
    }
    for y in SAMPLE_Y {
        for x in sample_columns() {
            let offset = usize::try_from(y * READBACK_BYTES_PER_ROW + x * 4)
                .map_err(|_| "S04 sample offset이 범위를 벗어났습니다")?;
            let actual = &bytes[offset..offset + 4];
            let expected = expected_color(snapshot, x, y).ok_or_else(|| {
                format!("S04 sample ({x},{y})에 포함되는 snapshot box가 없습니다")
            })?;
            if actual != expected {
                return Err(format!(
                    "S04 GPU 색상 불일치 ({x},{y}): 실제 [{},{},{},{}], 기대 [{},{},{},{}]",
                    actual[0],
                    actual[1],
                    actual[2],
                    actual[3],
                    expected[0],
                    expected[1],
                    expected[2],
                    expected[3]
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn sample_columns() -> impl Iterator<Item = u32> {
    SAMPLE_X.into_iter()
}

pub(super) fn expected_color(snapshot: &StaticRenderSnapshot, x: u32, y: u32) -> Option<[u8; 4]> {
    let center_x = x as f32 + 0.5;
    let center_y = y as f32 + 0.5;
    snapshot
        .boxes()
        .iter()
        .filter(|render_box| {
            let frame = render_box.frame_css_px();
            center_x >= frame.x()
                && center_x < frame.x() + frame.width()
                && center_y >= frame.y()
                && center_y < frame.y() + frame.height()
        })
        .max_by_key(|render_box| render_box.paint_order())
        .map(|render_box| {
            let paint = render_box.paint();
            [paint.red(), paint.green(), paint.blue(), 255]
        })
}
