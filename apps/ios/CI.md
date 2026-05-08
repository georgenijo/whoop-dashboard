# Xcode Cloud — Coach iOS

Auto-build and ship to TestFlight Internal whenever `apps/ios/**` changes on `main`.

## Workflow shape

| Field | Value |
|---|---|
| Name | `Beta` |
| Trigger | Branch changes, branch `main`, files match `apps/ios/**` |
| Environment | macOS latest, Xcode latest stable |
| Action | Archive — Platform iOS, Scheme `Coach`, Configuration `Release` |
| Post-action | TestFlight Internal Testing — Group `Internal` |

The file pattern keeps non-iOS commits (web, sync, docs) from burning build hours.

## App identifiers

- Bundle ID: `com.georgenijo.coach`
- Team ID: `P2U3P8B923`
- App Store Connect app id: `6767579063` (CoachOS by George Nijo)

## One-time setup

1. Open `apps/ios/Coach.xcodeproj` in Xcode (run `xcodegen generate` from `apps/ios/` first if missing).
2. Xcode → Product → Xcode Cloud → Create Workflow, name it `Beta`.
3. On first save Xcode prompts for GitHub OAuth — grant access to `georgenijo/whoop-dashboard`.
4. Configure the workflow per the table above.
5. Confirm signing uses the team `P2U3P8B923` (Xcode Cloud manages certs/profiles automatically).

## Acceptance

Push a trivial change under `apps/ios/` to `main`. Within ~10 minutes:

- Xcode Cloud build appears in App Store Connect → Xcode Cloud, status `Succeeded`.
- TestFlight build shows up under Internal Testing with state `Ready to Test` (no manual export-compliance prompt — already handled in `Info.plist` via `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption=NO` if added; otherwise resolve once in ASC).
- Auto-distribution to the `Internal` group fires.
- TestFlight push notification lands on the test iPhone.

## Free-tier note

Xcode Cloud free tier: 25 compute hours per month. A Coach archive runs ~5–8 minutes, so monthly cadence (or even per-merge) stays well inside the cap.
