import os
import subprocess
from datetime import datetime

from whoop.db import get_history_stats, save_insight


def _build_context(days: int = 30) -> str:
    stats = get_history_stats(days)

    lines = []
    lines.append(f"=== WHOOP DATA (last {days} days) ===\n")

    if stats["recovery"]:
        lines.append("RECOVERY (newest first):")
        for r in stats["recovery"]:
            spo2 = f", SpO2={r['spo2']}%" if r.get("spo2") else ""
            temp = f", Skin={r['skin_temp']}°C" if r.get("skin_temp") else ""
            lines.append(
                f"  {r['date']}: Recovery={r['recovery_score']:.0f}%, "
                f"HRV={r['hrv']:.1f}ms, RHR={r['rhr']:.0f}bpm{spo2}{temp}"
            )

        scores = [r["recovery_score"] for r in stats["recovery"]]
        hrvs = [r["hrv"] for r in stats["recovery"]]
        rhrs = [r["rhr"] for r in stats["recovery"]]
        lines.append(f"\n  Averages: Recovery={sum(scores)/len(scores):.1f}%, "
                     f"HRV={sum(hrvs)/len(hrvs):.1f}ms, RHR={sum(rhrs)/len(rhrs):.1f}bpm")

        if len(scores) >= 7:
            recent_7 = scores[:7]
            older_7 = scores[7:14] if len(scores) >= 14 else scores[7:]
            if older_7:
                lines.append(f"  7-day avg: {sum(recent_7)/len(recent_7):.1f}% "
                             f"vs prior 7-day: {sum(older_7)/len(older_7):.1f}%")

    if stats["cycles"]:
        lines.append("\nDAILY STRAIN (newest first):")
        for c in stats["cycles"]:
            lines.append(f"  {c['date']}: Strain={c['strain']:.1f}, "
                         f"Calories={c['kilojoule']/4.184:.0f}kcal")

    if stats["sleep"]:
        lines.append("\nSLEEP (newest first):")
        for s in stats["sleep"]:
            actual_hrs = (s["in_bed_ms"] - s["awake_ms"]) / 3_600_000
            need_hrs = s["sleep_need_ms"] / 3_600_000
            deep_hrs = s["deep_ms"] / 3_600_000
            rem_hrs = s["rem_ms"] / 3_600_000
            perf = f", Perf={s['performance']:.0f}%" if s.get("performance") else ""
            eff = f", Eff={s['efficiency']:.0f}%" if s.get("efficiency") else ""
            lines.append(
                f"  {s['date']}: Slept={actual_hrs:.1f}h (need={need_hrs:.1f}h), "
                f"Deep={deep_hrs:.1f}h, REM={rem_hrs:.1f}h, "
                f"Disturbances={s['disturbances']}{perf}{eff}"
            )

    if stats["workouts"]:
        lines.append("\nWORKOUTS (newest first):")
        for w in stats["workouts"]:
            dur_min = w["duration_sec"] / 60
            lines.append(
                f"  {w['date']}: {w['sport']} — {dur_min:.0f}min, "
                f"Strain={w['strain']:.1f}, AvgHR={w['avg_hr']}bpm"
            )

    return "\n".join(lines)


SYSTEM_PROMPT = """You are a personal health and performance analyst reviewing Whoop biometric data.

Your job:
1. Identify meaningful patterns and trends (not just restate numbers)
2. Flag anomalies or concerning changes
3. Give specific, actionable recommendations
4. Compare recent performance to the user's own baseline (not population averages)
5. Be direct and concise — no fluff

Format your response as:
## Key Findings
- 2-3 most important observations

## Trends
- What's improving, declining, or stable

## Action Items
- 2-3 specific things to do today/this week

## Watch Out
- Anything concerning that needs attention (or "Nothing concerning" if all good)

Keep total response under 300 words."""


def generate_insight(days: int = 30) -> str:
    context = _build_context(days)
    prompt = f"{SYSTEM_PROMPT}\n\nAnalyze my Whoop data and give me insights:\n\n{context}"

    env = dict(os.environ)
    env["HOME"] = os.path.expanduser("~")

    result = subprocess.run(
        [
            "claude",
            "-p",
            prompt,
            "--dangerously-skip-permissions",
            "--model", "sonnet",
        ],
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )

    if result.returncode != 0:
        return f"Error generating insights: {result.stderr[:500]}"

    insight = result.stdout.strip()

    today = datetime.utcnow().strftime("%Y-%m-%d")
    save_insight(today, insight)

    return insight
