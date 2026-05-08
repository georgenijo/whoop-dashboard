# Xcode Cloud — Coach iOS

Auto-build and ship to TestFlight Internal whenever `apps/ios/**` changes on `main`.

## Workflow shape

| Field | Value |
|---|---|
| Name | `Beta` |
| Trigger | Branch changes, branch `main`, files match `apps/ios/**` |
| Environment | macOS latest, Xcode 16.2 (pinned) |
| Action | Archive — Platform iOS, Scheme `Coach`, Configuration `Release` |
| Post-action | TestFlight Internal Testing — Group `Internal` |

The file pattern keeps non-iOS commits (web, sync, docs) from burning build hours. In the Xcode Cloud UI, pick the specific Xcode version (not "Latest Release") so the workflow matches what's documented here. Pinned to avoid drift; bump intentionally and re-test.

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
6. Resolve export compliance once in App Store Connect, or set `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption=NO` in `project.yml` so TestFlight doesn't prompt on each build.

## Acceptance

Push a trivial change under `apps/ios/` to `main`. Within ~10 minutes:

- Xcode Cloud build appears in App Store Connect → Xcode Cloud, status `Succeeded`.
- TestFlight build shows up under Internal Testing with state `Ready to Test`.
- Auto-distribution to the `Internal` group fires.
- TestFlight push notification lands on the test iPhone.

## Free-tier note

Xcode Cloud free tier: 25 compute hours per month (as of January 2024 — see https://developer.apple.com/xcode-cloud/). A Coach archive runs ~5–8 minutes, so monthly cadence (or even per-merge) stays well inside the cap.
