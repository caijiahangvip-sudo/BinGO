import XCTest
@testable import BinGO

final class APIContractTests: XCTestCase {
    func testHealthResponseUsesFlattenedSuccessShape() throws {
        let data = Data(#"{"success":true,"status":"ok","version":"1.2.3","desktop":false,"startedAt":"2026-08-05T00:00:00.000Z","capabilities":{"webSearch":true,"tts":false,"vector":true}}"#.utf8)
        let response = try JSONDecoder().decode(HealthResponse.self, from: data)
        XCTAssertTrue(response.success)
        XCTAssertEqual(response.version, "1.2.3")
        XCTAssertEqual(response.capabilities?.webSearch, true)
    }

    func testClassroomJobResponseDecodesResult() throws {
        let data = Data(#"{"success":true,"jobId":"abc","status":"succeeded","step":"persisting","progress":100,"message":"done","pollIntervalMs":5000,"scenesGenerated":3,"totalScenes":3,"result":{"classroomId":"room-1","url":"/classroom/room-1","scenesCount":3},"done":true}"#.utf8)
        let response = try JSONDecoder().decode(GenerationJobResponse.self, from: data)
        XCTAssertTrue(response.done)
        XCTAssertEqual(response.result?.classroomId, "room-1")
        XCTAssertEqual(response.result?.scenesCount, 3)
    }

    func testUnknownSceneContentRemainsRoundTrippable() throws {
        let data = Data(#"{"id":"scene-1","stageId":"stage-1","type":"slide","title":"第一页","order":0,"content":{"type":"slide","canvas":{"elements":[{"id":"text-1","type":"text","content":"你好"}]}}}"#.utf8)
        let scene = try JSONDecoder().decode(SceneDTO.self, from: data)
        let encoded = try JSONEncoder().encode(scene)
        let decoded = try JSONDecoder().decode(SceneDTO.self, from: encoded)
        XCTAssertEqual(decoded, scene)
    }
}
