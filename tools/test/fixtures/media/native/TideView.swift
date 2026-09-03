// The tide board as a SwiftUI view: the water drawn rather than assembled, the
// reading dragged, the turn animated in phases. Fixture for the native vocabulary.

import SwiftUI

struct TideView: View {
    @Namespace private var board
    @State private var expanded = false
    @State private var drag: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let readings: [Reading]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            wide
            stacked
        }
        .background(.ultraThinMaterial)
        .sensoryFeedback(.impact(weight: .light), trigger: expanded)
    }

    private var wide: some View {
        HStack(alignment: .bottom, spacing: 24) {
            staff
            readout
        }
    }

    private var stacked: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 16) {
                staff.frame(height: proxy.size.height * 0.6)
                readout
            }
        }
    }

    // The staff is drawn, not composed from stock controls.
    private var staff: some View {
        Canvas { context, size in
            let level = 0.28 + drag / max(size.height, 1)
            var path = Path()
            path.addRect(CGRect(x: 0, y: size.height * (1 - level),
                                width: size.width, height: size.height * level))
            context.fill(path, with: .linearGradient(
                Gradient(colors: [.navy, .navy.opacity(0.82)]),
                startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))

            for metre in 0...6 {
                var mark = Path()
                let y = size.height * (1 - CGFloat(metre) / 6)
                mark.move(to: CGPoint(x: 0, y: y))
                mark.addLine(to: CGPoint(x: size.width * 0.6, y: y))
                context.stroke(mark, with: .color(.ink), lineWidth: 1)
            }
        }
        .matchedGeometryEffect(id: "staff", in: board)
        .visualEffect { content, proxy in
            content.colorEffect(ShaderLibrary.grain(.float(proxy.size.width)))
        }
        .gesture(
            DragGesture()
                .onChanged { drag = $0.translation.height }
                .onEnded { _ in withAnimation(.spring(response: 0.42, dampingFraction: 0.78)) { drag = 0 } }
        )
        .shadow(radius: 12, y: 4)
    }

    private var readout: some View {
        VStack(alignment: .leading, spacing: 12) {
            TimelineView(.periodic(from: .now, by: 60)) { timeline in
                Text(state(at: timeline.date))
                    .font(.largeTitle.weight(.semibold))
                    .phaseAnimator([false, true]) { view, phase in
                        view.opacity(phase ? 1 : 0.7)
                    }
            }
            ForEach(readings) { reading in
                HStack {
                    Text(reading.time).monospacedDigit()
                    Spacer()
                    Text(reading.label).foregroundStyle(.secondary)
                }
            }
        }
        .tint(.navy)
    }

    private func state(at date: Date) -> String { "Coming in" }
}
