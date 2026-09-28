import MetalKit
import OSLog
import UIKit

final class R08GpuDemoViewController: UIViewController, UITextFieldDelegate {
    private let logger = Logger(subsystem: "dev.spinon.bootstrap", category: "r08")
    private let canvas = R08MetalCanvasView(frame: .zero, device: MTLCreateSystemDefaultDevice())
    private let titleLabel = UILabel()
    private let statusLabel = UILabel()
    private let inputField = UITextField()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.055, green: 0.075, blue: 0.12, alpha: 1)

        canvas.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(canvas)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "SPINON · R08 GPU 표면\niOS · Metal"
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
        inputField.accessibilityLabel = "R08 텍스트 입력 실험"
        inputField.returnKeyType = .done
        inputField.autocorrectionType = .no
        inputField.delegate = self
        inputField.addTarget(self, action: #selector(textDidChange(_:)), for: .editingChanged)
        view.addSubview(inputField)

        canvas.onActivate = { [weak self] count in
            self?.statusLabel.text = "GPU 도형 활성화 \(count)회 · 텍스트 입력은 네이티브 오버레이"
        }

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
        canvas.draw()
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
