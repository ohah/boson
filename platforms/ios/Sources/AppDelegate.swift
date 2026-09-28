import UIKit
import OSLog

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private let logger = Logger(subsystem: "dev.spinon.bootstrap", category: "runtime")

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        if ProcessInfo.processInfo.arguments.contains("--spinon-r08") {
            let window = UIWindow(frame: UIScreen.main.bounds)
            window.rootViewController = R08GpuDemoViewController()
            window.makeKeyAndVisible()
            self.window = window
            return true
        }

        let sourceURL = Bundle.main.url(forResource: "app", withExtension: "js")
        do {
            guard let sourceURL else {
                logger.error("SPINON_BOOTSTRAP_ASSET_ERROR=app.js missing")
                return true
            }
            let source = try String(contentsOf: sourceURL, encoding: .utf8)
            let result = SpinonRunner.runSource(source) ?? "empty bootstrap result"
            logger.notice("SPINON_BOOTSTRAP_RESULT=\(result, privacy: .public)")
        } catch {
            logger.error("SPINON_BOOTSTRAP_ASSET_ERROR=\(String(describing: error), privacy: .public)")
        }

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = UIViewController()
        window.backgroundColor = .white
        window.makeKeyAndVisible()
        self.window = window

        if ProcessInfo.processInfo.arguments.contains("--spinon-r10") {
            let screen = UIScreen.main
            let report = SpinonRunner.runTaffyR10(
                withWidth: Float(window.bounds.width),
                height: Float(window.bounds.height),
                scale: Float(screen.scale)
            ) ?? "empty R10 report"
            logger.notice("SPINON_TAFFY_R10_RESULT=\(report, privacy: .public)")

            let reportView = UITextView()
            reportView.translatesAutoresizingMaskIntoConstraints = false
            reportView.backgroundColor = UIColor(red: 0.055, green: 0.075, blue: 0.12, alpha: 1)
            reportView.textColor = UIColor(red: 0.90, green: 0.93, blue: 0.98, alpha: 1)
            reportView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
            reportView.textContainerInset = UIEdgeInsets(top: 24, left: 18, bottom: 24, right: 18)
            reportView.isEditable = false
            reportView.text = "SPINON · R10 TAFFY 실험\n\niOS 시뮬레이터 · 개발 전용\n\n\(formatR10Report(report))"
            if let rootView = window.rootViewController?.view {
                rootView.addSubview(reportView)
                NSLayoutConstraint.activate([
                    reportView.topAnchor.constraint(equalTo: rootView.safeAreaLayoutGuide.topAnchor),
                    reportView.leadingAnchor.constraint(equalTo: rootView.leadingAnchor),
                    reportView.trailingAnchor.constraint(equalTo: rootView.trailingAnchor),
                    reportView.bottomAnchor.constraint(equalTo: rootView.bottomAnchor)
                ])
            }
        }
        return true
    }

    private func formatR10Report(_ report: String) -> String {
        report
            .replacingOccurrences(of: " nodes=", with: "\nnodes=")
            .replacingOccurrences(of: " text-id=", with: "\ntext-id=")
            .replacingOccurrences(of: " measured=", with: "\nmeasured=")
            .replacingOccurrences(of: " rtl=", with: "\nrtl=")
            .replacingOccurrences(of: " ltr-button-offset=", with: "\nltr-button-offset=")
            .replacingOccurrences(of: " rtl-text-offset=", with: "\nrtl-text-offset=")
            .replacingOccurrences(of: " update=equivalent", with: "\nupdate=equivalent")
            .replacingOccurrences(of: " rounding=[", with: "\nrounding:\n  ")
            .replacingOccurrences(of: ",physical-pixel=", with: "\n  physical-pixel=")
            .replacingOccurrences(of: ",float=", with: "\n  float=")
            .replacingOccurrences(of: "] update-us-p50=", with: "\nupdate-us: p50=")
            .replacingOccurrences(of: " update-us-p95=", with: " p95=")
            .replacingOccurrences(of: " rebuild-us-p50=", with: "\nrebuild-us: p50=")
            .replacingOccurrences(of: " rebuild-us-p95=", with: " p95=")
            .replacingOccurrences(of: " iterations=", with: "\niterations=")
    }
}
