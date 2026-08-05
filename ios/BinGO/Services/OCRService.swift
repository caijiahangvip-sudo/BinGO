import CoreGraphics
import UIKit
import Vision

actor OCRService {
    func recognize(image: UIImage) async throws -> OCRResult {
        guard let cgImage = image.cgImage else { throw CocoaError(.fileReadCorruptFile) }
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<OCRResult, Error>) in
            let request = VNRecognizeTextRequest { request, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
                let values = observations.compactMap { observation -> OCRObservation? in
                    guard let candidate = observation.topCandidates(1).first else { return nil }
                    return OCRObservation(
                        text: candidate.string,
                        confidence: candidate.confidence,
                        boundingBox: observation.boundingBox
                    )
                }
                continuation.resume(returning: OCRResult(
                    text: values.map(\.text).joined(separator: "\n"),
                    observations: values
                ))
            }
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["zh-Hans", "en-US"]
            request.usesLanguageCorrection = true
            request.automaticallyDetectsLanguage = true
            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
