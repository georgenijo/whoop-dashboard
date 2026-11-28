# Coach reply latency/token test matrix — 2026-11-27 (Refs #623)

This covers the deterministic half of #623. The automated cases use mocked
Anthropic streams and mocked tool reads, so they make no inference calls and
spend no tokens. The live half has not been run. Its workload is defined, and
its runs array is empty.

- Fixture: `apps/web/src/lib/coach/__fixtures__/coach-reply-workload.json`
- Test: `apps/web/src/lib/coach/loop-latency.test.ts`. Each case runs the real
  `runAnthropicSdk` and asserts:
  - the number of model calls and tool-loop iterations
  - the ordered tool executions, server prefetch first
  - uncached input, output, cache-read and cache-creation totals
  - that the chosen model and effort stay unchanged on every call
  - whether the first request carried server-fetched context or fell back to
    the ordinary tool loop
  - that the user message is persisted unchanged
- Related tests that already existed: `recent-read.test.ts` (prompt
  recognition) and `loop.test.ts` ("server read before the first Anthropic
  inference": oversized payload, cancellation, and turn-state sharing).

## Matrix

| Case | Prefetch | Model calls | Tool calls | Automated | Live batch |
| --- | --- | ---: | --- | :---: | :---: |
| Recovery this week, with presentation-only instructions | used | 1 | recovery (server) | ✓ | ✓ |
| Sleep last night | used | 1 | sleep (server) | ✓ | ✓ |
| Follow-up (has history) | none | 2 | sleep | ✓ | ✓ |
| Image attached | none | 2 | sleep | ✓ | — |
| Ambiguous explicit date | none | 2 | recovery | ✓ | — |
| Ambiguous general question | none | 1 | — | ✓ | — |
| Explicit refresh ("sync now") | none | 3 | sync → recovery | ✓ | — |
| Arbitrary trailing instruction | none | 2 | sleep | ✓ | — |
| Data-access opt-out | none | 1 | — | ✓ | — |
| Prefetch error → fallback | unused | 2 | recovery (server), recovery | ✓ | — |
| Slow (2.5 s) empty read → sync + re-query | unused | 3 | sleep (server), sync, sleep | ✓ | ✓ |
| Multi-domain (recovery + sleep) | none | 2 | recovery ∥ sleep | ✓ | ✓ |
| Null cache usage fields (legacy) | used | 1 | sleep (server) | ✓ | — |

Token numbers in the fixture are scripted inputs. The test checks that the
loop sums them correctly. They are **not** measurements.

## Live workload (not run)

`live_workload` in the fixture lists five cases at three repetitions each
(15 questions, about 22 chat-model calls if the expected counts hold) and the
fields to record for each run. Rules for a live run:

- Keep model, effort, output limit and dataset fixed. Test other providers in
  separate batches.
- Count background title calls separately.
- Keep every run, including failures and slow tails.
- Label each run as local, device or production.
