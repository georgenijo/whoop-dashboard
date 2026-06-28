import Foundation
import HealthKit

enum HealthKitSportMapper {
    static func sport(for type: HKWorkoutActivityType) -> String {
        switch type {
        case .soccer:
            return "soccer"
        case .walking:
            return "walking"
        case .running:
            return "running"
        case .cycling:
            return "cycling"
        case .swimming:
            return "swimming"
        case .hiking:
            return "hiking"
        case .traditionalStrengthTraining:
            return "weightlifting"
        case .functionalStrengthTraining:
            return "functional fitness"
        case .coreTraining:
            return "functional fitness"
        case .yoga:
            return "yoga"
        case .pickleball:
            return "pickleball"
        case .highIntensityIntervalTraining:
            return "hiit"
        case .tennis:
            return "tennis"
        case .basketball:
            return "basketball"
        case .rowing:
            return "rowing"
        case .elliptical:
            return "elliptical"
        case .stairClimbing, .stairs:
            return "stairs"
        default:
            return "workout"
        }
    }
}
