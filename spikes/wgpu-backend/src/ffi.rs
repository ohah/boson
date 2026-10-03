use std::ffi::{c_char, c_void};
use std::ptr;
use std::sync::atomic::Ordering;

use raw_window_handle::{
    AndroidDisplayHandle, AndroidNdkWindowHandle, RawDisplayHandle, RawWindowHandle,
    UiKitDisplayHandle, UiKitWindowHandle,
};

use super::{
    create_renderer, is_supported_failure_kind, write_message, Renderer, RendererCreateInfo,
};
#[cfg(feature = "s04-android-fixture")]
use super::S04Init;

#[no_mangle]
/// # Safety
/// `native_window`는 renderer destroy까지 유효한 `ANativeWindow`여야 합니다. 출력 버퍼는
/// `output_capacity` bytes만큼 쓸 수 있어야 하며 renderer별 함수 호출은 직렬화해야 합니다.
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
    // SAFETY: 이 FFI 함수의 호출 계약이 표면 수명과 출력 버퍼 쓰기 범위를 보장한다.
    unsafe {
        create_renderer(
            RendererCreateInfo {
                display: RawDisplayHandle::Android(AndroidDisplayHandle::new()),
                window: RawWindowHandle::AndroidNdk(AndroidNdkWindowHandle::new(native_window)),
                width,
                height,
                backend,
                #[cfg(feature = "s04-android-fixture")]
                s04_init: None,
            },
            output,
            output_capacity,
        )
    }
}

#[cfg(feature = "s04-android-fixture")]
#[no_mangle]
/// # Safety
/// `native_window`는 renderer destroy까지 유효한 `ANativeWindow`여야 합니다. 출력 버퍼는
/// `output_capacity` bytes만큼 쓸 수 있어야 하며 renderer별 함수 호출은 직렬화해야 합니다.
pub unsafe extern "C" fn spinon_wgpu_create_android_s04(
    native_window: *mut c_void,
    width: u32,
    height: u32,
    backend: u32,
    density: f32,
    surface_generation: u64,
    output: *mut c_char,
    output_capacity: usize,
) -> *mut c_void {
    let Some(native_window) = std::ptr::NonNull::new(native_window) else {
        unsafe { write_message(output, output_capacity, "null ANativeWindow") };
        return ptr::null_mut();
    };
    // SAFETY: 이 FFI 함수의 호출 계약이 표면 수명과 출력 버퍼 쓰기 범위를 보장한다.
    unsafe {
        create_renderer(
            RendererCreateInfo {
                display: RawDisplayHandle::Android(AndroidDisplayHandle::new()),
                window: RawWindowHandle::AndroidNdk(AndroidNdkWindowHandle::new(native_window)),
                width,
                height,
                backend,
                s04_init: Some(S04Init {
                    density,
                    surface_generation,
                }),
            },
            output,
            output_capacity,
        )
    }
}

#[no_mangle]
/// # Safety
/// `ui_view`는 renderer destroy까지 유효한 UIKit view여야 합니다. 출력 버퍼는
/// `output_capacity` bytes만큼 쓸 수 있어야 하며 renderer별 함수 호출은 직렬화해야 합니다.
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
    // SAFETY: 이 FFI 함수의 호출 계약이 view 수명과 출력 버퍼 쓰기 범위를 보장한다.
    unsafe {
        create_renderer(
            RendererCreateInfo {
                display: RawDisplayHandle::UiKit(UiKitDisplayHandle::new()),
                window: RawWindowHandle::UiKit(UiKitWindowHandle::new(ui_view)),
                width,
                height,
                backend,
                #[cfg(feature = "s04-android-fixture")]
                s04_init: None,
            },
            output,
            output_capacity,
        )
    }
}

#[no_mangle]
/// # Safety
/// `renderer`는 아직 destroy되지 않은 생성 함수의 핸들이어야 합니다. 출력 버퍼는
/// `output_capacity` bytes만큼 쓸 수 있어야 하며 호출은 해당 renderer의 직렬 호스트 sequence에서 해야 합니다.
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

