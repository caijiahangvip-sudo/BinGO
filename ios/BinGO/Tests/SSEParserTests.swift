import XCTest
@testable import BinGO

final class SSEParserTests: XCTestCase {
    func testParsesEventWithMultipleDataLines() {
        let event = SSEParser.parse(block: "event: message\nid: 42\ndata: hello\ndata: world\n")
        XCTAssertEqual(event, ServerSentEvent(event: "message", id: "42", data: "hello\nworld"))
    }

    func testIgnoresComments() {
        let event = SSEParser.parse(block: ": keepalive\ndata: ready\n")
        XCTAssertEqual(event?.data, "ready")
    }

    func testEmptyBlockReturnsNil() {
        XCTAssertNil(SSEParser.parse(block: "\n"))
    }
}
