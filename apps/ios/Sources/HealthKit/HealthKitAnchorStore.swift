import Foundation
import HealthKit

enum HealthKitAnchorStore {
    private static let key = "com.georgenijo.coach.healthkit.workoutAnchor"

    static func load() -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    static func save(_ anchor: HKQueryAnchor) {
        guard
            let data = try? NSKeyedArchiver.archivedData(
                withRootObject: anchor,
                requiringSecureCoding: true
            )
        else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
