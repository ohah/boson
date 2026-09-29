import MetalKit
import OSLog
import UIKit

final class R08GpuDemoViewController: UIViewController, UITextFieldDelegate {
    private let logger = Logger(subsystem: "dev.spinon.bootstrap", category: "r08")
    private let canvas: UIView
    private let useWgpu: Bool
    private let r13Enabled: Bool
    private let titleLabel = UILabel()
    private let statusLabel = UILabel()
    private let inputField = UITextField()

    init(useWgpu: Bool = false, r13Enabled: Bool = false,
         r13FailureInjection: Int32 = 0) {
        self.useWgpu = useWgpu
        self.r13Enabled = r13Enabled
        self.canvas = useWgpu
            ? R08WgpuCanvasView(
                frame: .zero, r13Enabled: r13Enabled,
                r13FailureInjection: r13FailureInjection)
            : R08MetalCanvasView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        self.useWgpu = false
        self.r13Enabled = false
        self.canvas = R08MetalCanvasView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        super.init(coder: coder)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.055, green: 0.075, blue: 0.12, alpha: 1)

        canvas.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(canvas)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = r13Enabled
            ? "SPINON · R13 GPU 복구\niOS · wgpu / Metal"
            : useWgpu
                ? "SPINON · R08 GPU 표면\niOS · wgpu / Metal"
                : "SPINON · R08 GPU 표면\niOS · Metal"
        titleLabel.textColor = UIColor(red: 0.92, green: 0.95, blue: 0.99, alpha: 1)
        titleLabel.font = .systemFont(ofSize: 22, weight: .bold)
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityElementsHidden = true
        view.addSubview(titleLabel)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "GPU 표면 대기 중 · 텍스트 입력은 네이티브 IME 실험"
        statusLabel.textColor = UIColor(red: 0.78, green: 0.83, blue: 0.90, alpha: 1)
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.numberOfLines = 0
        statusLabel.accessibilityElementsHidden = true
        view.addSubview(statusLabel)

        inputField.translatesAutoresizingMaskIntoConstraints = false
        inputField.borderStyle = .roundedRect
        inputField.backgroundColor = .white
        inputField.textColor = .black
        inputField.font = .systemFont(ofSize: 16)
        inputField.attributedPlaceholder = NSAttributedString(
            string: "텍스트 입력 · IME 경계 실험",
            attributes: [.foregroundColor: UIColor.darkGray])
        inputField.accessibilityLabel = r13Enabled ? "R13 텍스트 입력 실험" : "R08 텍스트 입력 실험"
        inputField.returnKeyType = .done
        inputField.autocorrectionType = .no
        inputField.delegate = self
        inputField.addTarget(self, action: #selector(textDidChange(_:)), for: .editingChanged)
        view.addSubview(inputField)

        let onActivate: (Int) -> Void = { [weak self] count in
            self?.statusLabel.text = "GPU 도형 활성화 \(count)회 · 텍스트 입력은 네이티브 오버레이"
        }
        (canvas as? R08MetalCanvasView)?.onActivate = onActivate
        (canvas as? R08WgpuCanvasView)?.onActivate = onActivate

        NSLayoutConstraint.activate([
            canvas.topAnchor.constraint(equalTo: view.topAnchor),
            canvas.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            canvas.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            canvas.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -22),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -22),
            statusLabel.bottomAnchor.constraint(equalTo: inputField.topAnchor, constant: -10),
            inputField.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            inputField.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -22),
            inputField.heightAnchor.constraint(equalToConstant: 54),
            inputField.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -14)
        ])

        logger.notice("SPINON_R08_UI=ready text-input=UITextField accessibility=button+UITextField")
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        (canvas as? R08MetalCanvasView)?.draw()
        (canvas as? R08WgpuCanvasView)?.draw()
    }

    @objc private func textDidChange(_ textField: UITextField) {
        let length = textField.text?.count ?? 0
        let composing = textField.markedTextRange != nil
        statusLabel.text = "IME 입력 길이 \(length) · 조합 중 \(composing ? "예" : "아니요")"
        logger.notice("SPINON_R08_TEXT_INPUT length=\(length) composing=\(composing)")
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        logger.notice("SPINON_R08_IME_ACTION=done")
        textField.resignFirstResponder()
        return true
    }
}

