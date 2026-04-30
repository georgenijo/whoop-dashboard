from datetime import datetime

import anthropic

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
            rr = f", RespRate={s['respiratory_rate']:.1f}bpm" if s.get("respiratory_rate") else ""
            lines.append(
                f"  {s['date']}: Slept={actual_hrs:.1f}h (need={need_hrs:.1f}h), "
                f"Deep={deep_hrs:.1f}h, REM={rem_hrs:.1f}h, "
                f"Disturbances={s['disturbances']}{perf}{eff}{rr}"
            )

        rr_values = [s["respiratory_rate"] for s in stats["sleep"] if s.get("respiratory_rate")]
        rr_baseline = sum(rr_values) / len(rr_values) if rr_values else None

        n_high_disturb = sum(1 for s in stats["sleep"] if s["disturbances"] > 10)
        n_low_deep = 0
        n_high_rr = 0
        for s in stats["sleep"]:
            actual_ms = s["in_bed_ms"] - s["awake_ms"]
            if actual_ms > 0:
                deep_pct = s["deep_ms"] / actual_ms * 100
                if deep_pct < 15:
                    n_low_deep += 1
            if rr_baseline and s.get("respiratory_rate") and s["respiratory_rate"] > rr_baseline + 2:
                n_high_rr += 1

        n_low_spo2 = sum(
            1 for r in stats["recovery"]
            if r.get("spo2") is not None and r["spo2"] < 95
        )
        lines.append(
            f"\n  Apnea screening flags: {n_high_disturb} nights with high disturbances, "
            f"{n_low_deep} with low deep sleep, {n_high_rr} with elevated resp rate"
        )
        lines.append(f"  (Nights with SpO2 <95%: {n_low_spo2} — requires WHOOP 4.0+)")

        disturbance_counts = [s["disturbances"] for s in stats["sleep"]]
        disturb_baseline = sum(disturbance_counts) / len(disturbance_counts) if disturbance_counts else 0
        gap_lines = []
        for s in stats["sleep"]:
            actual_hrs = (s["in_bed_ms"] - s["awake_ms"]) / 3_600_000
            need_hrs = s["sleep_need_ms"] / 3_600_000
            if actual_hrs <= 0 or actual_hrs < need_hrs:
                continue
            deep_pct = (s["deep_ms"] / 3_600_000) / actual_hrs * 100
            triggered = []
            if deep_pct < 15:
                triggered.append(f"deep={deep_pct:.0f}%")
            if s.get("efficiency") and s["efficiency"] < 85:
                triggered.append(f"eff={s['efficiency']:.0f}%")
            if disturb_baseline > 0 and s["disturbances"] > disturb_baseline * 1.5:
                triggered.append(f"disturbances={s['disturbances']} (avg={disturb_baseline:.0f})")
            if triggered:
                gap_lines.append(f"  {s['date']}: Slept {actual_hrs:.1f}h but {', '.join(triggered)}")
        if gap_lines:
            lines.append("\nSLEEP QUALITY GAPS (duration OK but quality degraded):")
            lines.extend(gap_lines)

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
    user_message = f"Analyze my Whoop data and give me insights:\n\n{context}"

    try:
        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        insight = "".join(
            block.text for block in response.content if block.type == "text"
        ).strip()
    except anthropic.APIError as exc:
        return f"Error generating insights: {exc}"

    today = datetime.utcnow().strftime("%Y-%m-%d")
    save_insight(today, insight)

    return insight
