# iOS daily brief verification — 2026-11-14

The native refresh introduces four destinations (Today, Coach, Activity, Plans), readable adaptive surfaces, dated advice, clearer Sleep metrics, accessible range controls and Plans actions. Coach applies completed structured answers before refreshing history, decodes blocks individually, tracks tool IDs, batches streamed text, and provides account/model/thread controls.

## Performance

| Workload | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Long streamed reply, app CPU time | 3.66 s | 2.59 s | 29% lower median across three trials per renderer |
| Same reply, typical sampled RSS | 522.5 MiB | 509.0 MiB | 2.6% lower median of per-trial medians |
| Same reply, peak resident memory | 539.2 MiB | 557.9 MiB | 3.5% higher completion peak; no overall memory-win claim |
| Decode 1,000 timestamps | 272.9 ms | 51.5 ms | 81% lower median across seven interleaved optimized host trials |

Streaming used Debug builds on the same open iPhone Duo simulator, default text size, dark appearance, 500 local SSE events at 10 ms nominal intervals and the same 15,150-character Markdown answer. Each trial starts a new app process. CPU is the app’s cumulative process CPU-time difference; memory is sampled resident memory. Measurement begins before response headers and ends 2 seconds after the final event. The old renderer was regenerated from pinned commit `87a5516d8f501d76397635e12aedcb0b7e9613dc` with the same byte-framing fix applied. Original `AsyncBytes.lines` drops empty SSE separators, so a stock baseline does not provide a valid rendering workload. This comparison isolates old versus new rendering on functioning transport. Earlier measurements without this fix are withdrawn. Host sampling adds overhead; the measured windows were 9.3–9.4 seconds. Trials ran before group then after group, so this is a bounded controlled comparison, not an energy or general app-speed guarantee.

Date decoding uses the real production helper and the exact former strategy. Run:

```sh
swiftc -O apps/ios/Sources/APIDateDecoding.swift scripts/benchmarks/ios-date-decoding.swift -o /tmp/ios-date-bench
/tmp/ios-date-bench
```

Simulator RSS includes runtime/framework overhead and does not establish physical-device memory, battery, GPU, frame-rate or provider-latency improvements. The changes remove redundant chart area marks, prepare chart dates before selection updates, remove decorative continuous animations and bound text rendering to one update per 50 ms.

## Checks

- Debug simulator build passed.
- 111 iOS unit tests passed on the iPhone Duo simulator, including rich final events, resilient block decoding, server tool IDs, model capabilities/effective effort, byte-level SSE boundaries/limits, timestamp formats, advice freshness and light/dark text contrast.
- Required `apps/web` production build passed; no web runtime source changed.
- Independent high-effort Sol review completed; material findings fixed. Focused recheck confirmed fixes and identified a concurrent instruction retry race; a loading guard plus disabled retry resolves it.
- Device checks passed for compact/open layouts, first-visit Plans-to-Coach draft preservation, active-plan fixture exercise navigation, Settings dismissal, and rich final-answer retention with forced history HTTP 500 (including unsupported-block fallback and work log).
- Device interaction evidence and raw performance data are published with the rendered verification artifact.

This slice does not implement every analytical feature absent from the web parity inventory. All-time/YTD ranges, step-source selection, broader recovery/training analyses, widgets and Shortcuts remain separate work; the interface exposes the existing analytical destinations.

## Duo-specific follow-up

Duo is the acceptance target, including its inner and cover displays. The Activity selector, pinned date-range control and date caption now align to the measured leading pane. Native right-side navigation remains system-managed. The focused fold-layout review found no actionable issues; all 111 tests passed on Duo. The iPhone 18 Pro remains shut down.
