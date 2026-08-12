import PDFKit
import UIKit

struct ParsedPDF: Sendable {
    let pageCount: Int
    let text: String
    let coverJPEG: Data?
}

actor PDFService {
    func parse(url: URL, maximumPages: Int? = nil) throws -> ParsedPDF {
        guard let document = PDFDocument(url: url) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let count = maximumPages.map { min($0, document.pageCount) } ?? document.pageCount
        var sections: [String] = []
        for index in 0..<count {
            let text = document.page(at: index)?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            sections.append("## 第 \(index + 1) 页\n\n\(text)")
        }
        let cover = document.page(at: 0)?.thumbnail(of: CGSize(width: 900, height: 1200), for: .mediaBox)
        return ParsedPDF(
            pageCount: document.pageCount,
            text: sections.joined(separator: "\n\n"),
            coverJPEG: cover?.jpegData(compressionQuality: 0.82)
        )
    }

    /// Renders the first pages of a PDF as JPEG data URLs. Used when the
    /// text layer is unusable (scanned books) so the server can hand the
    /// cover and table-of-contents pages to a vision model instead.
    func renderPageImages(url: URL, maxPages: Int = 8) -> [String] {
        guard let document = PDFDocument(url: url) else { return [] }
        let count = min(maxPages, document.pageCount)
        var images: [String] = []
        for index in 0..<count {
            guard let page = document.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let scale = 1240 / max(bounds.width, 1)
            let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
            let image = page.thumbnail(of: size, for: .mediaBox)
            guard let jpeg = image.jpegData(compressionQuality: 0.7) else { continue }
            images.append("data:image/jpeg;base64,\(jpeg.base64EncodedString())")
        }
        return images
    }
}

