use std::sync::{mpsc, mpsc::TryRecvError, Arc, Mutex};

use spinon_render::StaticRenderSnapshot;

use crate::s04_snapshot;

mod geometry;
mod readback;

#[cfg(test)]
mod tests;

use geometry::{build_vertices, create_vertex_buffer, FIXTURE_HEIGHT, FIXTURE_WIDTH};
use readback::{
    validate_samples, ReadbackState, READBACK_BYTES_PER_ROW, READBACK_SIZE, SAMPLE_COUNT,
};

const SHADER: &str = r#"
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>,
) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(position, 0.0, 1.0);
    output.color = color;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
"#;

#[derive(Debug)]
pub(crate) struct S04Failure {
    pub(crate) code: i32,
    pub(crate) message: String,
}

pub(crate) struct S04SceneConfig {
    pub(crate) surface_format: wgpu::TextureFormat,
    pub(crate) surface_width: u32,
    pub(crate) surface_height: u32,
    pub(crate) density: f32,
    pub(crate) surface_generation: u64,
}

pub(crate) struct S04Scene {
    snapshot: StaticRenderSnapshot,
    surface_pipeline: wgpu::RenderPipeline,
    readback_pipeline: wgpu::RenderPipeline,
    vertex_buffer: wgpu::Buffer,
    readback_vertex_buffer: wgpu::Buffer,
    vertex_count: u32,
    readback_texture: wgpu::Texture,
    readback_buffer: wgpu::Buffer,
    readback_state: ReadbackState,
    diagnostics: Arc<Mutex<Vec<String>>>,
    density: f32,
    surface_generation: u64,
    frame_sequence: u64,
    readback_surface_generation: Option<u64>,
    readback_frame_sequence: Option<u64>,
}

