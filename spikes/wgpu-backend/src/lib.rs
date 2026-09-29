use std::ffi::{c_char, c_void};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use raw_window_handle::{
    AndroidDisplayHandle, AndroidNdkWindowHandle, RawDisplayHandle, RawWindowHandle,
    UiKitDisplayHandle, UiKitWindowHandle,
};

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
        let device_lost = Arc::new(AtomicBool::new(false));
        let device_lost_callback = Arc::clone(&device_lost);
        device.set_device_lost_callback(move |reason, message| {
            eprintln!("SPINON_R13_DEVICE_LOST reason={reason:?} message={message}");
            device_lost_callback.store(true, Ordering::Release);
        });

        let capabilities = surface.get_capabilities(&adapter);
        let mut config = surface
            .get_default_config(&adapter, width.max(1), height.max(1))
            .ok_or_else(|| "adapter cannot present to this surface".to_owned())?;
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
            info: format!(
                "backend={:?} device={:?} name={} format={:?} supported_formats={:?}",
                info.backend, info.device_type, info.name, target_format, capabilities.formats
            ),
        })
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

unsafe fn create_renderer(
    display: RawDisplayHandle,
    window: RawWindowHandle,
    width: u32,
    height: u32,
    backend: u32,
    output: *mut c_char,
    output_capacity: usize,
) -> *mut c_void {
    let result = choose_backend(backend)
        .and_then(|backend| unsafe { Renderer::new(display, window, width, height, backend) });
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

#[no_mangle]
pub unsafe extern "C" fn spinon_wgpu_create_android(
    native_window: *mut c_void,
    width: u32,
    height: u32,
    backend: u32,
    output: *mut c_char,
    output_capacity: usize,
) -> *mut c_void {
    let Some(native_window) = std::ptr::NonNull::new(native_window) else {
        unsafe { write_message(output, output_capacity, "null ANativeWindow") };
        return ptr::null_mut();
    };
    unsafe {
        create_renderer(
            RawDisplayHandle::Android(AndroidDisplayHandle::new()),
            RawWindowHandle::AndroidNdk(AndroidNdkWindowHandle::new(native_window)),
            width,
            height,
            backend,
            output,
            output_capacity,
        )
    }
}

#[no_mangle]
pub unsafe extern "C" fn spinon_wgpu_create_uikit(
    ui_view: *mut c_void,
    width: u32,
    height: u32,
    backend: u32,
    output: *mut c_char,
    output_capacity: usize,
) -> *mut c_void {
    let Some(ui_view) = std::ptr::NonNull::new(ui_view) else {
        unsafe { write_message(output, output_capacity, "null UIView") };
        return ptr::null_mut();
    };
    unsafe {
        create_renderer(
            RawDisplayHandle::UiKit(UiKitDisplayHandle::new()),
            RawWindowHandle::UiKit(UiKitWindowHandle::new(ui_view)),
            width,
            height,
            backend,
            output,
            output_capacity,
        )
    }
}

#[no_mangle]
pub unsafe extern "C" fn spinon_wgpu_draw(
    renderer: *mut c_void,
    activation_count: u32,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    let Some(renderer) = (unsafe { renderer.cast::<Renderer>().as_mut() }) else {
        unsafe { write_message(output, output_capacity, "null renderer") };
        return -1;
    };
    match renderer.draw(activation_count) {
        Ok(()) => 0,
        Err(failure) => {
            unsafe { write_message(output, output_capacity, &failure.message()) };
            failure.code()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn spinon_wgpu_r13_inject_failure(
    renderer: *mut c_void,
    failure_kind: u32,
) -> i32 {
    let Some(renderer) = (unsafe { renderer.cast::<Renderer>().as_mut() }) else {
        return -1;
    };
    if !is_supported_failure_kind(failure_kind) {
        return -2;
    }
    match failure_kind {
        1 | 3 | 4 => renderer.injected_failure = Some(failure_kind),
        2 => renderer.device_lost.store(true, Ordering::Release),
        _ => unreachable!("failure kind was validated above"),
    }
    0
}

#[no_mangle]
pub unsafe extern "C" fn spinon_wgpu_resize(renderer: *mut c_void, width: u32, height: u32) -> i32 {
    let Some(renderer) = (unsafe { renderer.cast::<Renderer>().as_mut() }) else {
        return -1;
    };
    if width == 0 || height == 0 {
        return -2;
    }
    renderer.config.width = width;
    renderer.config.height = height;
    renderer
        .surface
        .configure(&renderer.device, &renderer.config);
    0
}

#[no_mangle]
pub unsafe extern "C" fn spinon_wgpu_destroy(renderer: *mut c_void) {
    if !renderer.is_null() {
        drop(unsafe { Box::from_raw(renderer.cast::<Renderer>()) });
    }
}

#[cfg(test)]
mod r13_tests {
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
}
