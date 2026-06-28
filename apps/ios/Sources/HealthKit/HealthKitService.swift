import Foundation
import HealthKit

actor HealthKitService {
    static let shared = HealthKitService()

    private let store = HKHealthStore()
    private let api: APIClient
    private var isSyncing = false
    private var observerRegistered = false

    private static let batchSize = 25
    private static let targetMaxPoints = 600
    private static let baseIntervalSec = 5

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    // MARK: - Public entry points

    func bootstrap() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        guard await requestAuthorization() else { return }
        registerObserver()
        await sync()
    }

    func sync() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        if isSyncing { return }
        isSyncing = true
        defer { isSyncing = false }

        let anchor = HealthKitAnchorStore.load()
        let workouts: [HKWorkout]
        let newAnchor: HKQueryAnchor?
        do {
            (workouts, newAnchor) = try await fetchWorkouts(anchor: anchor)
        } catch {
            ClientLogger.shared.warn(
                "healthkit_fetch_failed",
                details: ["error": String(describing: error)]
            )
            return
        }

        guard !workouts.isEmpty else {
            if let newAnchor { HealthKitAnchorStore.save(newAnchor) }
            return
        }

        var payloads: [HealthKitIngestWorkout] = []
        payloads.reserveCapacity(workouts.count)
        for workout in workouts {
            payloads.append(await buildPayload(for: workout))
        }

        var index = 0
        while index < payloads.count {
            let end = min(index + Self.batchSize, payloads.count)
            let batch = Array(payloads[index..<end])
            do {
                let _: HealthKitIngestResponse = try await api.post(
                    "/api/ingest/healthkit",
                    body: HealthKitIngestRequest(workouts: batch)
                )
            } catch {
                // Don't advance the anchor on a failed upload — the next run
                // re-pulls the same workouts and the backend dedupes by
                // external_id, so nothing is lost or duplicated.
                ClientLogger.shared.warn(
                    "healthkit_upload_failed",
                    details: [
                        "error": String(describing: error),
                        "uploaded": index,
                        "remaining": payloads.count - index,
                    ]
                )
                return
            }
            index = end
        }

        if let newAnchor { HealthKitAnchorStore.save(newAnchor) }
        ClientLogger.shared.lifecycle(
            "healthkit_sync",
            details: ["uploaded": payloads.count]
        )
    }

    // MARK: - Authorization

    private func requestAuthorization() async -> Bool {
        let read: Set<HKObjectType> = [
            HKObjectType.workoutType(),
            HKQuantityType(.heartRate),
        ]
        do {
            try await store.requestAuthorization(toShare: [], read: read)
            return true
        } catch {
            ClientLogger.shared.warn(
                "healthkit_auth_failed",
                details: ["error": String(describing: error)]
            )
            return false
        }
    }

    // MARK: - Observer + background delivery

    private func registerObserver() {
        guard !observerRegistered else { return }
        observerRegistered = true

        let workoutType = HKObjectType.workoutType()
        let query = HKObserverQuery(
            sampleType: workoutType,
            predicate: nil
        ) { [weak self] _, completionHandler, error in
            guard let self else { completionHandler(); return }
            if error != nil { completionHandler(); return }
            Task {
                await self.sync()
                completionHandler()
            }
        }
        store.execute(query)

        store.enableBackgroundDelivery(for: workoutType, frequency: .immediate) { success, error in
            if !success {
                ClientLogger.shared.warn(
                    "healthkit_background_delivery_failed",
                    details: ["error": String(describing: error)]
                )
            }
        }
    }

    // MARK: - Queries

    private func fetchWorkouts(
        anchor: HKQueryAnchor?
    ) async throws -> (workouts: [HKWorkout], newAnchor: HKQueryAnchor?) {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: HKObjectType.workoutType(),
                predicate: nil,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, _, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let workouts = (samples as? [HKWorkout]) ?? []
                continuation.resume(returning: (workouts, newAnchor))
            }
            store.execute(query)
        }
    }

    private func fetchHeartRate(
        for workout: HKWorkout
    ) async throws -> [(date: Date, bpm: Double)] {
        let hrType = HKQuantityType(.heartRate)
        let predicate = HKQuery.predicateForSamples(
            withStart: workout.startDate,
            end: workout.endDate,
            options: []
        )
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let unit = HKUnit.count().unitDivided(by: .minute())

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: hrType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sort]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let points = (samples as? [HKQuantitySample] ?? []).map {
                    (date: $0.startDate, bpm: $0.quantity.doubleValue(for: unit))
                }
                continuation.resume(returning: points)
            }
            store.execute(query)
        }
    }

    // MARK: - Payload assembly

    private func buildPayload(for workout: HKWorkout) async -> HealthKitIngestWorkout {
        let points = (try? await fetchHeartRate(for: workout)) ?? []
        let downsampled = Self.downsample(
            points: points,
            start: workout.startDate,
            end: workout.endDate
        )

        return HealthKitIngestWorkout(
            externalId: workout.uuid.uuidString,
            sport: HealthKitSportMapper.sport(for: workout.workoutActivityType),
            start: Self.iso.string(from: workout.startDate),
            end: Self.iso.string(from: workout.endDate),
            sourceName: workout.sourceRevision.source.name,
            kilojoule: workout.totalEnergyBurned?.doubleValue(for: HKUnit.jouleUnit(with: .kilo)),
            distanceM: workout.totalDistance?.doubleValue(for: .meter()),
            avgHr: downsampled.avg,
            maxHr: downsampled.max,
            hrSeries: downsampled.series
        )
    }

    private static func downsample(
        points: [(date: Date, bpm: Double)],
        start: Date,
        end: Date
    ) -> (series: HealthKitHRSeries?, avg: Int?, max: Int?) {
        guard !points.isEmpty else { return (nil, nil, nil) }

        let duration = Swift.max(0, end.timeIntervalSince(start))
        var interval = baseIntervalSec
        while duration / Double(interval) > Double(targetMaxPoints) {
            interval += baseIntervalSec
        }

        let bucketCount = Swift.max(1, Int(ceil(duration / Double(interval))))
        var sums = [Double](repeating: 0, count: bucketCount)
        var counts = [Int](repeating: 0, count: bucketCount)

        for point in points {
            let offset = point.date.timeIntervalSince(start)
            guard offset >= 0 else { continue }
            let idx = Swift.min(bucketCount - 1, Int(offset / Double(interval)))
            sums[idx] += point.bpm
            counts[idx] += 1
        }

        let bpm: [Int?] = (0..<bucketCount).map { i in
            counts[i] > 0 ? Int((sums[i] / Double(counts[i])).rounded()) : nil
        }

        let allBpm = points.map { $0.bpm }
        let avg = Int((allBpm.reduce(0, +) / Double(allBpm.count)).rounded())
        let maxBpm = Int((allBpm.max() ?? 0).rounded())

        let series = HealthKitHRSeries(
            intervalSec: interval,
            startOffsetSec: 0,
            bpm: bpm
        )
        return (series, avg, maxBpm)
    }
}
