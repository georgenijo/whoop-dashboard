import Foundation

struct TrendPoint: Decodable, Hashable, Identifiable {
    let date: String
    let raw: Double?
    let ma7: Double?
    let ma30: Double?

    var id: String { date }
}
