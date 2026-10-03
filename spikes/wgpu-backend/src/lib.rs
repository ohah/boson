use std::ffi::{c_char, c_void};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use raw_window_handle::{RawDisplayHandle, RawWindowHandle};

#[cfg(feature = "s04-fixture")]
mod s04_gpu;
#[cfg(feature = "s04-fixture")]
mod s04_snapshot;

mod ffi;
pub use ffi::*;
#[cfg(test)]
mod r13_tests;

const SHADER: &str = r#"
struct ColorUniform {
    color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> color_uniform: ColorUniform;

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 4>(
        vec2<f32>(-0.78, -0.20),
        vec2<f32>( 0.78, -0.20),
        vec2<f32>(-0.78,  0.20),
        vec2<f32>( 0.78,  0.20),
    );
    return vec4<f32>(positions[index], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return color_uniform.color;
}
"#;

struct Renderer {
    _instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    device_lost: Arc<AtomicBool>,
    injected_failure: Option<u32>,
    info: String,
    #[cfg(feature = "s04-fixture")]
    s04_scene: Option<s04_gpu::S04Scene>,
}

#[cfg(feature = "s04-fixture")]
#[derive(Clone, Copy)]
struct S04Init {
    density: f32,
    surface_generation: u64,
}

#[derive(Debug)]
enum DrawFailure {
    SurfaceLost,
    SurfaceOutdated,
    DeviceLost,
    Temporary(String),
}

impl DrawFailure {
    fn code(&self) -> i32 {
        match self {
            Self::SurfaceLost => -3,
            Self::SurfaceOutdated => -4,
            Self::DeviceLost => -5,
            Self::Temporary(_) => -2,
        }
    }

