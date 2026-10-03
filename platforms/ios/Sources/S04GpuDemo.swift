import MetalKit
import OSLog
import UIKit

final class S04GpuDemoViewController: UIViewController {
    private let canvas = S04GpuCanvasView()
    private let titleLabel = UILabel()
    private let statusLabel = UILabel()
    private let logger = Logger(subsystem: "dev.spinon.bootstrap", category: "s04")

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.055, green: 0.075, blue: 0.12, alpha: 1)

        canvas.translatesAutoresizingMaskIntoConstraints = false
        canvas.onStatusChange = { [weak self] status in
            self?.statusLabel.text = status
        }
        view.addSubview(canvas)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "SPINON · S04 GPU surface\niOS · wgpu / Metal"
        titleLabel.textColor = UIColor(red: 0.92, green: 0.95, blue: 0.99, alpha: 1)
        titleLabel.font = .systemFont(ofSize: 20, weight: .bold)
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityElementsHidden = true
        view.addSubview(titleLabel)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = SpinonRunner.isS04IosFixtureEnabled()
            ? "S04 고정 CSS fixture · 표면 준비 중"
            : "S04 fixture 비활성 · SPINON_ENABLE_S04_IOS_FIXTURE=1로 다시 빌드하세요"
        statusLabel.textColor = UIColor(red: 0.78, green: 0.83, blue: 0.90, alpha: 1)
        statusLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        statusLabel.numberOfLines = 0
        statusLabel.accessibilityElementsHidden = true
        view.addSubview(statusLabel)

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
            statusLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
        ])

        if !SpinonRunner.isS04IosFixtureEnabled() {
            logger.notice("SPINON_S04_FIXTURE=disabled rebuild with SPINON_ENABLE_S04_IOS_FIXTURE=1")
        }
    }
}

private final class S04GpuCanvasView: UIView {
    private let logger = Logger(subsystem: "dev.spinon.bootstrap", category: "s04")
    private var renderer: UnsafeMutableRawPointer?
    private var configuredSize = CGSize.zero
    private var configuredDensity: Float = 0
    private var attemptedSize = CGSize.zero
    private var attemptedDensity: Float = 0
    private var surfaceGeneration: UInt64 = 0
    private var readbackTimer: Timer?
    private var readbackDeadline: TimeInterval = 0
    private var readbackComplete = false
    var onStatusChange: ((String) -> Void)?

    override class var layerClass: AnyClass { CAMetalLayer.self }

    override init(frame: CGRect) {
        super.init(frame: frame)
        configure()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configure()
    }

    private func configure() {
        isOpaque = true
        backgroundColor = UIColor(red: 0.055, green: 0.075, blue: 0.12, alpha: 1)
        isAccessibilityElement = false
        accessibilityElementsHidden = true
        isUserInteractionEnabled = false
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else {
            readbackTimer?.invalidate()
            readbackTimer = nil
            destroyRenderer()
            configuredSize = .zero
            configuredDensity = 0
            attemptedSize = .zero
            attemptedDensity = 0
            logger.notice("SPINON_S04_SURFACE=detached")
            return
        }
        setNeedsLayout()
        layoutIfNeeded()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let window, bounds.width > 0, bounds.height > 0 else { return }
        let density = Float(window.screen.scale)
        guard density.isFinite, density > 0 else {
            fail("잘못된 화면 배율")
            return
        }
        let width = UInt32(max(1, Int((bounds.width * CGFloat(density)).rounded())))
        let height = UInt32(max(1, Int((bounds.height * CGFloat(density)).rounded())))
        let pixelSize = CGSize(width: CGFloat(width), height: CGFloat(height))
        layer.contentsScale = CGFloat(density)
        guard let metalLayer = layer as? CAMetalLayer else {
            fail("CAMetalLayer 표면을 찾지 못했습니다")
            return
        }
        metalLayer.drawableSize = pixelSize

        guard SpinonRunner.isS04IosFixtureEnabled() else { return }
        if renderer == nil {
            guard attemptedSize != pixelSize || attemptedDensity != density else { return }
            attemptedSize = pixelSize
            attemptedDensity = density
            createRenderer(width: width, height: height, density: density)
            return
        }
        guard configuredSize != pixelSize || configuredDensity != density else { return }
        resizeRenderer(width: width, height: height, density: density, size: pixelSize)
    }

