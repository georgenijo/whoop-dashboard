import Foundation

enum PlansSample {
    static let json = """
    {
      "plans": [
        {
          "id": 1,
          "title": "Lower Body — Heavy",
          "tag": "strength",
          "description": "Recovery-tuned 4-day strength split.",
          "created_by": "coach",
          "is_active": true,
          "plan": {
            "days": [
              {
                "name": "Lower Body — Heavy",
                "focus": "legs",
                "intensity": "hard",
                "exercises": [
                  { "name": "Back Squat", "scheme": "5x5 @ 80%", "note": "Reset between reps" },
                  { "name": "Romanian Deadlift", "scheme": "4x8", "note": null },
                  { "name": "Walking Lunge", "scheme": "3x12/leg", "note": null },
                  { "name": "Leg Press", "scheme": "3x15", "note": "Slow eccentric" },
                  { "name": "Calf Raise", "scheme": "4x20", "note": null }
                ]
              },
              {
                "name": "Upper Body — Push",
                "focus": "chest, shoulders",
                "intensity": "moderate",
                "exercises": [
                  { "name": "Bench Press", "scheme": "4x6", "note": null },
                  { "name": "Overhead Press", "scheme": "4x8", "note": null }
                ]
              },
              {
                "name": "Active Recovery",
                "focus": "mobility",
                "intensity": "reduced",
                "exercises": [
                  { "name": "Zone 2 Bike", "scheme": "30 min", "note": "Keep HR < 140" }
                ]
              },
              {
                "name": "Rest",
                "focus": null,
                "intensity": "rest",
                "exercises": []
              }
            ],
            "why": "Recovery's high — Coach pushed your hard leg day up. Target strain 14–16."
          },
          "recovery_context": {
            "recovery_score": 84.0,
            "hrv_trend_pct": 18.0,
            "note": "HRV up 18% off Thursday's dip — green light for a hard session."
          },
          "created_at": "2026-06-21T08:00:00.000Z",
          "updated_at": "2026-06-21T08:00:00.000Z"
        },
        {
          "id": 2,
          "title": "Push / Pull / Legs",
          "tag": "strength",
          "description": "6-day high-volume split.",
          "created_by": "user",
          "is_active": false,
          "plan": {
            "days": [
              {
                "name": "Push",
                "focus": "chest, shoulders, triceps",
                "intensity": "moderate",
                "exercises": [
                  { "name": "Incline Bench", "scheme": "4x8", "note": null }
                ]
              }
            ],
            "why": null
          },
          "recovery_context": null,
          "created_at": "2026-06-10T08:00:00.000Z",
          "updated_at": "2026-06-12T08:00:00.000Z"
        }
      ],
      "recovery": {
        "today": {
          "date": "2026-06-21",
          "recovery_score": 84.0,
          "band": "high"
        },
        "week": [
          { "date": "2026-06-15", "recovery_score": 41.0 },
          { "date": "2026-06-16", "recovery_score": 58.0 },
          { "date": "2026-06-17", "recovery_score": 31.0 },
          { "date": "2026-06-18", "recovery_score": 66.0 },
          { "date": "2026-06-19", "recovery_score": 72.0 },
          { "date": "2026-06-20", "recovery_score": 78.0 },
          { "date": "2026-06-21", "recovery_score": 84.0 }
        ]
      }
    }
    """

    private static let decoded: PlansResponse = {
        do {
            let data = Data(json.utf8)
            return try JSONDecoder().decode(PlansResponse.self, from: data)
        } catch {
            assertionFailure("PlansSample decode failed — contract drift: \(error)")
            return PlansResponse(plans: [], recovery: nil)
        }
    }()

    static var plans: [WorkoutPlan] { decoded.plans }

    static var recovery: PlanRecovery? { decoded.recovery }

    static var plan: WorkoutPlan { plans.first ?? placeholder }

    private static let placeholder = WorkoutPlan(
        id: 0,
        title: "Sample Plan",
        tag: nil,
        description: nil,
        createdBy: .coach,
        isActive: true,
        plan: .init(days: [], why: nil),
        recoveryContext: nil,
        createdAt: "",
        updatedAt: ""
    )
}
