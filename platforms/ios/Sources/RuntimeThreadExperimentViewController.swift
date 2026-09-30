import UIKit
import OSLog

final class RuntimeThreadExperimentViewController: UIViewController {
    private let automaticallyRun: Bool
    private let runPriorityProbe: Bool
    private let logger = Logger(subsystem: "dev.spinon.bootstrap", category: "r06")
    private let runtimeCalls = DispatchQueue(
        label: "dev.spinon.r06.runtime-calls",
        qos: .userInitiated,
        attributes: .concurrent
    )
    private let runtimeCallGroup = DispatchGroup()
    private let runtimeCallSlots = DispatchSemaphore(value: 64)
    private let runtimeControl = DispatchQueue(label: "dev.spinon.r06.runtime-control", qos: .userInitiated)
    private let bootstrapSource: String

    private var session: UInt64 = 0
    private var heartbeatTimer: Timer?
    private var heartbeatCount = 0
    private var eventCount = 0
    private var scenarioRunning = false
    private var scenarioHeartbeatStart = 0
    private var scenarioEvalReport: String?
    private var scenarioDispatchReport: String?
    private var scenarioCancelStatus: Int32?
    private var isClosing = false

    private let statusLabel = UILabel()
    private let reportView = UITextView()
    private let eventButton = UIButton(type: .system)
    private let longEvalButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let recreateButton = UIButton(type: .system)