    fn message(&self) -> String {
        match self {
            Self::SurfaceLost => "wgpu surface lost; recreate surface and renderer".to_owned(),
            Self::SurfaceOutdated => {
                "wgpu surface outdated; reconfigure or recreate renderer".to_owned()
            }
            Self::DeviceLost => {
                "wgpu device lost; recreate device resources and renderer".to_owned()
            }
            Self::Temporary(message) => message.clone(),
        }
    }
}

fn injected_failure(failure_kind: u32) -> Option<DrawFailure> {
    match failure_kind {
        1 => Some(DrawFailure::SurfaceLost),
        2 => Some(DrawFailure::DeviceLost),
        3 => Some(DrawFailure::SurfaceOutdated),
        4 => Some(DrawFailure::Temporary(
            "injected temporary surface error".to_owned(),
        )),
        _ => None,
    }
}

fn is_supported_failure_kind(failure_kind: u32) -> bool {
    injected_failure(failure_kind).is_some()
}

impl Renderer {
    unsafe fn new(
        display: RawDisplayHandle,
        window: RawWindowHandle,
        width: u32,
        height: u32,
        backend: wgpu::Backends,
        #[cfg(feature = "s04-fixture")] s04_init: Option<S04Init>,
    ) -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: backend,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        // SAFETY: 플랫폼 호스트가 네이티브 표면을 Renderer 파괴 때까지 유지한다.
        let surface = unsafe {
            instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                raw_display_handle: Some(display),
                raw_window_handle: window,
            })
        }
        .map_err(|error| format!("surface creation failed: {error}"))?;

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: Some(&surface),
            ..Default::default()
        }))
        .map_err(|error| format!("adapter request failed: {error}"))?;

        let info = adapter.get_info();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            required_limits: adapter.limits(),
            ..Default::default()
        }))
        .map_err(|error| format!("device request failed: {error}"))?;
        #[cfg(feature = "s04-fixture")]
        let diagnostics = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        #[cfg(feature = "s04-fixture")]
        {
            let uncaptured = Arc::clone(&diagnostics);
            device.on_uncaptured_error(Arc::new(move |error| {
                uncaptured
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(error.to_string());
            }));
        }
        let device_lost = Arc::new(AtomicBool::new(false));
        let device_lost_callback = Arc::clone(&device_lost);
        #[cfg(feature = "s04-fixture")]
        let lost_diagnostics = Arc::clone(&diagnostics);
        device.set_device_lost_callback(move |reason, message| {
            eprintln!("SPINON_R13_DEVICE_LOST reason={reason:?} message={message}");
            device_lost_callback.store(true, Ordering::Release);
            #[cfg(feature = "s04-fixture")]
            lost_diagnostics
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(format!("device-lost reason={reason:?} message={message}"));
        });

        let capabilities = surface.get_capabilities(&adapter);
        let mut config = surface
            .get_default_config(&adapter, width.max(1), height.max(1))
            .ok_or_else(|| "adapter cannot present to this surface".to_owned())?;
        #[cfg(feature = "s04-fixture")]
        if s04_init.is_some() {
            config.format = choose_s04_surface_format(&capabilities)?;
            config.color_space = wgpu::SurfaceColorSpace::Srgb;
        } else if let Some(format) = capabilities.formats.iter().copied().find(|format| {
            matches!(
                format,
                wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm
            )
        }) {
            config.format = format;
        }
        #[cfg(not(feature = "s04-fixture"))]
        if let Some(format) = capabilities.formats.iter().copied().find(|format| {
            matches!(
                format,
                wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm
            )
        }) {
            config.format = format;
        }
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);
        let target_format = config.format;
        let target_color_space = config.color_space;
        #[cfg(feature = "s04-fixture")]
        let s04_scene = s04_init
            .map(|init| {
                s04_gpu::S04Scene::new(
                    &device,
                    &queue,
                    s04_gpu::S04SceneConfig {
                        surface_format: config.format,
                        surface_width: config.width,
                        surface_height: config.height,
                        density: init.density,
                        surface_generation: init.surface_generation,
                    },
                    Arc::clone(&diagnostics),
                )
            })
            .transpose()?;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("spinon-wgpu-r08-shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spinon-wgpu-r08-color"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let targets = [Some(wgpu::ColorTargetState {
            format: config.format,
            blend: Some(wgpu::BlendState::REPLACE),
            write_mask: wgpu::ColorWrites::ALL,
        })];
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("spinon-wgpu-r08-pipeline"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleStrip,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &targets,
            }),
            multiview_mask: None,
            cache: None,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("spinon-wgpu-r08-bind-group"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });

        Ok(Self {
            _instance: instance,
            surface,
            device,
            queue,
            config,
            pipeline,
            uniform,
            bind_group,
            device_lost,
            injected_failure: None,
            #[cfg(feature = "s04-fixture")]
            s04_scene,
            info: format!(
                "backend={:?} device={:?} name={} format={:?} color_space={:?} supported_formats={:?}",
                info.backend,
                info.device_type,
                info.name,
                target_format,
                target_color_space,
                capabilities.formats
            ),
        })
    }

    #[cfg(feature = "s04-fixture")]
    fn draw_s04(&mut self) -> Result<String, s04_gpu::S04Failure> {
        if self.device_lost.load(Ordering::Acquire) {
            return Err(s04_gpu::S04Failure {
                code: -5,
                message: "acquire=DeviceLost wgpu device가 손실됐습니다".to_owned(),
            });
        }
        self.s04_scene
            .as_mut()
            .ok_or_else(|| s04_gpu::S04Failure {
                code: -1,
                message: "S04 snapshot scene 없이 호출했습니다".to_owned(),
            })?
            .draw(&self.surface, &self.device, &self.queue)
    }

    #[cfg(feature = "s04-fixture")]
    fn poll_s04_readback(&mut self) -> Result<Option<String>, String> {
        let scene = self
            .s04_scene
            .as_mut()
            .ok_or_else(|| "S04 snapshot scene 없이 readback을 조회했습니다".to_owned())?;
        scene.poll_readback(&self.device)
    }

    fn draw(&mut self, activation_count: u32) -> Result<(), DrawFailure> {
        if let Some(failure) = self.injected_failure.take() {
            return Err(injected_failure(failure).unwrap_or_else(|| {
                DrawFailure::Temporary("unknown injected R13 failure".to_owned())
            }));
        }
        if self.device_lost.load(Ordering::Acquire) {
            return Err(DrawFailure::DeviceLost);
        }
        let color = if activation_count.is_multiple_of(2) {
            [0.20f32, 0.49, 0.96, 1.0]
        } else {
            [0.98f32, 0.39, 0.28, 1.0]
        };
        self.queue
            .write_buffer(&self.uniform, 0, bytemuck::cast_slice(&color));

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => frame,
            wgpu::CurrentSurfaceTexture::Lost => return Err(DrawFailure::SurfaceLost),
            wgpu::CurrentSurfaceTexture::Outdated => return Err(DrawFailure::SurfaceOutdated),
            wgpu::CurrentSurfaceTexture::Timeout => {
                return Err(DrawFailure::Temporary(
                    "wgpu surface acquisition timed out".to_owned(),
                ))
            }
            wgpu::CurrentSurfaceTexture::Occluded => {
                return Err(DrawFailure::Temporary(
                    "wgpu surface is occluded".to_owned(),
                ))
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err(DrawFailure::Temporary(
                    "wgpu surface validation failed".to_owned(),
                ))
            }
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("spinon-wgpu-r08-encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("spinon-wgpu-r08-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
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
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..4, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        self.queue.present(frame);
        Ok(())
    }
}