private final class R08WgpuCanvasView: UIView {
    private let logger = Logger(subsystem: "dev.spinon.bootstrap", category: "r08")
    private let r13Enabled: Bool
    private var renderer: UnsafeMutableRawPointer?
    private var activationCount: UInt32 = 0
    private var firstFrameLogged = false
    private var configuredSize = CGSize.zero
    private var rendererGeneration = 0
    private var pendingFailureInjection: Int32
    private var hostActive: Bool
    private var hasReachedActiveState = false
    private var resumeRedrawPending = false
    var onActivate: ((Int) -> Void)?

    override class var layerClass: AnyClass { CAMetalLayer.self }

    init(frame: CGRect, r13Enabled: Bool = false,
         r13FailureInjection: Int32 = 0) {
        self.r13Enabled = r13Enabled
        self.pendingFailureInjection = r13FailureInjection
        self.hostActive = r13Enabled
            ? UIApplication.shared.applicationState == .active
            : true
        super.init(frame: frame)
        configure()
    }

    required init?(coder: NSCoder) {
        self.r13Enabled = false
        self.pendingFailureInjection = 0
        self.hostActive = true
        super.init(coder: coder)
        configure()
    }

    private func configure() {
        isOpaque = true
        backgroundColor = UIColor(red: 0.055, green: 0.075, blue: 0.12, alpha: 1)
        isAccessibilityElement = true
        accessibilityLabel = r13Enabled ? "R13 GPU 도형" : "R08 GPU 도형"
        accessibilityValue = "활성화 0회"
        accessibilityHint = "중앙 도형을 두 번 탭하면 색이 바뀝니다."
        accessibilityTraits = .button
        if r13Enabled {
            NotificationCenter.default.addObserver(
                self, selector: #selector(hostWillResignActive),
                name: UIApplication.willResignActiveNotification, object: nil)
            NotificationCenter.default.addObserver(
                self, selector: #selector(hostDidBecomeActive),
                name: UIApplication.didBecomeActiveNotification, object: nil)
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if r13Enabled && window == nil {
            destroyRenderer()
            configuredSize = .zero
            logger.notice("SPINON_R13_SURFACE=detached")
        } else {
            setNeedsLayout()
            if window != nil { layoutIfNeeded() }
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard window != nil, bounds.width > 0, bounds.height > 0 else { return }
        let scale = window?.screen.scale ?? UIScreen.main.scale
        let width = UInt32(max(1, Int((bounds.width * scale).rounded())))
        let height = UInt32(max(1, Int((bounds.height * scale).rounded())))
        layer.contentsScale = scale
        (layer as? CAMetalLayer)?.drawableSize = CGSize(width: CGFloat(width), height: CGFloat(height))

        guard ensureRenderer(width: width, height: height, reason: "layout") else { return }
        configuredSize = CGSize(width: CGFloat(width), height: CGFloat(height))
        if hostActive { draw() }
    }

    func draw() {
        guard hostActive else { return }
        if renderer == nil {
            setNeedsLayout()
            layoutIfNeeded()
            return
        }
        guard let renderer else { return }
        let result = SpinonRunner.drawR08Wgpu(renderer, activationCount: activationCount)
        if result == 0, !firstFrameLogged {
            firstFrameLogged = true
            logger.notice("SPINON_R08_WGPU_FRAME=first_draw_submitted")
            if r13Enabled { logger.notice("SPINON_R13_FRAME=presented generation=\(self.rendererGeneration)") }
        }
        if result == 0 {
            logResumeRedrawSuccess()
        } else if r13Enabled && isRecoverable(result) {
            recoverRenderer(failureCode: result)
        }
    }

    @objc private func hostWillResignActive() {
        hostActive = false
        if r13Enabled { logger.notice("SPINON_R13_HOST=inactive") }
    }

    @objc private func hostDidBecomeActive() {
        resumeRedrawPending = hasReachedActiveState && !hostActive
        hostActive = true
        hasReachedActiveState = true
        if r13Enabled { logger.notice("SPINON_R13_HOST=active") }
        setNeedsLayout()
        layoutIfNeeded()
    }

    private func ensureRenderer(width: UInt32, height: UInt32, reason: String) -> Bool {
        if renderer == nil {
            renderer = SpinonRunner.createR08Wgpu(
                withUIKitView: Unmanaged.passUnretained(self).toOpaque(),
                width: width,
                height: height)
            guard renderer != nil else {
                if r13Enabled { logger.error("SPINON_R13_RECOVERY=failed stage=create reason=\(reason)") }
                return false
            }
            rendererGeneration += 1
            if r13Enabled {
                logger.notice("SPINON_R13_RENDERER=created generation=\(self.rendererGeneration) reason=\(reason)")
            }
            if pendingFailureInjection != 0, let renderer {
                let failure = pendingFailureInjection
                let result = SpinonRunner.injectR13Failure(renderer, kind: UInt32(failure))
                if result == 0 {
                    logger.notice("SPINON_R13_FAULT=injected kind=\(failure)")
                    pendingFailureInjection = 0
                } else {
                    logger.error("SPINON_R13_FAULT=injection_failed code=\(result)")
                }
            }
            return true
        }
        if configuredSize != CGSize(width: CGFloat(width), height: CGFloat(height)) {
            let result = SpinonRunner.resizeR08Wgpu(renderer, width: width, height: height)
            guard result == 0 else {
                logger.error("SPINON_R08_WGPU_RESIZE_ERROR code=\(result)")
                if r13Enabled {
                    destroyRenderer()
                    return ensureRenderer(width: width, height: height, reason: "resize_recreate")
                }
                return false
            }
            if r13Enabled { logger.notice("SPINON_R13_SURFACE=resized \(width)x\(height)") }
        }
        return true
    }

    private func isRecoverable(_ result: Int32) -> Bool {
        return result == -3 || result == -4 || result == -5
    }

    private func failureName(_ result: Int32) -> String {
        if result == -3 { return "surface_lost" }
        if result == -4 { return "surface_outdated" }
        return "device_lost"
    }

    private func recoverRenderer(failureCode: Int32) {
        let reason = failureName(failureCode)
        logger.notice("SPINON_R13_RECOVERY=started reason=\(reason) generation=\(self.rendererGeneration)")
        destroyRenderer()
        guard let window else {
            logger.error("SPINON_R13_RECOVERY=failed reason=\(reason) stage=detached")
            return
        }
        let scale = window.screen.scale
        let width = UInt32(max(1, Int((bounds.width * scale).rounded())))
        let height = UInt32(max(1, Int((bounds.height * scale).rounded())))
        guard ensureRenderer(width: width, height: height, reason: "recover_\(reason)"),
              let renderer else {
            logger.error("SPINON_R13_RECOVERY=failed reason=\(reason) stage=create")
            return
        }
        configuredSize = CGSize(width: CGFloat(width), height: CGFloat(height))
        let retry = SpinonRunner.drawR08Wgpu(renderer, activationCount: activationCount)
        if retry == 0 {
            logger.notice("SPINON_R13_RECOVERY=complete reason=\(reason) generation=\(self.rendererGeneration) redraw=success")
            logResumeRedrawSuccess()
        } else {
            logger.error("SPINON_R13_RECOVERY=failed reason=\(reason) stage=redraw code=\(retry)")
        }
    }

    private func logResumeRedrawSuccess() {
        if r13Enabled && resumeRedrawPending {
            resumeRedrawPending = false
            logger.notice("SPINON_R13_RESUME=redraw_success")
        }
    }

    private func destroyRenderer() {
        if let renderer {
            self.renderer = nil
            SpinonRunner.destroyR08Wgpu(renderer)
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let point = touches.first?.location(in: self),
              point.x >= bounds.width * 0.11,
              point.x <= bounds.width * 0.89,
              point.y >= bounds.height * 0.40,
              point.y <= bounds.height * 0.60 else {
            super.touchesEnded(touches, with: event)
            return
        }
        activate()
    }

    override func accessibilityActivate() -> Bool {
        activate()
        return true
    }

    override var accessibilityFrame: CGRect {
        get {
            guard let window else { return .zero }
            let visibleBounds = CGRect(
                x: bounds.width * 0.11,
                y: bounds.height * 0.40,
                width: bounds.width * 0.78,
                height: bounds.height * 0.20)
            let windowBounds = convert(visibleBounds, to: window)
            return window.screen.coordinateSpace.convert(windowBounds, from: window)
        }
        set {}
    }

    private func activate() {
        activationCount += 1
        accessibilityValue = "활성화 \(activationCount)회"
        onActivate?(Int(activationCount))
        let tag = r13Enabled ? "R13" : "R08"
        logger.notice("SPINON_\(tag)_TOUCH count=\(self.activationCount)")
        draw()
    }

    deinit {
        destroyRenderer()
    }
}

private final class R08MetalCanvasView: MTKView, MTKViewDelegate {
    private let logger = Logger(subsystem: "dev.spinon.bootstrap", category: "r08")
    private var pipeline: MTLRenderPipelineState?
    private var commandQueue: MTLCommandQueue?
    private var vertexBuffer: MTLBuffer?
    private var activationCount = 0
    private var firstFrameLogged = false
    var onActivate: ((Int) -> Void)?

    override init(frame: CGRect, device: MTLDevice?) {
        super.init(frame: frame, device: device ?? MTLCreateSystemDefaultDevice())
        configure()
    }

    required init(coder: NSCoder) {
        super.init(coder: coder)
        configure()
    }

    private func configure() {
        delegate = self
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColor(red: 0.055, green: 0.075, blue: 0.12, alpha: 1)
        framebufferOnly = true
        isPaused = true
        enableSetNeedsDisplay = true
        isAccessibilityElement = true
        accessibilityLabel = "R08 GPU 도형"
        accessibilityValue = "활성화 0회"
        accessibilityHint = "중앙 도형을 두 번 탭하면 색이 바뀝니다."
        accessibilityTraits = .button

        guard let device else {
            logger.error("SPINON_R08_METAL_ERROR=no_device")
            return
        }
        commandQueue = device.makeCommandQueue()
        guard commandQueue != nil else {
            logger.error("SPINON_R08_METAL_ERROR=no_command_queue")
            return
        }

        let points: [SIMD2<Float>] = [
            SIMD2(-0.78, -0.20), SIMD2(0.78, -0.20),
            SIMD2(-0.78, 0.20), SIMD2(0.78, 0.20)
        ]
        vertexBuffer = device.makeBuffer(
            bytes: points,
            length: MemoryLayout<SIMD2<Float>>.stride * points.count,
            options: [])

        do {
            let source = """
            #include <metal_stdlib>
            using namespace metal;
            struct VertexOut { float4 position [[position]]; };
            vertex VertexOut r08_vertex(uint id [[vertex_id]], const device float2 *points [[buffer(0)]]) {
                VertexOut out;
                out.position = float4(points[id], 0.0, 1.0);
                return out;
            }
            fragment float4 r08_fragment(VertexOut in [[stage_in]], constant float4 &color [[buffer(0)]]) {
                return color;
            }
            """
            let library = try device.makeLibrary(source: source, options: nil)
            guard let vertex = library.makeFunction(name: "r08_vertex"),
                  let fragment = library.makeFunction(name: "r08_fragment") else {
                logger.error("SPINON_R08_METAL_ERROR=shader_function_missing")
                return
            }
            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = vertex
            descriptor.fragmentFunction = fragment
            descriptor.colorAttachments[0].pixelFormat = colorPixelFormat
            pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
            logger.notice("SPINON_R08_METAL=ready device=\(device.name, privacy: .public)")
        } catch {
            logger.error("SPINON_R08_METAL_ERROR=\(String(describing: error), privacy: .public)")
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            draw()
        }
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        logger.notice("SPINON_R08_SURFACE=size \(Int(size.width))x\(Int(size.height))")
    }

    func draw(in view: MTKView) {
        guard let descriptor = currentRenderPassDescriptor,
              let drawable = currentDrawable,
              let pipeline,
              let vertexBuffer,
              let commandBuffer = commandQueue?.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return
        }

        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        var color = activationCount.isMultiple(of: 2)
            ? SIMD4<Float>(0.20, 0.49, 0.96, 1.0)
            : SIMD4<Float>(0.98, 0.39, 0.28, 1.0)
        encoder.setFragmentBytes(&color, length: MemoryLayout<SIMD4<Float>>.stride, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()
        commandBuffer.present(drawable)
        commandBuffer.commit()
        if !firstFrameLogged {
            firstFrameLogged = true
            logger.notice("SPINON_R08_FRAME=first_draw_submitted")
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let point = touches.first?.location(in: self),
              point.x >= bounds.width * 0.11,
              point.x <= bounds.width * 0.89,
              point.y >= bounds.height * 0.40,
              point.y <= bounds.height * 0.60 else {
            super.touchesEnded(touches, with: event)
            return
        }
        activate()
    }

    override func accessibilityActivate() -> Bool {
        activate()
        return true
    }

    override var accessibilityFrame: CGRect {
        get {
            guard let window else { return .zero }
            let visibleBounds = CGRect(
                x: bounds.width * 0.11,
                y: bounds.height * 0.40,
                width: bounds.width * 0.78,
                height: bounds.height * 0.20)
            let windowBounds = convert(visibleBounds, to: window)
            return window.screen.coordinateSpace.convert(windowBounds, from: window)
        }
        set {}
    }

    private func activate() {
        activationCount += 1
        accessibilityValue = "활성화 \(activationCount)회"
        onActivate?(activationCount)
        logger.notice("SPINON_R08_TOUCH count=\(self.activationCount)")
        draw()
    }
}