    private func createRenderer(width: UInt32, height: UInt32, density: Float) {
        guard advanceSurfaceGeneration() else { return }
        guard let renderer = SpinonRunner.createS04Wgpu(
            withUIKitView: Unmanaged.passUnretained(self).toOpaque(),
            width: width,
            height: height,
            density: density,
            surfaceGeneration: surfaceGeneration
        ) else {
            fail("S04 wgpu surface 생성 실패 · 실행 로그를 확인하세요")
            return
        }
        self.renderer = renderer
        configuredSize = CGSize(width: CGFloat(width), height: CGFloat(height))
        configuredDensity = density
        readbackComplete = false
        logger.notice("SPINON_S04_SURFACE=size \(width)x\(height) density=\(density, format: .fixed(precision: 4))")
        guard submitFrame() else { return }
        startReadbackPolling()
    }

    private func resizeRenderer(width: UInt32, height: UInt32, density: Float, size: CGSize) {
        guard let renderer else { return }
        guard advanceSurfaceGeneration() else { return }
        let result = SpinonRunner.resizeS04Wgpu(
            renderer,
            width: width,
            height: height,
            density: density,
            surfaceGeneration: surfaceGeneration
        )
        guard result == 0 else {
            fail("S04 wgpu surface 크기 변경 실패 · code=\(result)")
            destroyRenderer()
            return
        }
        configuredSize = size
        configuredDensity = density
        logger.notice("SPINON_S04_SURFACE=resized generation=\(self.surfaceGeneration) size=\(width)x\(height)")
        _ = submitFrame()
    }

    @discardableResult
    private func submitFrame() -> Bool {
        guard let renderer else { return false }
        let report = SpinonRunner.drawS04Wgpu(renderer) ?? "empty S04 draw report"
        guard report.hasPrefix("status=0 ") else {
            fail("S04 GPU frame 제출 실패 · \(report)")
            return false
        }
        onStatusChange?("S04 frame 제출 · generation \(surfaceGeneration)")
        return true
    }

    private func startReadbackPolling() {
        readbackDeadline = ProcessInfo.processInfo.systemUptime + 5
        readbackTimer?.invalidate()
        readbackTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
            self?.pollReadback()
        }
    }

    private func pollReadback() {
        guard let renderer, !readbackComplete else {
            readbackTimer?.invalidate()
            readbackTimer = nil
            return
        }
        let report = SpinonRunner.pollS04Readback(renderer) ?? "empty S04 readback report"
        if report.hasPrefix("status=1 ") {
            readbackComplete = true
            readbackTimer?.invalidate()
            readbackTimer = nil
            logger.notice("SPINON_S04_READBACK=passed \(report)")
            onStatusChange?("S04 색상 readback 통과 · 42개 sRGB 표본")
            return
        }
        if !report.hasPrefix("status=0 ") {
            readbackTimer?.invalidate()
            readbackTimer = nil
            fail("S04 색상 readback 실패 · \(report)")
            return
        }
        if ProcessInfo.processInfo.systemUptime >= readbackDeadline {
            readbackTimer?.invalidate()
            readbackTimer = nil
            fail("S04 색상 readback 시간 초과 · 5초")
        }
    }

    private func fail(_ message: String) {
        logger.error("SPINON_S04_ERROR=\(message, privacy: .public)")
        onStatusChange?(message)
    }

    private func advanceSurfaceGeneration() -> Bool {
        guard surfaceGeneration < UInt64.max else {
            fail("S04 surface generation 값이 소진됐습니다")
            return false
        }
        surfaceGeneration += 1
        return true
    }

    private func destroyRenderer() {
        guard let renderer else { return }
        self.renderer = nil
        SpinonRunner.destroyR08Wgpu(renderer)
    }

    deinit {
        readbackTimer?.invalidate()
        destroyRenderer()
    }
}
