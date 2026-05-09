import Foundation

struct DashboardSummary: Decodable {
    let date: String
    let requestedDate: String
    let dataDate: String?
    let isFallback: Bool
    let recovery: Recovery?
    let sleep: Sleep?
    let strain: Strain?
    let signals: Signals

    enum CodingKeys: String, CodingKey {
        case date
        case requestedDate = "requested_date"
        case dataDate = "data_date"
        case isFallback = "is_fallback"
        case recovery
        case sleep
        case strain
        case signals
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let date = try container.decode(String.self, forKey: .date)
        self.date = date
        self.requestedDate = try container.decodeIfPresent(String.self, forKey: .requestedDate) ?? date
        self.dataDate = try container.decodeIfPresent(String.self, forKey: .dataDate)
        self.isFallback = try container.decodeIfPresent(Bool.self, forKey: .isFallback) ?? false
        self.recovery = try container.decodeIfPresent(Recovery.self, forKey: .recovery)
        self.sleep = try container.decodeIfPresent(Sleep.self, forKey: .sleep)
        self.strain = try container.decodeIfPresent(Strain.self, forKey: .strain)
        self.signals = try container.decode(Signals.self, forKey: .signals)
    }

    struct Recovery: Decodable {
        let score: Double?
        let hrvMs: Double?
        let rhrBpm: Double?
        let spo2Pct: Double?
        let skinTempC: Double?

        enum CodingKeys: String, CodingKey {
            case score
            case hrvMs = "hrv_ms"
            case rhrBpm = "rhr_bpm"
            case spo2Pct = "spo2_pct"
            case skinTempC = "skin_temp_c"
        }
    }

    struct Sleep: Decodable {
        let durationMin: Double?
        let perfPct: Double?
        let efficiencyPct: Double?
        let debtMin: Double?

        enum CodingKeys: String, CodingKey {
            case durationMin = "duration_min"
            case perfPct = "perf_pct"
            case efficiencyPct = "efficiency_pct"
            case debtMin = "debt_min"
        }
    }

    struct Strain: Decodable {
        let score: Double?
        let kj: Double?
        let avgHr: Double?
        let maxHr: Double?

        enum CodingKeys: String, CodingKey {
            case score
            case kj
            case avgHr = "avg_hr"
            case maxHr = "max_hr"
        }
    }

    struct Signals: Decodable {
        let ots: OTS?
        let illness: Illness?
        let apnea: Apnea?

        struct OTS: Decodable {
            let score: Int
            let severity: String
        }

        struct Illness: Decodable {
            let risk: String
        }

        struct Apnea: Decodable {
            let highRiskNights7d: Int

            enum CodingKeys: String, CodingKey {
                case highRiskNights7d = "high_risk_nights_7d"
            }
        }
    }

    var hasAnyData: Bool {
        dataDate != nil
    }
}