impl S04Scene {
    pub(crate) fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        config: S04SceneConfig,
        diagnostics: Arc<Mutex<Vec<String>>>,
    ) -> Result<Self, String> {
        if !config.density.is_finite() || config.density <= 0.0 || config.surface_generation == 0 {
            return Err("S04 density·surface generation은 유한한 양수여야 합니다".to_owned());
        }
        let snapshot = s04_snapshot::build_snapshot()?;
        if snapshot.viewport_css_px().width() != FIXTURE_WIDTH as f32
            || snapshot.viewport_css_px().height() != FIXTURE_HEIGHT as f32
        {
            return Err("S04 snapshot viewport가 고정 fixture와 다릅니다".to_owned());
        }
        let surface_pipeline = create_pipeline(device, config.surface_format);
        let readback_pipeline = create_pipeline(device, wgpu::TextureFormat::Rgba8UnormSrgb);
        let vertices = build_vertices(
            &snapshot,
            config.surface_width,
            config.surface_height,
            config.density,
        )?;
        let readback_vertices = build_vertices(&snapshot, FIXTURE_WIDTH, FIXTURE_HEIGHT, 1.0)?;
        let vertex_buffer = create_vertex_buffer(device, &vertices);
        let readback_vertex_buffer = create_vertex_buffer(device, &readback_vertices);
        queue.write_buffer(&vertex_buffer, 0, bytemuck::cast_slice(&vertices));
        queue.write_buffer(
            &readback_vertex_buffer,
            0,
            bytemuck::cast_slice(&readback_vertices),
        );
        let readback_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("spinon-s04-rgba8-srgb-readback-target"),
            size: wgpu::Extent3d {
                width: FIXTURE_WIDTH,
                height: FIXTURE_HEIGHT,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spinon-s04-rgba8-readback-buffer"),
            size: READBACK_SIZE,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        Ok(Self {
            snapshot,
            surface_pipeline,
            readback_pipeline,
            vertex_buffer,
            readback_vertex_buffer,
            vertex_count: u32::try_from(vertices.len() / 6)
                .map_err(|_| "S04 vertex 개수가 범위를 벗어났습니다")?,
            readback_texture,
            readback_buffer,
            readback_state: ReadbackState::NotStarted,
            diagnostics,
            density: config.density,
            surface_generation: config.surface_generation,
            frame_sequence: 0,
            readback_surface_generation: None,
            readback_frame_sequence: None,
        })
    }

    pub(crate) fn resize(
        &mut self,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        density: f32,
        surface_generation: u64,
    ) -> Result<(), String> {
        if !density.is_finite() || density <= 0.0 || surface_generation == 0 {
            return Err("S04 density·surface generation은 유한한 양수여야 합니다".to_owned());
        }
        let vertices = build_vertices(&self.snapshot, width, height, density)?;
        queue.write_buffer(&self.vertex_buffer, 0, bytemuck::cast_slice(&vertices));
        self.vertex_count = u32::try_from(vertices.len() / 6)
            .map_err(|_| "S04 vertex 개수가 범위를 벗어났습니다")?;
        self.density = density;
        self.surface_generation = surface_generation;
        Ok(())
    }

    pub(crate) fn draw(
        &mut self,
        surface: &wgpu::Surface<'static>,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<String, S04Failure> {
        let frame = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => frame,
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                drop(frame);
                return Err(failure(
                    -6,
                    "Suboptimal",
                    "표면 재구성이 필요한 프레임입니다",
                ));
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                return Err(failure(-3, "Lost", "wgpu 표면을 잃었습니다"));
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                return Err(failure(-4, "Outdated", "wgpu 표면 구성이 오래됐습니다"));
            }
            wgpu::CurrentSurfaceTexture::Timeout => {
                return Err(failure(-2, "Timeout", "wgpu 표면 획득 시간이 초과됐습니다"));
            }
            wgpu::CurrentSurfaceTexture::Occluded => {
                return Err(failure(-2, "Occluded", "wgpu 표면이 가려져 있습니다"));
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err(failure(
                    -2,
                    "Validation",
                    "wgpu 표면 획득 검증에 실패했습니다",
                ));
            }
        };
        let frame_view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("spinon-s04-snapshot-command-encoder"),
        });
        let start_readback = matches!(self.readback_state, ReadbackState::NotStarted);
        if start_readback {
            let readback_view = self
                .readback_texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            self.render_pass(
                &mut encoder,
                &readback_view,
                &self.readback_pipeline,
                &self.readback_vertex_buffer,
            );
            encoder.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.readback_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer: &self.readback_buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(READBACK_BYTES_PER_ROW),
                        rows_per_image: Some(FIXTURE_HEIGHT),
                    },
                },
                wgpu::Extent3d {
                    width: FIXTURE_WIDTH,
                    height: FIXTURE_HEIGHT,
                    depth_or_array_layers: 1,
                },
            );
        }
        self.render_pass(
            &mut encoder,
            &frame_view,
            &self.surface_pipeline,
            &self.vertex_buffer,
        );
        let submission = queue.submit([encoder.finish()]);
        queue.present(frame);
        self.frame_sequence = self.frame_sequence.saturating_add(1);
        if start_readback {
            let (sender, receiver) = mpsc::sync_channel(1);
            self.readback_buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |result| {
                    let _ = sender.send(result.map_err(|error| error.to_string()));
                });
            self.readback_state = ReadbackState::Pending(receiver);
            self.readback_surface_generation = Some(self.surface_generation);
            self.readback_frame_sequence = Some(self.frame_sequence);
        }
        let source = self.snapshot.source();
        Ok(format!(
            "acquire=Success surface_generation={} frame_sequence={} submission_index={submission:?} present=requested fixture={} document_revision={} render_tree_revision={} diagnostics=deferred_to_readback",
            self.surface_generation,
            self.frame_sequence,
            source.fixture_id,
            source.document_revision.get(),
            source.render_tree_revision.get(),
        ))
    }

    pub(crate) fn poll_readback(
        &mut self,
        device: &wgpu::Device,
    ) -> Result<Option<String>, String> {
        device
            .poll(wgpu::PollType::Poll)
            .map_err(|error| format!("S04 GPU poll 실패: {error}"))?;
        self.ensure_no_diagnostics()?;
        let result = match &self.readback_state {
            ReadbackState::NotStarted => {
                return Err("S04 readback이 아직 제출되지 않았습니다".to_owned())
            }
            ReadbackState::Complete => return Ok(Some("이미 검증된 readback입니다".to_owned())),
            ReadbackState::Pending(receiver) => match receiver.try_recv() {
                Ok(result) => result,
                Err(TryRecvError::Empty) => return Ok(None),
                Err(TryRecvError::Disconnected) => {
                    return Err("S04 readback 완료 callback 연결이 끊겼습니다".to_owned());
                }
            },
        };
        result.map_err(|error| format!("S04 readback buffer mapping 실패: {error}"))?;
        let mapped = self
            .readback_buffer
            .slice(..)
            .get_mapped_range()
            .map_err(|error| format!("S04 readback bytes 접근 실패: {error}"))?;
        let validation = validate_samples(&self.snapshot, &mapped);
        drop(mapped);
        self.readback_buffer.unmap();
        validation?;
        self.ensure_no_diagnostics()?;
        self.readback_state = ReadbackState::Complete;
        Ok(Some(format!(
            "surface_generation={} frame_sequence={} fixture={} target=Rgba8UnormSrgb size=301x40 bytes_per_row=1280 sample_rows=3 samples={} rgba=exact diagnostics=none",
            self.readback_surface_generation.unwrap_or(self.surface_generation),
            self.readback_frame_sequence.unwrap_or(self.frame_sequence),
            self.snapshot.source().fixture_id,
            SAMPLE_COUNT,
        )))
    }

    fn render_pass(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        pipeline: &wgpu::RenderPipeline,
        vertex_buffer: &wgpu::Buffer,
    ) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("spinon-s04-static-scene-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: 0.055,
                        g: 0.075,
                        b: 0.12,
                        a: 1.0,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_vertex_buffer(0, vertex_buffer.slice(..));
        pass.draw(0..self.vertex_count, 0..1);
    }

    fn ensure_no_diagnostics(&self) -> Result<(), String> {
        let mut diagnostics = self
            .diagnostics
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if diagnostics.is_empty() {
            return Ok(());
        }
        Err(format!(
            "S04 wgpu 진단 오류: {}",
            diagnostics.drain(..).collect::<Vec<_>>().join(" | ")
        ))
    }
}

fn create_pipeline(device: &wgpu::Device, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("spinon-s04-static-snapshot-shader"),
        source: wgpu::ShaderSource::Wgsl(SHADER.into()),
    });
    const ATTRIBUTES: [wgpu::VertexAttribute; 2] =
        wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x4];
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("spinon-s04-static-snapshot-pipeline"),
        layout: None,
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[Some(wgpu::VertexBufferLayout {
                array_stride: 24,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &ATTRIBUTES,
            })],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn failure(code: i32, variant: &str, message: &str) -> S04Failure {
    S04Failure {
        code,
        message: format!("acquire={variant} {message}"),
    }
}
