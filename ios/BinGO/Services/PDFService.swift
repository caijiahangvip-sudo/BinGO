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
}
