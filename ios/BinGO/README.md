# BinGO Native iPad

This is the pure SwiftUI/UIKit BinGO client. It does not embed React, Next.js, Tauri, WKWebView, or any remote web page.

## Native stack

- SwiftUI navigation and screens
- SwiftData local records
- PencilKit whiteboard
- PDFKit document reading and extraction
- Vision OCR
- Speech recognition
- AVFoundation speech synthesis
- URLSession JSON, multipart upload, and SSE streaming

## Generate the Xcode project

On the Mac:

```bash
cd ios/BinGO
chmod +x bootstrap-mac.sh
./bootstrap-mac.sh
open BinGO.xcodeproj
```

In Xcode:

1. Select the `BinGO` target.
2. Set Signing Team to the personal Apple ID team.
3. Keep bundle identifier `app.bingo.ipad`, or change it if the personal team requires a unique identifier.
4. Select the connected iPad and Run.

## API configuration

Open Settings inside the app and configure only the API origin and token. The app never asks for or loads a BinGO web page URL.

For local development on the same Wi-Fi:

```text
API URL: http://192.168.0.147:4000
```

For distribution, use a stable HTTPS API origin.

## Validation

```bash
chmod +x validate-native-ios.sh
./validate-native-ios.sh
```

The script performs static native checks everywhere. On macOS it also validates the property lists, generates the Xcode project, builds for the iPad simulator, and runs tests when an iPad simulator is installed.

## Implemented native flows

- Classroom generation job polling, classroom download, and SwiftData persistence
- Native classroom scene/action presentation and AI SSE chat
- Persistent PencilKit whiteboard
- Local PDF import, PDFKit reading, and Vision OCR
- Speech recognition and local speech synthesis
- Homework image OCR, upload, solve-job polling, cancellation, and local result storage
- Book-plan generation from an imported PDF and native lesson-plan display

The source tree contains no web view or remote page navigation. The Mac build is still required to validate Apple SDK availability, signing, and behavior on the physical iPad.
