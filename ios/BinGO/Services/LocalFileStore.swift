import Foundation

actor LocalFileStore {
    private let fileManager = FileManager.default

    func importFile(from source: URL, folder: String) throws -> URL {
        let accessed = source.startAccessingSecurityScopedResource()
        defer { if accessed { source.stopAccessingSecurityScopedResource() } }
        let root = try applicationSupportDirectory().appending(path: folder, directoryHint: .isDirectory)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let destination = uniqueDestination(for: source.lastPathComponent, in: root)
        try fileManager.copyItem(at: source, to: destination)
        return destination
    }

    func deleteFile(atPath path: String) throws {
        try FileManager.default.removeItem(atPath: path)
    }

    private func applicationSupportDirectory() throws -> URL {
        try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appending(path: "BinGO", directoryHint: .isDirectory)
    }

    private func uniqueDestination(for fileName: String, in directory: URL) -> URL {
        var destination = directory.appending(path: fileName)
        var counter = 2
        while fileManager.fileExists(atPath: destination.path()) {
            let extensionName = destination.pathExtension
            let base = destination.deletingPathExtension().lastPathComponent
            destination = directory.appending(path: "\(base)-\(counter)")
            if !extensionName.isEmpty { destination.appendPathExtension(extensionName) }
            counter += 1
        }
        return destination
    }
}
