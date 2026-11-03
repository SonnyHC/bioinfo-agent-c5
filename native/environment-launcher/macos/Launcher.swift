import AppKit
import CoreServices
import Foundation

private let bundleID = "org.bioinfobuddy.environment-launcher"
private let appName = "BioInfoBuddy Launcher.app"

func installationID(_ raw: String) -> String? {
    // Exact matching deliberately excludes URL normalization and encoded arguments.
    return allowedInstallationIDs.first { raw == "bioinfobuddy://install/" + $0 }
}

func commandURL(in bundle: URL, id: String) -> URL {
    bundle.appendingPathComponent("Contents/Resources/actions/\(id).command")
}

if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--validate-url" {
    guard let id = installationID(CommandLine.arguments[2]) else {
        FileHandle.standardError.write(Data("Invalid installation URL\n".utf8)); exit(2)
    }
    print(id)
    exit(0)
}
if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--plan" {
    guard let id = installationID(CommandLine.arguments[2]) else { exit(2) }
    let plan = ["executable": "/usr/bin/open", "arguments": ["-b", "com.apple.Terminal", commandURL(in: Bundle.main.bundleURL, id: id).path]] as [String: Any]
    let data = try JSONSerialization.data(withJSONObject: plan, options: [.sortedKeys])
    FileHandle.standardOutput.write(data); print("")
    exit(0)
}
if CommandLine.arguments.dropFirst().contains(where: { $0.hasPrefix("--") }) { exit(2) }

final class LauncherDelegate: NSObject, NSApplicationDelegate {
    private var handledURL = false

    private func message(_ title: String, _ detail: String) {
        NSApplication.shared.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    private func installedBundle() throws -> URL {
        let fm = FileManager.default
        let directory = fm.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
        let destination = directory.appendingPathComponent(appName, isDirectory: true)
        let source = Bundle.main.bundleURL.resolvingSymlinksInPath()
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        if source != destination.resolvingSymlinksInPath() {
            if fm.fileExists(atPath: destination.path), Bundle(url: destination)?.bundleIdentifier != bundleID {
                throw NSError(domain: bundleID, code: 1, userInfo: [NSLocalizedDescriptionKey: "请将 Applications 中同名的其他应用移走后重新打开。"])
            }
            let staged = directory.appendingPathComponent(".BioInfoBuddy-\(UUID().uuidString).app")
            defer { try? fm.removeItem(at: staged) }
            try fm.copyItem(at: source, to: staged)
            if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
            try fm.moveItem(at: staged, to: destination)
        }
        let registered = LSRegisterURL(destination as CFURL, true)
        guard registered == noErr else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(registered), userInfo: [NSLocalizedDescriptionKey: "注册启动器失败（\(registered)）。请重新打开应用。"])
        }
        let selected = LSSetDefaultHandlerForURLScheme("bioinfobuddy" as CFString, bundleID as CFString)
        guard selected == noErr else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(selected), userInfo: [NSLocalizedDescriptionKey: "设置网页安装入口失败（\(selected)）。请重新打开应用。"])
        }
        return destination
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Launch Services may deliver the protocol event immediately after launch.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [self] in
            guard !handledURL else { return }
            do {
                _ = try installedBundle()
                message("启动器已就绪", "回到网页，点击“在终端安装”。")
            } catch { message("设置未完成", error.localizedDescription) }
            NSApplication.shared.terminate(nil)
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        handledURL = true
        guard urls.count == 1, let raw = urls.first?.absoluteString, let id = installationID(raw) else {
            message("安装链接无效", "请从 BioInfoBuddy 的环境配置页面选择环境。")
            application.terminate(nil)
            return
        }
        do {
            let bundle = try installedBundle()
            let command = commandURL(in: bundle, id: id)
            guard FileManager.default.isExecutableFile(atPath: command.path) else {
                throw NSError(domain: bundleID, code: 2, userInfo: [NSLocalizedDescriptionKey: "安装文件缺失，请重新安装启动器。"])
            }
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            task.arguments = ["-b", "com.apple.Terminal", command.path]
            try task.run()
            task.waitUntilExit()
            guard task.terminationStatus == 0 else {
                throw NSError(domain: bundleID, code: 3, userInfo: [NSLocalizedDescriptionKey: "终端打开失败，请重试。"])
            }
        } catch { message("安装未启动", error.localizedDescription) }
        application.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = LauncherDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
