import XCTest
@testable import BinGO

final class APIConfigurationTests: XCTestCase {
    func testNormalizesURLAndToken() {
        let value = APIConfiguration(baseURLString: " https://api.example.com/// ", token: " secret ").normalized()
        XCTAssertEqual(value.baseURLString, "https://api.example.com")
        XCTAssertEqual(value.token, "secret")
    }

    func testRejectsMissingURLAtClientBoundary() async {
        let client = APIClient(configuration: APIConfiguration(baseURLString: "", token: ""))
        do {
            let _: HealthResponse = try await client.get("/api/health")
            XCTFail("Expected missing URL")
        } catch let error as APIError {
            XCTAssertEqual(error, .missingBaseURL)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
