#!/usr/bin/env python3
"""Measure real Coach SSE replies on a disposable local instance.

Creates real conversations and spends normal provider API usage. Never target
production. Output contains timing/usage metadata, never replies or credentials.
See docs/verification/2026-11-14-coach-reply-speed.md for the measured workload.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PROMPTS = [
    ("recovery-week", "How was my recovery this week? Give the key numbers and one clear recommendation in at most 120 words. Do not sync data or save a plan."),
    ("sleep-last-night", "How did I sleep last night? Give the key numbers and one clear recommendation in at most 120 words. Do not sync data or save a plan."),
]


def signing_key(env_file):
    value = os.environ.get("JWT_SIGNING_KEY")
    candidates = [Path(env_file)] if env_file else [ROOT / name for name in (
        "apps/web/.env.production.local", "apps/web/.env.local",
        "apps/web/.env.production", "apps/web/.env", ".env",
    )]
    for candidate in candidates:
        if value or not candidate.exists():
            continue
        for line in candidate.read_text().splitlines():
            key, _, raw = line.partition("=")
            if key.strip() == "JWT_SIGNING_KEY":
                value = raw.strip().strip("\"'")
                break
    if not value:
        raise RuntimeError("Missing local instance JWT_SIGNING_KEY")
    return base64.b64decode(value, validate=True)


def session_token(key, user_id):
    def encode(value):
        return base64.urlsafe_b64encode(value).rstrip(b"=")
    now = int(time.time())
    header = encode(b'{"alg":"HS256"}')
    claims = encode(json.dumps({"sub": str(user_id), "iss": "coach-api", "iat": now, "exp": now + 600}).encode())
    unsigned = header + b"." + claims
    signature = encode(hmac.new(key, unsigned, hashlib.sha256).digest())
    return (unsigned + b"." + signature).decode()


def measure(args, key, name, prompt, warmup=False):
    with sqlite3.connect(args.db.resolve().as_uri() + "?mode=ro", uri=True) as db:
        prior_log_id = db.execute("SELECT COALESCE(MAX(id), 0) FROM chat_logs").fetchone()[0]
    body = json.dumps({"messages": [{"role": "user", "content": prompt}], "thread_id": None}).encode()
    request = Request(f"http://127.0.0.1:{args.port}/api/chat", data=body, method="POST", headers={
        "Authorization": "Bearer " + session_token(key, args.user_id), "Content-Type": "application/json",
    })
    start = time.perf_counter()
    first_byte = None
    event, data, events = None, [], []
    terminal = None
    with urlopen(request, timeout=180) as response:
        thread_id = int(response.headers["x-thread-id"])
        for raw in response:
            elapsed = (time.perf_counter() - start) * 1000
            if first_byte is None:
                first_byte = elapsed
            line = raw.decode().rstrip("\r\n")
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
            elif not line and data:
                payload = json.loads("\n".join(data))
                if event == "error":
                    raise RuntimeError("Coach SSE error: " + str(payload.get("kind", "unknown")))
                events.append((event, elapsed))
                if event == "done":
                    terminal = (elapsed, payload.get("reply", ""))
                event, data = None, []
    if terminal is None:
        raise RuntimeError("No terminal done event")
    # A mismatched DB/server pair must fail, never emit plausible timings.
    with sqlite3.connect(args.db.resolve().as_uri() + "?mode=ro", uri=True) as db:
        row = db.execute("SELECT id, details FROM chat_logs WHERE thread_id = ? ORDER BY id DESC LIMIT 1", (thread_id,)).fetchone()
    if not row or row[0] <= prior_log_id or not row[1]:
        raise RuntimeError("No matching chat log in the selected local database")
    details = json.loads(row[1])
    if details.get("full_prompt") != prompt or details.get("model") != args.model or details.get("effort") != args.effort:
        raise RuntimeError("Prompt/model/effort mismatch; benchmark refused")
    if details.get("provider") != "anthropic":
        raise RuntimeError("This comparison requires the Anthropic provider")
    text_times = [ms for event, ms in events if event == "text_delta"]
    last_tool = max((ms for event, ms in events if event == "tool_use_end"), default=0)
    answer_times = [ms for ms in text_times if ms >= last_tool]
    return {
        "name": name, "warmup": warmup, "threadId": thread_id,
        "ttfbMs": first_byte, "firstTextMs": text_times[0] if text_times else None,
        "answerAfterToolsMs": answer_times[0] if answer_times else None,
        "totalMs": terminal[0], "replyWords": len(terminal[1].split()),
        "provider": details["provider"], "model": details["model"], "effort": details["effort"],
        "usage": details.get("usage"), "prefetch": details.get("prefetch"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="Disposable local instance DB")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--port", type=int, default=3010, help="Loopback port only")
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--model", default="claude-sonnet-5-5")
    parser.add_argument("--effort", default="medium")
    parser.add_argument("--env", help="Private env file matching the instance signing key")
    args = parser.parse_args()
    if not args.db.is_file() or args.db.resolve() == (ROOT / "shared/whoop_data.db").resolve():
        parser.error("Use a disposable database copy, not shared/whoop_data.db")
    if not 1 <= args.port <= 65535 or not 1 <= args.runs <= 20 or args.user_id <= 0:
        parser.error("Invalid port, runs, or user-id")
    os.umask(0o077)
    key = signing_key(args.env)
    results = []
    workload = [("warmup", "Reply with exactly: Ready.", True)] + [
        (name, prompt, False) for _ in range(args.runs) for name, prompt in PROMPTS
    ]
    for name, prompt, warmup in workload:
        result = measure(args, key, name, prompt, warmup)
        results.append(result)
        args.out.write_text(json.dumps({"prompts": PROMPTS, "results": results}, indent=2) + "\n")
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