#[cfg(feature = "s04-fixture")]
fn choose_s04_surface_format(
    capabilities: &wgpu::SurfaceCapabilities,
) -> Result<wgpu::TextureFormat, String> {
    [
        wgpu::TextureFormat::Rgba8UnormSrgb,
        wgpu::TextureFormat::Bgra8UnormSrgb,
    ]
    .into_iter()
    .find(|format| {
        capabilities.format_capabilities.iter().any(|item| {
            item.format == *format && item.color_spaces.contains(wgpu::SurfaceColorSpaces::SRGB)
        })
    })
    .ok_or_else(|| "S04 surface에 sRGB 색공간·8-bit sRGB attachment 조합이 없습니다".to_owned())
}

fn choose_backend(backend: u32) -> Result<wgpu::Backends, String> {
    match backend {
        1 => Ok(wgpu::Backends::VULKAN),
        2 => Ok(wgpu::Backends::GL),
        3 => Ok(wgpu::Backends::METAL),
        _ => Err(format!("unknown backend selector {backend}")),
    }
}

unsafe fn write_message(output: *mut c_char, capacity: usize, message: &str) {
    if output.is_null() || capacity == 0 {
        return;
    }
    let bytes = message.as_bytes();
    let length = bytes.len().min(capacity - 1);
    unsafe {
        ptr::copy_nonoverlapping(bytes.as_ptr(), output.cast::<u8>(), length);
        *output.add(length) = 0;
    }
}

struct RendererCreateInfo {
    display: RawDisplayHandle,
    window: RawWindowHandle,
    width: u32,
    height: u32,
    backend: u32,
    #[cfg(feature = "s04-fixture")]
    s04_init: Option<S04Init>,
}

unsafe fn create_renderer(
    info: RendererCreateInfo,
    output: *mut c_char,
    output_capacity: usize,
) -> *mut c_void {
    let result = choose_backend(info.backend).and_then(|backend| unsafe {
        // SAFETY: 호출하는 FFI 함수의 계약이 원시 표면 handle의 유효 기간을 보장한다.
        Renderer::new(
            info.display,
            info.window,
            info.width,
            info.height,
            backend,
            #[cfg(feature = "s04-fixture")]
            info.s04_init,
        )
    });
    match result {
        Ok(renderer) => {
            unsafe { write_message(output, output_capacity, &renderer.info) };
            Box::into_raw(Box::new(renderer)).cast()
        }
        Err(error) => {
            unsafe { write_message(output, output_capacity, &error) };
            ptr::null_mut()
        }
    }
}