    init(automaticallyRun: Bool, runPriorityProbe: Bool = false) {
        self.automaticallyRun = automaticallyRun
        self.runPriorityProbe = runPriorityProbe
        if let sourceURL = Bundle.main.url(forResource: "app", withExtension: "js"),
           let source = try? String(contentsOf: sourceURL, encoding: .utf8) {
            bootstrapSource = source
        } else {
            bootstrapSource = "spinon.onEvent((nodeId) => spinon.setText(`이벤트:${nodeId}`));"
        }
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("코더 초기화는 사용하지 않습니다")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureView()
        if runPriorityProbe {
            setButtons(enabled: false)
            setStatus("실제 V8 우선순위 선택 검증 중…")
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let report = SpinonRunner.runRuntimePriorityProbe() ?? "우선순위 검증 응답 없음"
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.appendReport(report)
                    self.setStatus(report.contains("status=0 priority_probe=PASS")
                        ? "실제 V8 우선순위 검증 통과"
                        : "실제 V8 우선순위 검증 실패")
                }
            }
            return
        }
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self else { return }
            heartbeatCount += 1
            if scenarioRunning && heartbeatCount % 10 == 0 {
                setStatus("준비됨 · 메인 UI heartbeat \(heartbeatCount) · JavaScript 대기 중")
            }
        }
        createInitialSession()
    }

    deinit {
        heartbeatTimer?.invalidate()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard isMovingFromParent || isBeingDismissed || navigationController?.isBeingDismissed == true else {
            return
        }
        closeRuntimeSession()
    }

    private func configureView() {
        view.backgroundColor = UIColor(red: 0.055, green: 0.075, blue: 0.12, alpha: 1)

        let title = UILabel()
        title.text = runPriorityProbe
            ? "SPINON · iOS R06 우선순위 검증"
            : "SPINON · iOS R06 실행 스레드 실험"
        title.font = .systemFont(ofSize: 20, weight: .bold)
        title.textColor = UIColor(red: 0.90, green: 0.93, blue: 0.98, alpha: 1)
        title.numberOfLines = 0

        let description = UILabel()
        description.text = runPriorityProbe
            ? "개발 전용 · 실제 V8에서 세 우선순위 선택과 동일 등급 FIFO를 확인합니다"
            : "개발 전용 · JS 실행은 백그라운드 V8 소유 스레드 · UI heartbeat와 큐 대기·취소를 기록합니다"
        description.font = .systemFont(ofSize: 13)
        description.textColor = UIColor(red: 0.66, green: 0.72, blue: 0.81, alpha: 1)
        description.numberOfLines = 0

        statusLabel.text = "V8 세션 초기화 중…"
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.textColor = UIColor(red: 0.38, green: 0.73, blue: 1, alpha: 1)
        statusLabel.numberOfLines = 0

        configureButton(eventButton, title: "터치 이벤트 보내기", action: #selector(sendEvent))
        configureButton(longEvalButton, title: "긴 JavaScript 실행 시작", action: #selector(startLongEvaluation))
        configureButton(cancelButton, title: "실행 취소", action: #selector(cancelExecution))
        configureButton(recreateButton, title: "세션 종료 후 재생성", action: #selector(recreateSession))

        reportView.backgroundColor = UIColor(red: 0.035, green: 0.047, blue: 0.075, alpha: 1)
        reportView.textColor = UIColor(red: 0.86, green: 0.89, blue: 0.94, alpha: 1)
        reportView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        reportView.isEditable = false
        reportView.accessibilityIdentifier = "r06-report"

        let stack = UIStackView(arrangedSubviews: [
            title, description, statusLabel, eventButton, longEvalButton, cancelButton,
            recreateButton, reportView
        ])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            reportView.heightAnchor.constraint(greaterThanOrEqualToConstant: 120)
        ])
        reportView.setContentHuggingPriority(.defaultLow, for: .vertical)
        reportView.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        setButtons(enabled: false)
    }

    private func configureButton(_ button: UIButton, title: String, action: Selector) {
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.baseBackgroundColor = UIColor(red: 0.10, green: 0.31, blue: 0.58, alpha: 1)
        configuration.baseForegroundColor = .white
        configuration.cornerStyle = .medium
        button.configuration = configuration
        button.contentHorizontalAlignment = .leading
        button.accessibilityIdentifier = title
        button.addTarget(self, action: action, for: .touchUpInside)
    }

    private func createInitialSession() {
        enqueueRuntimeCall(label: "초기 세션 생성") { [weak self] in
            guard let self else { return }
            let handle = SpinonRunner.createRuntimeSession()
            guard handle != 0 else {
                DispatchQueue.main.async {
                    guard !self.isClosing else { return }
                    self.appendReport("세션 생성 실패 · 시뮬레이터 로그의 생성 오류를 확인하세요")
                    self.setStatus("V8 세션 생성 실패")
                }
                return
            }
            let report = SpinonRunner.evalRuntimeSession(handle, source: bootstrapSource) ?? "응답 없음"
            DispatchQueue.main.async {
                guard !self.isClosing else {
                    self.enqueueSessionFree(handle)
                    return
                }
                self.session = handle
                self.appendReport("초기 JavaScript · \(report)")
                self.setStatus("준비됨 · 백그라운드 V8 세션")
                self.setButtons(enabled: true)
                if self.automaticallyRun {
                    self.appendReport("자동 검증 시작 · UI 타깃 액션을 보낸 뒤 JS 취소")
                    self.startLongEvaluation()
                }
            }
        }
    }

    @objc private func sendEvent() {
        guard session != 0, !isClosing else { return }
        eventCount += 1
        let eventNumber = eventCount
        setStatus("UIKit 이벤트 \(eventNumber) · 메인 화면 입력 처리됨")
        appendReport("UIKit 타깃 액션 \(eventNumber) 제출")
        let handle = session
        let accepted = enqueueRuntimeCall(label: "이벤트 \(eventNumber)") { [weak self] in
            let report = SpinonRunner.dispatchRuntimeSession(handle, nodeID: Int32(eventNumber)) ?? "응답 없음"
            DispatchQueue.main.async {
                guard let self else { return }
                self.appendReport("이벤트 \(eventNumber) · \(report)")
                if self.scenarioRunning && self.scenarioDispatchReport == nil {
                    self.scenarioDispatchReport = report
                    self.finishScenarioIfReady()
                }
            }
        }
        if !accepted && scenarioRunning {
            scenarioDispatchReport = "status=-5 플랫폼 실행 대기열 포화"
            finishScenarioIfReady()
        }
    }

    @objc private func startLongEvaluation() {
        guard session != 0, !scenarioRunning, !isClosing else { return }
        scenarioRunning = true
        scenarioHeartbeatStart = heartbeatCount
        scenarioEvalReport = nil
        scenarioDispatchReport = nil
        scenarioCancelStatus = nil
        longEvalButton.isEnabled = false
        cancelButton.isEnabled = true
        recreateButton.isEnabled = false
        setStatus("긴 JavaScript 실행 중 · 메인 화면 heartbeat가 계속 증가해야 합니다")
        appendReport("무한 JavaScript 평가 제출 · UI 메인 스레드는 대기하지 않음")

        let handle = session
        let accepted = enqueueRuntimeCall(label: "긴 JavaScript 평가") { [weak self] in
            let report = SpinonRunner.evalRuntimeSession(
                handle,
                source: "while (true) { /* iOS 시뮬레이터 취소 검증 */ }"
            ) ?? "응답 없음"
            DispatchQueue.main.async {
                guard let self else { return }
                self.scenarioEvalReport = report
                self.appendReport("긴 평가 반환 · \(report)")
                self.finishScenarioIfReady()
            }
        }
        if !accepted {
            scenarioEvalReport = "status=-5 플랫폼 실행 대기열 포화"
            scenarioDispatchReport = "status=-5 플랫폼 실행 대기열 포화"
            scenarioCancelStatus = -5
            finishScenarioIfReady()
        }

        if automaticallyRun {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) { [weak self] in
                guard let self, self.scenarioRunning else { return }
                self.eventButton.sendActions(for: .touchUpInside)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) { [weak self] in
                guard let self, self.scenarioRunning else { return }
                let handle = self.session
                self.runtimeControl.async {
                    let status = SpinonRunner.cancelRuntimeSession(handle)
                    DispatchQueue.main.async {
                        self.scenarioCancelStatus = status
                        self.appendReport("취소 요청 · status=\(status)")
                        self.finishScenarioIfReady()
                    }
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            guard let self, self.scenarioRunning else { return }
            self.appendReport("시간 초과 · 안전을 위해 V8 취소를 요청합니다")
            let handle = self.session
            self.runtimeControl.async {
                let status = SpinonRunner.cancelRuntimeSession(handle)
                DispatchQueue.main.async {
                    guard self.scenarioRunning else { return }
                    if self.scenarioCancelStatus == nil || status == 0 {
                        self.scenarioCancelStatus = status
                    }
                    self.appendReport("시간 초과 안전 취소 · status=\(status)")
                    self.setStatus("R06 검증 시간 초과 · V8 응답을 기다립니다")
                    self.finishScenarioIfReady()
                }
            }
        }
    }

    @objc private func cancelExecution() {
        guard session != 0, !isClosing else { return }
        let handle = session
        runtimeControl.async { [weak self] in
            let status = SpinonRunner.cancelRuntimeSession(handle)
            DispatchQueue.main.async {
                guard let self else { return }
                self.appendReport("취소 요청 · status=\(status)")
                if self.scenarioRunning {
                    if self.scenarioCancelStatus == nil || status == 0 {
                        self.scenarioCancelStatus = status
                    }
                    self.finishScenarioIfReady()
                }
            }
        }
    }

    private func finishScenarioIfReady() {
        guard scenarioRunning,
              let evalReport = scenarioEvalReport,
              let dispatchReport = scenarioDispatchReport,
              let cancelStatus = scenarioCancelStatus else { return }

        let heartbeatDelta = heartbeatCount - scenarioHeartbeatStart
        let evalOwner = field("owner_tid", in: evalReport)
        let dispatchOwner = field("owner_tid", in: dispatchReport)
        let callbackOwner = field("callback_tid", in: dispatchReport)
        let checks = [
            ("취소된 평가", evalReport.contains("status=-8")),
            ("대기 이벤트 처리", dispatchReport.contains("status=0")),
            ("실행 중 취소 요청", cancelStatus == 0),
            ("메인 UI heartbeat", heartbeatDelta >= 5),
            ("Isolate 소유 스레드", evalOwner != nil && evalOwner == dispatchOwner),
            ("JS 콜백 소유 스레드", dispatchOwner != nil && dispatchOwner == callbackOwner)
        ]
        let passed = checks.allSatisfy(\.1)
        for (name, result) in checks {
            appendReport("\(result ? "통과" : "실패") · \(name)")
        }
        appendReport("heartbeat 증가량=\(heartbeatDelta) · owner_tid=\(evalOwner ?? "없음")")
        scenarioRunning = false
        longEvalButton.isEnabled = true
        cancelButton.isEnabled = false
        recreateButton.isEnabled = true
        setStatus(passed ? "R06 iOS 시뮬레이터 검증 통과" : "R06 iOS 시뮬레이터 검증 실패")

        if automaticallyRun && passed {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                self?.recreateSession()
            }
        }
    }

    @objc private func recreateSession() {
        guard session != 0, !scenarioRunning, !isClosing else { return }
        let oldHandle = session
        session = 0
        setButtons(enabled: false)
        setStatus("기존 세션 종료 후 새 세션 생성 중…")
        let pendingCalls = runtimeCallGroup
        let lifecycleQueue = runtimeControl
        let source = bootstrapSource
        pendingCalls.notify(queue: lifecycleQueue) { [weak self] in
            SpinonRunner.freeRuntimeSession(oldHandle)
            let newHandle = SpinonRunner.createRuntimeSession()
            guard newHandle != 0 else {
                DispatchQueue.main.async {
                    self?.appendReport("재생성 실패")
                    self?.setStatus("새 V8 세션 생성 실패")
                }
                return
            }
            let bootstrap = SpinonRunner.evalRuntimeSession(newHandle, source: source) ?? "응답 없음"
            let dispatch = SpinonRunner.dispatchRuntimeSession(newHandle, nodeID: 99) ?? "응답 없음"
            DispatchQueue.main.async {
                guard let self, !self.isClosing else {
                    lifecycleQueue.async {
                        SpinonRunner.freeRuntimeSession(newHandle)
                    }
                    return
                }
                self.session = newHandle
                let passed = bootstrap.contains("status=0") && dispatch.contains("status=0")
                self.appendReport("기존 세션 해제 완료")
                self.appendReport("새 세션 초기화 · \(bootstrap)")
                self.appendReport("새 세션 이벤트 · \(dispatch)")
                self.appendReport("\(passed ? "통과" : "실패") · 세션 종료·재생성 후 호출")
                self.setStatus(passed ? "준비됨 · 재생성 검증 완료" : "세션 재생성 검증 실패")
                self.setButtons(enabled: true)
                if self.automaticallyRun {
                    self.appendReport("자동 검증 전체 완료")
                }
            }
        }
    }

    private func setButtons(enabled: Bool) {
        eventButton.isEnabled = enabled
        longEvalButton.isEnabled = enabled && !scenarioRunning
        cancelButton.isEnabled = enabled && scenarioRunning
        recreateButton.isEnabled = enabled && !scenarioRunning
    }

    @discardableResult
    private func enqueueRuntimeCall(label: String, _ operation: @escaping () -> Void) -> Bool {
        guard !isClosing else { return false }
        guard runtimeCallSlots.wait(timeout: .now()) == .success else {
            appendReport("거부 · 플랫폼 실행 대기열 포화 · \(label)")
            return false
        }
        let slots = runtimeCallSlots
        runtimeCallGroup.enter()
        runtimeCalls.async {
            defer { slots.signal() }
            defer { self.runtimeCallGroup.leave() }
            operation()
        }
        return true
    }

    private func enqueueSessionFree(_ handle: UInt64) {
        guard handle != 0 else { return }
        runtimeCalls.async {
            SpinonRunner.freeRuntimeSession(handle)
        }
    }

    private func closeRuntimeSession() {
        guard !isClosing else { return }
        isClosing = true
        scenarioRunning = false
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        let handle = session
        session = 0
        setButtons(enabled: false)
        guard handle != 0 else { return }
        let pendingCalls = runtimeCallGroup
        let lifecycleQueue = runtimeControl
        lifecycleQueue.async {
            _ = SpinonRunner.cancelRuntimeSession(handle)
            pendingCalls.notify(queue: lifecycleQueue) {
                SpinonRunner.freeRuntimeSession(handle)
            }
        }
    }

    private func setStatus(_ text: String) {
        statusLabel.text = text
        statusLabel.accessibilityValue = text
    }

    private func appendReport(_ text: String) {
        logger.notice("SPINON_R06_IOS \(text, privacy: .public)")
        reportView.text.append("\(text)\n\n")
        let end = NSRange(location: max(reportView.text.utf16.count - 1, 0), length: 1)
        reportView.scrollRangeToVisible(end)
    }

    private func field(_ key: String, in report: String) -> String? {
        report.split(separator: " ").first(where: { $0.hasPrefix("\(key)=") })
            .map { String($0.dropFirst(key.count + 1)) }
    }
}
