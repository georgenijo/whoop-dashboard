# Xcode Cloud — Coach iOS

Native verification and TestFlight delivery run in Xcode Cloud. GitHub's web CI does not compile Swift or prove that an iOS build shipped.

## Versioned configuration

`ci/workflows.json` is the source of truth for the managed workflow fields and concrete compatible toolchain IDs. The current pin is Xcode 27.2 (`27B52`) on macOS Golden Gate 27.2 (`26B123`), with the iPhone Duo iOS 27.2 simulator. The runtime ID is device-specific (`com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4`): Apple lists the generic 27.2 runtime for Duo too, but the cloud runner rejects that pair as incompatible. Catalog membership alone does not prove a destination can execute; require a passing native run.

| Workflow | Starts | Required action |
|---|---|---|
| Beta | Changes under `apps/ios` on `main` | Archive Coach for internal TestFlight |
| Verify | PRs targeting `main` with changes under `apps/ios`; daily on `main` at 07:00 UTC | Test Coach on the Duo simulator |

The daily run exercises the shared toolchain even when no source changes. A retired pin can fail before Apple creates any build actions; a failed daily run is a release-health signal. This detects retirement after it occurs, within roughly a day, rather than predicting Apple's retirement dates. Inspect `Coach | Verify` as part of native PR readiness; this setup does not change GitHub branch protection.

## Inspect and repair

Use an existing App Store Connect API key through environment variables `ASC_KEY_ID`, `ASC_ISSUER_ID`, and optionally `ASC_KEY_PATH`. The default key location is `~/.appstoreconnect/private_keys/AuthKey_<key-id>.p8`. Keep credential files outside this repository. `uv` installs the script's isolated JWT dependency; no project dependencies or GitHub secrets are required.

From the repository root:

```sh
uv run --env-file /absolute/path/to/private/asc.env scripts/ios-cloud.py doctor
uv run --env-file /absolute/path/to/private/asc.env scripts/ios-cloud.py plan
uv run --env-file /absolute/path/to/private/asc.env scripts/ios-cloud.py apply
```

`doctor` is read-only: exit 0 means the managed configuration matches; exit 1 means drift; exit 2 means configuration/API validation failed. `plan` prints the proposed changes without writing. Only `apply` changes Apple configuration, and it verifies the result with a fresh read. It does not start or distribute a build.

The tool checks app/product/workflow ownership, repository identity, catalog availability, Xcode/macOS compatibility, and the Duo runtime before writing. It preserves unrelated existing workflow settings and actions. Ambiguous workflow/action matches require manual investigation. Beta's existing TestFlight post-action and `Internal` group distribution remain configured in Apple's UI; the public workflow API does not expose them.

When a pin retires:

1. Inspect Apple's supported Xcode catalog and compatible macOS versions; select an explicit stable pair with a Duo runtime. Avoid `Latest` aliases.
2. Update the IDs, names, build versions, and runtime in the manifest on a PR. Run the offline tooling tests and native tests with the selected toolchain; obtain the required independent review.
3. Run `plan`, inspect it, then `apply` within the authorized release. Confirm `doctor` is healthy. Check both workflows, since they share the pins.
4. Run Verify on the PR/current main and Beta on the intended release revision. Verify the resulting commit, archive, and TestFlight state as described below.

Offline checks:

```sh
python3 -m unittest discover -s tests -p 'test_ios_cloud*.py' -v
sh -n apps/ios/ci_scripts/ci_post_clone.sh
```

GitHub runs these checks on PRs and main without Apple credentials. They test reconciliation and failure behavior, not live Apple catalog availability.

## Project generation

`Coach.xcodeproj` is ignored and generated from `project.yml`. Xcode Cloud runs `ci_scripts/ci_post_clone.sh`, which checks the actual Xcode build against the manifest, installs XcodeGen if absent, and generates the project and shared scheme. The hook fails before compilation on a mismatched Xcode build. A dangling toolchain reference can prevent the hook itself from starting; use `doctor` and daily Verify to catch that case.

## Delivery acceptance

For an iOS release, verify all of the following; a merged PR or green web build alone is insufficient:

- Native Verify tests passed for the intended revision/PR merge.
- Beta's source commit matches the intended merged revision.
- Beta started actual build actions and its required archive succeeded.
- The uploaded TestFlight build finished processing and is ready for internal testing.
- The build is assigned to the existing `Internal` group. Do not infer distribution from archive success alone.

If a run fails before starting, inspect the workflow's Xcode/macOS relationships and run `doctor` before retrying. Runs 42–44 in November 2026 failed with no actions and a null Xcode relationship after the old 26.4.1 pin disappeared from Apple's catalog.

## Identifiers and initial setup

- Bundle ID: `com.georgenijo.coach`
- Developer team: `P2U3P8B923`
- App Store Connect app: `6767579063`
- CI product and workflow identities: `ci/workflows.json`

Initial GitHub connection, signing, Beta archive, and TestFlight `Internal` post-action are configured through Xcode/App Store Connect. The reconciliation tool validates that existing Beta identity; it does not provision credentials, signing, or repository permissions. Generate the project locally with `xcodegen generate` in `apps/ios` before opening it. Export compliance is declared through `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption=NO` in `project.yml`.

Apple's included compute allowance is finite. The daily Verify run consumes native build minutes; monitor Xcode Cloud usage and adjust cadence intentionally if needed. Do not silently disable validation or change the internal distribution audience.