#[cfg(feature = "s04-android-fixture")]
#[no_mangle]
/// # Safety
/// `renderer`는 S04 생성 함수가 반환한 live 핸들이어야 합니다. 출력 버퍼는
/// `output_capacity` bytes만큼 쓸 수 있어야 하며 draw·resize·destroy와 경합하면 안 됩니다.
pub unsafe extern "C" fn spinon_wgpu_s04_draw(
    renderer: *mut c_void,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    let Some(renderer) = (unsafe { renderer.cast::<Renderer>().as_mut() }) else {
        unsafe { write_message(output, output_capacity, "null renderer") };
        return -1;
    };
    match renderer.draw_s04() {
        Ok(report) => {
            unsafe { write_message(output, output_capacity, &report) };
            0
        }
        Err(failure) => {
            unsafe { write_message(output, output_capacity, &failure.message) };
            failure.code
        }
    }
}

#[cfg(feature = "s04-android-fixture")]
#[no_mangle]
/// # Safety
/// `renderer`는 S04 생성 함수가 반환한 live 핸들이어야 합니다. 출력 버퍼는
/// `output_capacity` bytes만큼 쓸 수 있어야 하며 draw·resize·destroy와 경합하면 안 됩니다.
pub unsafe extern "C" fn spinon_wgpu_s04_poll_readback(
    renderer: *mut c_void,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    let Some(renderer) = (unsafe { renderer.cast::<Renderer>().as_mut() }) else {
        unsafe { write_message(output, output_capacity, "null renderer") };
        return -1;
    };
    match renderer.poll_s04_readback() {
        Ok(Some(report)) => {
            unsafe { write_message(output, output_capacity, &report) };
            1
        }
        Ok(None) => {
            unsafe { write_message(output, output_capacity, "pending") };
            0
        }
        Err(error) => {
            unsafe { write_message(output, output_capacity, &error) };
            -1
        }
    }
}

#[cfg(feature = "s04-android-fixture")]
#[no_mangle]
/// # Safety
/// `renderer`는 S04 생성 함수가 반환한 live 핸들이어야 하며 호출은 draw·poll·destroy와
/// 직렬화해야 합니다. 크기와 density는 양수여야 합니다.
pub unsafe extern "C" fn spinon_wgpu_s04_resize(
    renderer: *mut c_void,
    width: u32,
    height: u32,
    density: f32,
    surface_generation: u64,
) -> i32 {
    let Some(renderer) = (unsafe { renderer.cast::<Renderer>().as_mut() }) else {
        return -1;
    };
    if width == 0 || height == 0 {
        return -2;
    }
    let Some(scene) = renderer.s04_scene.as_mut() else {
        return -3;
    };
    if scene
        .resize(&renderer.queue, width, height, density, surface_generation)
        .is_err()
    {
        return -4;
    }
    renderer.config.width = width;
    renderer.config.height = height;
    renderer
        .surface
        .configure(&renderer.device, &renderer.config);
    0
}

#[no_mangle]
/// # Safety
/// `renderer`는 아직 destroy되지 않은 생성 함수의 핸들이어야 하며 호출은 같은 renderer의
/// draw·resize·destroy와 직렬화해야 합니다.
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
/// # Safety
/// `renderer`는 아직 destroy되지 않은 생성 함수의 핸들이어야 하며 호출은 같은 renderer의
/// draw·resize·destroy와 직렬화해야 합니다.
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
/// # Safety
/// `renderer`는 생성 함수가 반환한 live 핸들이거나 null이어야 합니다. live 핸들은 정확히 한
/// 번만 destroy하고 다른 renderer 호출과 경합시키면 안 됩니다.
pub unsafe extern "C" fn spinon_wgpu_destroy(renderer: *mut c_void) {
    if !renderer.is_null() {
        drop(unsafe { Box::from_raw(renderer.cast::<Renderer>()) });
    }
}
