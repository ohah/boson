use spinon_render::{OpaqueCssSrgb, StaticRenderSnapshot};

pub(super) const FIXTURE_WIDTH: u32 = 301;
pub(super) const FIXTURE_HEIGHT: u32 = 40;

pub(super) fn create_vertex_buffer(device: &wgpu::Device, vertices: &[f32]) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("spinon-s04-static-snapshot-vertices"),
        size: std::mem::size_of_val(vertices) as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

pub(super) fn build_vertices(
    snapshot: &StaticRenderSnapshot,
    surface_width: u32,
    surface_height: u32,
    density: f32,
) -> Result<Vec<f32>, String> {
    if surface_width == 0 || surface_height == 0 || !density.is_finite() || density <= 0.0 {
        return Err("S04 surface 크기·density가 잘못됐습니다".to_owned());
    }
    let viewport = snapshot.viewport_css_px();
    let fit =
        (surface_width as f32 / viewport.width()).min(surface_height as f32 / viewport.height());
    let scale = density.min(fit);
    if !scale.is_finite() || scale <= 0.0 {
        return Err("S04 CSS px 변환 배율이 잘못됐습니다".to_owned());
    }
    let offset_x = (surface_width as f32 - viewport.width() * scale) / 2.0;
    let offset_y = (surface_height as f32 - viewport.height() * scale) / 2.0;
    let mut vertices = Vec::with_capacity(snapshot.boxes().len() * 36);
    for render_box in snapshot.boxes() {
        let frame = render_box.frame_css_px();
        let x0 = offset_x + frame.x() * scale;
        let x1 = offset_x + (frame.x() + frame.width()) * scale;
        let y0 = offset_y + frame.y() * scale;
        let y1 = offset_y + (frame.y() + frame.height()) * scale;
        let left = x0 / surface_width as f32 * 2.0 - 1.0;
        let right = x1 / surface_width as f32 * 2.0 - 1.0;
        let top = 1.0 - y0 / surface_height as f32 * 2.0;
        let bottom = 1.0 - y1 / surface_height as f32 * 2.0;
        let color = linear_rgba(render_box.paint());
        for position in [
            [left, top],
            [right, top],
            [left, bottom],
            [left, bottom],
            [right, top],
            [right, bottom],
        ] {
            vertices.extend_from_slice(&[
                position[0],
                position[1],
                color[0],
                color[1],
                color[2],
                color[3],
            ]);
        }
    }
    Ok(vertices)
}

fn linear_rgba(color: OpaqueCssSrgb) -> [f32; 4] {
    [
        srgb_to_linear(f32::from(color.red()) / 255.0),
        srgb_to_linear(f32::from(color.green()) / 255.0),
        srgb_to_linear(f32::from(color.blue()) / 255.0),
        1.0,
    ]
}

pub(super) fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}
