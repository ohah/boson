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
        return true
    }
}
