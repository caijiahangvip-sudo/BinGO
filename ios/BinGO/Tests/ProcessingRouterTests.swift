import XCTest
@testable import BinGO

final class ProcessingRouterTests: XCTestCase {
    func testLanguageModelAlwaysUsesCloudWhenAvailable() {
        let decision = ProcessingRouter.decision(
            for: .languageModel,
            preferences: ProcessingPreferences(),
            profile: DevicePerformanceProfile(memoryGB: 8, lowPowerMode: false, thermalState: .nominal),
            cloudAvailable: true
        )
        XCTAssertEqual(decision.mode, .cloud)
    }

    func testAutomaticOCRUsesLocalOnHealthyDevice() {
        let decision = ProcessingRouter.decision(
            for: .ocr,
            preferences: ProcessingPreferences(),
            profile: DevicePerformanceProfile(memoryGB: 8, lowPowerMode: false, thermalState: .nominal),
            cloudAvailable: true
        )
        XCTAssertEqual(decision.mode, .local)
    }

    func testAutomaticOCRUsesCloudInLowPowerMode() {
        let decision = ProcessingRouter.decision(
            for: .ocr,
            preferences: ProcessingPreferences(),
            profile: DevicePerformanceProfile(memoryGB: 8, lowPowerMode: true, thermalState: .nominal),
            cloudAvailable: true
        )
        XCTAssertEqual(decision.mode, .cloud)
    }

    func testCloudPreferenceFallsBackLocallyWhenOffline() {
        var preferences = ProcessingPreferences()
        preferences.set(.cloud, for: .speechRecognition)
        let decision = ProcessingRouter.decision(
            for: .speechRecognition,
            preferences: preferences,
            profile: DevicePerformanceProfile(memoryGB: 8, lowPowerMode: false, thermalState: .nominal),
            cloudAvailable: false
        )
        XCTAssertEqual(decision.mode, .local)
    }
}
