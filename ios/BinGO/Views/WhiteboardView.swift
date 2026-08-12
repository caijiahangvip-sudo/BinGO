import PencilKit
import SwiftData
import SwiftUI

struct WhiteboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \WhiteboardRecord.updatedAt, order: .reverse) private var records: [WhiteboardRecord]
    @State private var drawing = PKDrawing()
    @State private var toolPickerVisible = true
    @State private var activeRecordID: UUID?
    @State private var hasLoadedDrawing = false

    var body: some View {
        NativePencilCanvas(drawing: $drawing, toolPickerVisible: toolPickerVisible)
            .background(Color.white)
            .navigationTitle("白板")
            .toolbar {
                Button(toolPickerVisible ? "隐藏工具" : "显示工具", systemImage: "pencil.tip.crop.circle") {
                    toolPickerVisible.toggle()
                }
                Button("清空", systemImage: "trash", role: .destructive) { drawing = PKDrawing() }
            }
            .onAppear(perform: loadDrawing)
            .onChange(of: drawing) { _, newDrawing in save(newDrawing) }
    }

    private func loadDrawing() {
        guard !hasLoadedDrawing else { return }
        let record = records.first ?? WhiteboardRecord()
        if records.isEmpty { modelContext.insert(record) }
        activeRecordID = record.id
        if !record.drawingData.isEmpty, let stored = try? PKDrawing(data: record.drawingData) {
            drawing = stored
        }
        hasLoadedDrawing = true
    }

    private func save(_ drawing: PKDrawing) {
        guard hasLoadedDrawing,
              let activeRecordID,
              let record = records.first(where: { $0.id == activeRecordID })
        else { return }
        record.drawingData = drawing.dataRepresentation()
        record.updatedAt = .now
    }
}

struct NativePencilCanvas: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    let toolPickerVisible: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.delegate = context.coordinator
        canvas.drawingPolicy = .anyInput
        canvas.backgroundColor = .white
        canvas.drawing = drawing
        canvas.alwaysBounceVertical = true
        context.coordinator.attach(to: canvas)
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        if canvas.drawing != drawing { canvas.drawing = drawing }
        let picker = context.coordinator.toolPicker
        picker.setVisible(toolPickerVisible, forFirstResponder: canvas)
        if toolPickerVisible { canvas.becomeFirstResponder() }
    }

    static func dismantleUIView(_ canvas: PKCanvasView, coordinator: Coordinator) {
        coordinator.toolPicker.setVisible(false, forFirstResponder: canvas)
        coordinator.toolPicker.removeObserver(canvas)
        canvas.resignFirstResponder()
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: NativePencilCanvas
        let toolPicker = PKToolPicker()

        init(_ parent: NativePencilCanvas) { self.parent = parent }

        func attach(to canvas: PKCanvasView) {
            toolPicker.addObserver(canvas)
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { parent.drawing = canvasView.drawing }
    }
}
