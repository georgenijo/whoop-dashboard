import os
from datetime import datetime, timedelta, timezone

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
from dotenv import load_dotenv

from whoop.auth import (
    build_auth_url,
    clear_tokens,
    exchange_code,
    get_valid_token,
    load_tokens,
)
from whoop.client import AuthError, fetch_all_parallel
from whoop.db import init_db, sync_all, get_latest_insight
from whoop.insights import generate_insight

load_dotenv()

st.set_page_config(page_title="Whoop Dashboard", layout="wide")

CLIENT_ID = os.getenv("WHOOP_CLIENT_ID", "")
REDIRECT_URI = os.getenv("WHOOP_REDIRECT_URI", "http://localhost:8501")
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")

# --- Password Gate (cookie-like persistence via query param hash) ---

if DASHBOARD_PASSWORD:
    import hashlib
    _auth_hash = hashlib.sha256(DASHBOARD_PASSWORD.encode()).hexdigest()[:16]

    if "authenticated" not in st.session_state:
        # Check if auth cookie exists in query params
        if st.query_params.get("auth") == _auth_hash:
            st.session_state.authenticated = True
        else:
            st.session_state.authenticated = False

    if not st.session_state.authenticated:
        st.title("Whoop Dashboard")
        pw = st.text_input("Password", type="password")
        if pw:
            if pw == DASHBOARD_PASSWORD:
                st.session_state.authenticated = True
                st.query_params["auth"] = _auth_hash
                st.rerun()
            else:
                st.error("Wrong password.")
        st.stop()


# --- Auth Flow ---


def handle_oauth_callback():
    params = st.query_params
    if "code" in params:
        code = params["code"]
        try:
            token_data = exchange_code(code, REDIRECT_URI)
            st.session_state.token = token_data["access_token"]
            st.query_params.clear()
            st.rerun()
        except Exception as e:
            st.error(f"OAuth error: {e}")


def get_token() -> str | None:
    if "token" in st.session_state:
        return st.session_state.token
    token = get_valid_token()
    if token:
        st.session_state.token = token
    return token


handle_oauth_callback()
token = get_token()

if not token:
    st.title("Whoop Dashboard")
    st.markdown("Connect your Whoop account to get started.")
    auth_url = build_auth_url(CLIENT_ID, REDIRECT_URI)
    st.link_button("Connect to Whoop", auth_url)
    st.stop()


# --- Sidebar ---


with st.sidebar:
    st.title("Whoop Dashboard")
    days = st.slider("History (days)", 7, 180, 30)
    if st.button("Refresh Data"):
        st.cache_data.clear()
        st.rerun()
    if st.button("Disconnect"):
        clear_tokens()
        st.session_state.clear()
        st.rerun()


# --- Data Fetching ---

init_db()

now = datetime.now(timezone.utc)
start_dt = now - timedelta(days=days)
start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
end_iso = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")


@st.cache_data(ttl=600)
def fetch_data(_token: str, start: str, end: str) -> dict:
    data = fetch_all_parallel(_token, start, end)
    sync_all(data)
    return data


try:
    data = fetch_data(token, start_iso, end_iso)
except AuthError:
    clear_tokens()
    st.session_state.clear()
    st.rerun()


# --- Helpers ---


def ms_to_hours(ms: int | float) -> float:
    return ms / 3_600_000


def kj_to_kcal(kj: float) -> float:
    return kj / 4.184


def scored(records: list) -> list:
    return [r for r in records if r.get("score_state") == "SCORED"]


def parse_date(iso_str: str) -> datetime:
    return datetime.fromisoformat(iso_str.replace("Z", "+00:00"))


# --- Profile ---

profile = data["profile"]
with st.sidebar:
    st.markdown(f"**{profile['first_name']} {profile['last_name']}**")
    body = data.get("body")
    if body:
        parts = []
        if body.get("height_meter"):
            height_cm = round(body["height_meter"] * 100, 1)
            parts.append(f"**Height:** {height_cm} cm")
        if body.get("weight_kilogram"):
            parts.append(f"**Weight:** {round(body['weight_kilogram'], 1)} kg")
        if body.get("max_heart_rate"):
            parts.append(f"**Max HR:** {body['max_heart_rate']} bpm")
        if parts:
            st.markdown(" · ".join(parts))


# --- Build DataFrames ---


def build_recovery_df(records: list) -> pd.DataFrame:
    rows = []
    for r in scored(records):
        s = r["score"]
        rows.append(
            {
                "date": parse_date(r["created_at"]).date(),
                "recovery": s["recovery_score"],
                "hrv": s["hrv_rmssd_milli"],
                "rhr": s["resting_heart_rate"],
                "spo2": s.get("spo2_percentage"),
                "skin_temp": s.get("skin_temp_celsius"),
            }
        )
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("date").reset_index(drop=True)
    return df


def build_cycle_df(records: list) -> pd.DataFrame:
    rows = []
    for r in scored(records):
        s = r["score"]
        rows.append(
            {
                "date": parse_date(r["start"]).date(),
                "strain": s["strain"],
                "kilojoule": s["kilojoule"],
                "avg_hr": s["average_heart_rate"],
                "max_hr": s["max_heart_rate"],
            }
        )
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("date").reset_index(drop=True)
    return df


def build_sleep_df(records: list) -> pd.DataFrame:
    rows = []
    for r in scored(records):
        if r.get("nap"):
            continue
        s = r["score"]
        ss = s["stage_summary"]
        sn = s["sleep_needed"]
        total_need = (
            sn["baseline_milli"]
            + sn["need_from_sleep_debt_milli"]
            + sn["need_from_recent_strain_milli"]
            + sn["need_from_recent_nap_milli"]
        )
        rows.append(
            {
                "date": parse_date(r["start"]).date(),
                "in_bed_hrs": ms_to_hours(ss["total_in_bed_time_milli"]),
                "light_hrs": ms_to_hours(ss["total_light_sleep_time_milli"]),
                "deep_hrs": ms_to_hours(ss["total_slow_wave_sleep_time_milli"]),
                "rem_hrs": ms_to_hours(ss["total_rem_sleep_time_milli"]),
                "awake_hrs": ms_to_hours(ss["total_awake_time_milli"]),
                "sleep_need_hrs": ms_to_hours(total_need),
                "performance": s.get("sleep_performance_percentage"),
                "efficiency": s.get("sleep_efficiency_percentage"),
                "consistency": s.get("sleep_consistency_percentage"),
                "respiratory_rate": s.get("respiratory_rate"),
                "disturbances": ss["disturbance_count"],
                "cycles": ss["sleep_cycle_count"],
            }
        )
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("date").reset_index(drop=True)
    return df


def build_workout_df(records: list) -> pd.DataFrame:
    rows = []
    for r in scored(records):
        s = r["score"]
        start = parse_date(r["start"])
        end = parse_date(r["end"])
        duration_min = (end - start).total_seconds() / 60
        row = {
            "date": start.date(),
            "sport": r.get("sport_name", "Unknown"),
            "duration_min": round(duration_min, 1),
            "avg_hr": s["average_heart_rate"],
            "max_hr": s["max_heart_rate"],
            "strain": round(s["strain"], 1),
            "calories": round(kj_to_kcal(s["kilojoule"])),
            "zone_0_min": s["zone_durations"]["zone_zero_milli"] / 60_000,
            "zone_1_min": s["zone_durations"]["zone_one_milli"] / 60_000,
            "zone_2_min": s["zone_durations"]["zone_two_milli"] / 60_000,
            "zone_3_min": s["zone_durations"]["zone_three_milli"] / 60_000,
            "zone_4_min": s["zone_durations"]["zone_four_milli"] / 60_000,
            "zone_5_min": s["zone_durations"]["zone_five_milli"] / 60_000,
        }
        if s.get("distance_meter") is not None:
            row["distance_m"] = round(s["distance_meter"])
        if s.get("altitude_gain_meter") is not None:
            row["altitude_gain_m"] = round(s["altitude_gain_meter"], 1)
        rows.append(row)
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("date", ascending=False).reset_index(drop=True)
    return df


def compute_illness_signal(recovery_df: pd.DataFrame, sleep_df: pd.DataFrame) -> pd.DataFrame:
    if recovery_df.empty:
        return pd.DataFrame()

    df = recovery_df[["date", "rhr", "hrv", "skin_temp"]].copy()
    if not sleep_df.empty:
        df = df.merge(sleep_df[["date", "respiratory_rate"]], on="date", how="left")
    else:
        df["respiratory_rate"] = float("nan")

    df = df.sort_values("date").reset_index(drop=True)

    rhr_baseline = df["rhr"].rolling(14, min_periods=7).mean().shift(1)
    hrv_baseline = df["hrv"].rolling(14, min_periods=7).mean().shift(1)
    skin_temp_baseline = df["skin_temp"].rolling(14, min_periods=7).mean().shift(1)
    resp_rate_baseline = df["respiratory_rate"].rolling(14, min_periods=7).mean().shift(1)

    rhr_flag = df["rhr"] > rhr_baseline + 3
    hrv_flag = df["hrv"] < hrv_baseline * 0.90
    skin_temp_flag = df["skin_temp"] > skin_temp_baseline + 0.5
    resp_rate_flag = df["respiratory_rate"] > resp_rate_baseline + 2

    signal_count = (
        rhr_flag.fillna(False).astype(int)
        + hrv_flag.fillna(False).astype(int)
        + skin_temp_flag.fillna(False).astype(int)
    )

    result = df[["date", "rhr", "hrv", "skin_temp", "respiratory_rate"]].copy()
    result["rhr_baseline"] = rhr_baseline
    result["hrv_baseline"] = hrv_baseline
    result["skin_temp_baseline"] = skin_temp_baseline
    result["resp_rate_baseline"] = resp_rate_baseline
    result["rhr_dev"] = df["rhr"] - rhr_baseline
    result["hrv_dev"] = (df["hrv"] - hrv_baseline) / hrv_baseline * 100
    result["skin_temp_dev"] = df["skin_temp"] - skin_temp_baseline
    result["resp_rate_dev"] = df["respiratory_rate"] - resp_rate_baseline
    result["rhr_flag"] = rhr_flag.fillna(False)
    result["hrv_flag"] = hrv_flag.fillna(False)
    result["skin_temp_flag"] = skin_temp_flag.fillna(False)
    result["resp_rate_flag"] = resp_rate_flag.fillna(False)
    result["signal_count"] = signal_count
    result["has_skin_temp"] = df["skin_temp"].notna()
    result["illness_flag"] = signal_count >= 2

    return result


def build_apnea_df(sleep_df: pd.DataFrame, recovery_df: pd.DataFrame) -> pd.DataFrame:
    if sleep_df.empty:
        return pd.DataFrame()

    df = sleep_df.copy().sort_values("date").reset_index(drop=True)
    df = df.merge(recovery_df[["date", "spo2"]], on="date", how="left")

    total_sleep = df["in_bed_hrs"] - df["awake_hrs"]
    total_sleep[total_sleep <= 0] = float("nan")
    df["total_sleep_hrs"] = total_sleep
    df["deep_sleep_pct"] = df["deep_hrs"] / df["total_sleep_hrs"] * 100

    df["resp_rate_baseline"] = (
        df["respiratory_rate"].expanding(min_periods=3).mean().shift(1)
    )

    df["flag_disturbances"] = (df["disturbances"] > 10).astype(int)
    df["flag_spo2"] = ((df["spo2"] < 95) & df["spo2"].notna()).astype(int)
    df["flag_resp_rate"] = (
        (df["respiratory_rate"] > df["resp_rate_baseline"] + 2)
        & df["respiratory_rate"].notna()
        & df["resp_rate_baseline"].notna()
    ).astype(int)
    df["flag_deep_sleep"] = (
        (df["deep_sleep_pct"] < 15) & df["deep_sleep_pct"].notna()
    ).astype(int)

    df["apnea_score"] = (
        df["flag_disturbances"]
        + df["flag_spo2"]
        + df["flag_resp_rate"]
        + df["flag_deep_sleep"]
    )
    df["apnea_score_7d"] = df["apnea_score"].rolling(7, min_periods=1).sum()

    return df


DEEP_SLEEP_THRESHOLD = 15.0
EFFICIENCY_THRESHOLD = 85.0
DISTURBANCE_MULTIPLIER = 1.5
DISTURBANCE_MIN_PERIODS = 3


def detect_sleep_quality_gaps(sleep_df: pd.DataFrame, recent_days: int = 7) -> list:
    if sleep_df.empty:
        return []

    df = sleep_df.copy()
    df["actual_sleep_hrs"] = df["in_bed_hrs"] - df["awake_hrs"]
    df["rolling_disturb_avg"] = (
        df["disturbances"].rolling(14, min_periods=DISTURBANCE_MIN_PERIODS).mean().shift(1)
    )

    cutoff = df["date"].max() - timedelta(days=recent_days)
    candidates = df[(df["actual_sleep_hrs"] >= df["sleep_need_hrs"]) & (df["date"] >= cutoff)]

    results = []
    for _, row in candidates.iterrows():
        actual_hrs = row["actual_sleep_hrs"]
        if actual_hrs <= 0:
            continue
        deep_pct = row["deep_hrs"] / actual_hrs * 100
        reasons = []
        if deep_pct < DEEP_SLEEP_THRESHOLD:
            reasons.append({"metric": "deep_sleep", "value": deep_pct, "threshold": DEEP_SLEEP_THRESHOLD})
        if pd.notna(row.get("efficiency")) and row["efficiency"] < EFFICIENCY_THRESHOLD:
            reasons.append({"metric": "efficiency", "value": row["efficiency"], "threshold": EFFICIENCY_THRESHOLD})
        rolling_avg = row["rolling_disturb_avg"]
        if pd.notna(rolling_avg) and row["disturbances"] > rolling_avg * DISTURBANCE_MULTIPLIER:
            reasons.append({"metric": "disturbances", "value": row["disturbances"], "avg": rolling_avg})
        if reasons:
            results.append({"date": row["date"], "actual_hrs": actual_hrs, "reasons": reasons})

    results.sort(key=lambda x: x["date"], reverse=True)
    return results


def render_sleep_quality_alerts(gaps: list):
    if not gaps:
        return
    display = gaps[:3]
    for gap in display:
        bullets = []
        for r in gap["reasons"]:
            if r["metric"] == "deep_sleep":
                bullets.append(f"Deep sleep only {r['value']:.0f}% (need ≥{r['threshold']:.0f}%)")
            elif r["metric"] == "efficiency":
                bullets.append(f"Sleep efficiency {r['value']:.0f}% (need ≥{r['threshold']:.0f}%)")
            elif r["metric"] == "disturbances":
                bullets.append(f"Had {int(r['value'])} disturbances (14-day avg: {r['avg']:.0f})")
        bullet_str = "\n  - ".join(bullets)
        msg = f"🛏️ **{gap['date']}** — You slept {gap['actual_hrs']:.1f}h (meets your need) but:\n  - {bullet_str}"
        st.warning(msg)
    if len(gaps) > 3:
        st.caption(f"{len(gaps) - 3} more night(s) with quality gaps in this period.")


recovery_df = build_recovery_df(data["recovery"])
cycle_df = build_cycle_df(data["cycles"])
sleep_df = build_sleep_df(data["sleep"])
workout_df = build_workout_df(data["workouts"])
apnea_df = build_apnea_df(sleep_df, recovery_df)
illness_df = compute_illness_signal(recovery_df, sleep_df)


# --- KPI Row ---

st.markdown("---")

if not recovery_df.empty and not cycle_df.empty and not sleep_df.empty:
    latest_rec = recovery_df.iloc[-1]
    prev_rec = recovery_df.iloc[-2] if len(recovery_df) > 1 else None
    latest_cycle = cycle_df.iloc[-1]
    prev_cycle = cycle_df.iloc[-2] if len(cycle_df) > 1 else None
    latest_sleep = sleep_df.iloc[-1]
    prev_sleep = sleep_df.iloc[-2] if len(sleep_df) > 1 else None

    def delta(current, previous, key):
        if previous is None or pd.isna(current.get(key)) or pd.isna(previous.get(key)):
            return None
        return round(current[key] - previous[key], 1)

    cols = st.columns(6)
    with cols[0]:
        st.metric(
            "Recovery",
            f"{latest_rec['recovery']:.0f}%",
            delta=delta(latest_rec, prev_rec, "recovery"),
        )
    with cols[1]:
        st.metric(
            "HRV",
            f"{latest_rec['hrv']:.1f} ms",
            delta=delta(latest_rec, prev_rec, "hrv"),
        )
    with cols[2]:
        st.metric(
            "RHR",
            f"{latest_rec['rhr']:.0f} bpm",
            delta=delta(latest_rec, prev_rec, "rhr"),
            delta_color="inverse",
        )
    with cols[3]:
        perf = latest_sleep.get("performance")
        perf_str = f"{perf:.0f}%" if perf is not None and not pd.isna(perf) else "—"
        st.metric(
            "Sleep Perf",
            perf_str,
            delta=delta(latest_sleep, prev_sleep, "performance"),
        )
    with cols[4]:
        st.metric(
            "Day Strain",
            f"{latest_cycle['strain']:.1f}",
            delta=delta(latest_cycle, prev_cycle, "strain"),
        )
    with cols[5]:
        spo2 = latest_rec.get("spo2")
        if spo2 is not None and not pd.isna(spo2):
            st.metric(
                "SpO2",
                f"{spo2:.1f}%",
                delta=delta(latest_rec, prev_rec, "spo2"),
            )
        else:
            st.metric("SpO2", "—")
else:
    st.info("Not enough data for KPIs yet.")

st.markdown("---")


# --- Sleep Quality Alerts ---

quality_gaps = detect_sleep_quality_gaps(sleep_df)
if quality_gaps:
    st.subheader("⚠️ Sleep Quality Alerts")
render_sleep_quality_alerts(quality_gaps)


# --- AI Insights ---


st.subheader("AI Insights")
insight_box = st.empty()
if st.button("Generate Fresh Insights"):
    with st.spinner("Claude is analyzing your data..."):
        insight = generate_insight(days)
    insight_box.markdown(insight)
else:
    cached_insight = get_latest_insight()
    if cached_insight:
        insight_box.markdown(cached_insight)

st.markdown("---")


# --- Illness Early Warning ---


st.subheader("Illness Early Warning")

if illness_df.empty or illness_df["rhr_baseline"].isna().all():
    st.info("Need at least 8 days of data to compute illness baselines.")
else:
    latest = illness_df.iloc[-1]
    signal_count = int(latest["signal_count"])

    if latest["illness_flag"] and signal_count >= 3:
        st.error("🔴 High illness risk — 3+ signals elevated. Consider rest and monitor symptoms.")
    elif latest["illness_flag"] and signal_count == 2:
        st.warning("🟡 Elevated illness risk — 2 signals elevated. Watch for symptoms over next 24-48h.")
    elif signal_count == 1:
        st.info("🟠 One signal slightly elevated — not yet flagged, monitoring.")
    else:
        st.success("🟢 All signals normal.")

    if not latest["has_skin_temp"]:
        st.caption("⚠️ Signal based on RHR + HRV only (no skin temperature data). Weaker signal.")

    if latest["resp_rate_flag"]:
        st.caption("📋 Supporting indicator: respiratory rate also elevated above baseline.")

    _ill_cols = st.columns(4)
    with _ill_cols[0]:
        if pd.notna(latest["rhr"]) and pd.notna(latest["rhr_dev"]):
            st.metric("RHR", f"{latest['rhr']:.0f} bpm", delta=f"{latest['rhr_dev']:+.1f}", delta_color="inverse")
        else:
            st.metric("RHR", "—")
    with _ill_cols[1]:
        if pd.notna(latest["hrv"]) and pd.notna(latest["hrv_dev"]):
            st.metric("HRV", f"{latest['hrv']:.1f} ms", delta=f"{latest['hrv_dev']:+.1f}%", delta_color="normal")
        else:
            st.metric("HRV", "—")
    with _ill_cols[2]:
        if pd.notna(latest["skin_temp"]) and pd.notna(latest["skin_temp_dev"]):
            st.metric("Skin Temp", f"{latest['skin_temp']:.1f}°C", delta=f"{latest['skin_temp_dev']:+.2f}", delta_color="inverse")
        else:
            st.metric("Skin Temp", "—")
    with _ill_cols[3]:
        if pd.notna(latest["respiratory_rate"]) and pd.notna(latest["resp_rate_dev"]):
            st.metric("Resp Rate", f"{latest['respiratory_rate']:.1f} brpm", delta=f"{latest['resp_rate_dev']:+.1f}", delta_color="inverse")
        else:
            st.metric("Resp Rate", "—")


@st.fragment
def illness_charts():
    if illness_df.empty:
        return

    chart_df = illness_df.dropna(subset=["rhr_baseline"]).reset_index(drop=True)
    if chart_df.empty:
        return

    has_skin_temp = chart_df["skin_temp"].notna().any()
    has_resp_rate = chart_df["respiratory_rate"].notna().any()

    fig = make_subplots(
        rows=2, cols=2,
        subplot_titles=["RHR (BPM)", "HRV (ms)", "Skin Temp (°C)", "Resp Rate (brpm)"],
    )

    rhr_colors = ["#ff0000" if f else "#ff6b6b" for f in chart_df["rhr_flag"]]
    hrv_colors = ["#ff0000" if f else "#7b61ff" for f in chart_df["hrv_flag"]]

    fig.add_trace(go.Scatter(
        x=chart_df["date"], y=chart_df["rhr"],
        mode="lines+markers", name="RHR",
        line=dict(color="#ff6b6b", width=2),
        marker=dict(color=rhr_colors),
        showlegend=False,
    ), row=1, col=1)
    fig.add_trace(go.Scatter(
        x=chart_df["date"], y=chart_df["rhr_baseline"],
        mode="lines", name="RHR 14d avg",
        line=dict(color="#ff6b6b", width=1, dash="dash"),
        showlegend=False,
    ), row=1, col=1)
    fig.add_trace(go.Scatter(
        x=chart_df["date"], y=chart_df["rhr_baseline"] + 3,
        mode="lines", name="RHR threshold",
        line=dict(color="red", width=1, dash="dot"),
        showlegend=False,
    ), row=1, col=1)

    fig.add_trace(go.Scatter(
        x=chart_df["date"], y=chart_df["hrv"],
        mode="lines+markers", name="HRV",
        line=dict(color="#7b61ff", width=2),
        marker=dict(color=hrv_colors),
        showlegend=False,
    ), row=1, col=2)
    fig.add_trace(go.Scatter(
        x=chart_df["date"], y=chart_df["hrv_baseline"],
        mode="lines", name="HRV 14d avg",
        line=dict(color="#7b61ff", width=1, dash="dash"),
        showlegend=False,
    ), row=1, col=2)
    fig.add_trace(go.Scatter(
        x=chart_df["date"], y=chart_df["hrv_baseline"] * 0.90,
        mode="lines", name="HRV threshold",
        line=dict(color="red", width=1, dash="dot"),
        showlegend=False,
    ), row=1, col=2)

    if has_skin_temp:
        skin_data = chart_df.dropna(subset=["skin_temp", "skin_temp_baseline"])
        skin_colors = ["#ff0000" if f else "#ffaa00" for f in skin_data["skin_temp_flag"]]
        fig.add_trace(go.Scatter(
            x=skin_data["date"], y=skin_data["skin_temp"],
            mode="lines+markers", name="Skin Temp",
            line=dict(color="#ffaa00", width=2),
            marker=dict(color=skin_colors),
            showlegend=False,
        ), row=2, col=1)
        fig.add_trace(go.Scatter(
            x=skin_data["date"], y=skin_data["skin_temp_baseline"],
            mode="lines", name="Skin Temp 14d avg",
            line=dict(color="#ffaa00", width=1, dash="dash"),
            showlegend=False,
        ), row=2, col=1)
        fig.add_trace(go.Scatter(
            x=skin_data["date"], y=skin_data["skin_temp_baseline"] + 0.5,
            mode="lines", name="Skin Temp threshold",
            line=dict(color="red", width=1, dash="dot"),
            showlegend=False,
        ), row=2, col=1)
    else:
        fig.add_annotation(
            text="No skin temperature data",
            x=0.5, y=0.5, xref="x3 domain", yref="y3 domain",
            showarrow=False,
        )

    if has_resp_rate:
        resp_data = chart_df.dropna(subset=["respiratory_rate", "resp_rate_baseline"])
        resp_colors = ["#ff0000" if f else "#00aaff" for f in resp_data["resp_rate_flag"]]
        fig.add_trace(go.Scatter(
            x=resp_data["date"], y=resp_data["respiratory_rate"],
            mode="lines+markers", name="Resp Rate",
            line=dict(color="#00aaff", width=2),
            marker=dict(color=resp_colors),
            showlegend=False,
        ), row=2, col=2)
        fig.add_trace(go.Scatter(
            x=resp_data["date"], y=resp_data["resp_rate_baseline"],
            mode="lines", name="Resp Rate 14d avg",
            line=dict(color="#00aaff", width=1, dash="dash"),
            showlegend=False,
        ), row=2, col=2)
        fig.add_trace(go.Scatter(
            x=resp_data["date"], y=resp_data["resp_rate_baseline"] + 2,
            mode="lines", name="Resp Rate threshold",
            line=dict(color="red", width=1, dash="dot"),
            showlegend=False,
        ), row=2, col=2)
    else:
        fig.add_annotation(
            text="No respiratory rate data",
            x=0.5, y=0.5, xref="x4 domain", yref="y4 domain",
            showarrow=False,
        )

    flagged_dates = chart_df[chart_df["illness_flag"]]["date"].tolist()
    for d in flagged_dates:
        fig.add_vrect(
            x0=pd.Timestamp(d) - pd.Timedelta(hours=12),
            x1=pd.Timestamp(d) + pd.Timedelta(hours=12),
            fillcolor="red", opacity=0.15, line_width=0,
        )

    fig.update_layout(
        title="Illness Signal — Metrics vs 14-Day Baseline",
        height=500,
        margin=dict(t=60, b=40),
    )
    st.plotly_chart(fig, use_container_width=True)


illness_charts()

st.markdown("---")


# --- Recovery / HRV / RHR Charts ---


@st.fragment
def recovery_charts():
    if recovery_df.empty:
        st.info("No recovery data.")
        return

    col1, col2 = st.columns(2)

    with col1:
        fig = go.Figure()
        fig.add_hrect(y0=0, y1=33, fillcolor="red", opacity=0.1, line_width=0)
        fig.add_hrect(y0=33, y1=66, fillcolor="yellow", opacity=0.1, line_width=0)
        fig.add_hrect(y0=66, y1=100, fillcolor="green", opacity=0.1, line_width=0)
        fig.add_trace(
            go.Scatter(
                x=recovery_df["date"],
                y=recovery_df["recovery"],
                mode="lines+markers",
                name="Recovery",
                line=dict(color="#00d4aa", width=2),
            )
        )
        fig.update_layout(
            title="Recovery Trend",
            yaxis=dict(range=[0, 100], title="%"),
            xaxis_title="Date",
            height=350,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(fig, use_container_width=True)

    with col2:
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=recovery_df["date"],
                y=recovery_df["hrv"],
                mode="lines+markers",
                name="HRV",
                line=dict(color="#7b61ff", width=2),
            )
        )
        fig.update_layout(
            title="HRV Trend",
            yaxis_title="RMSSD (ms)",
            xaxis_title="Date",
            height=350,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(fig, use_container_width=True)

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=recovery_df["date"],
            y=recovery_df["rhr"],
            mode="lines+markers",
            name="RHR",
            line=dict(color="#ff6b6b", width=2),
        )
    )
    fig.update_layout(
        title="Resting Heart Rate",
        yaxis_title="BPM",
        xaxis_title="Date",
        height=300,
        margin=dict(t=40, b=40),
    )
    st.plotly_chart(fig, use_container_width=True)

    skin_temp_data = recovery_df.dropna(subset=["skin_temp"])
    if not skin_temp_data.empty:
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=skin_temp_data["date"],
                y=skin_temp_data["skin_temp"],
                mode="lines+markers",
                name="Skin Temp",
                line=dict(color="#ffaa00", width=2),
            )
        )
        fig.update_layout(
            title="Skin Temperature",
            yaxis_title="°C",
            xaxis_title="Date",
            height=300,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(fig, use_container_width=True)


recovery_charts()

st.markdown("---")


# --- Sleep Charts ---


@st.fragment
def sleep_charts():
    if sleep_df.empty:
        st.info("No sleep data.")
        return

    col1, col2 = st.columns(2)

    with col1:
        colors = [
            "#ff4444" if h < 6 else "#ffaa00" if h < 7 else "#00d4aa"
            for h in sleep_df["in_bed_hrs"] - sleep_df["awake_hrs"]
        ]
        fig = go.Figure()
        fig.add_trace(
            go.Bar(
                x=sleep_df["date"],
                y=sleep_df["in_bed_hrs"] - sleep_df["awake_hrs"],
                name="Sleep Duration",
                marker_color=colors,
            )
        )
        fig.add_trace(
            go.Scatter(
                x=sleep_df["date"],
                y=sleep_df["sleep_need_hrs"],
                mode="lines",
                name="Sleep Need",
                line=dict(color="white", width=2, dash="dash"),
            )
        )
        fig.update_layout(
            title="Sleep Duration vs Need",
            yaxis_title="Hours",
            xaxis_title="Date",
            height=350,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(fig, use_container_width=True)

    with col2:
        fig = go.Figure()
        for stage, color in [
            ("deep_hrs", "#0055ff"),
            ("rem_hrs", "#7b61ff"),
            ("light_hrs", "#00d4aa"),
            ("awake_hrs", "#ff6b6b"),
        ]:
            fig.add_trace(
                go.Bar(
                    x=sleep_df["date"],
                    y=sleep_df[stage],
                    name=stage.replace("_hrs", "").replace("_", " ").title(),
                )
            )
        fig.update_layout(
            title="Sleep Stages",
            barmode="stack",
            yaxis_title="Hours",
            xaxis_title="Date",
            height=350,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(fig, use_container_width=True)

    perf_data = sleep_df.dropna(subset=["performance"])
    if not perf_data.empty:
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=perf_data["date"],
                y=perf_data["performance"],
                mode="lines+markers",
                name="Performance",
                line=dict(color="#00d4aa", width=2),
            )
        )
        eff_data = sleep_df.dropna(subset=["efficiency"])
        if not eff_data.empty:
            fig.add_trace(
                go.Scatter(
                    x=eff_data["date"],
                    y=eff_data["efficiency"],
                    mode="lines+markers",
                    name="Efficiency",
                    line=dict(color="#7b61ff", width=2),
                )
            )
        cons_data = sleep_df.dropna(subset=["consistency"])
        if not cons_data.empty:
            fig.add_trace(
                go.Scatter(
                    x=cons_data["date"],
                    y=cons_data["consistency"],
                    mode="lines+markers",
                    name="Consistency",
                    line=dict(color="#ffaa00", width=2),
                )
            )
        fig.update_layout(
            title="Sleep Performance, Efficiency & Consistency",
            yaxis=dict(range=[0, 100], title="%"),
            xaxis_title="Date",
            height=300,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(fig, use_container_width=True)

    resp_data = sleep_df.dropna(subset=["respiratory_rate"])
    if not resp_data.empty:
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=resp_data["date"],
                y=resp_data["respiratory_rate"],
                mode="lines+markers",
                name="Respiratory Rate",
                line=dict(color="#00aaff", width=2),
            )
        )
        fig.update_layout(
            title="Respiratory Rate",
            yaxis_title="breaths/min",
            xaxis_title="Date",
            height=300,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(fig, use_container_width=True)

    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=sleep_df["date"],
            y=sleep_df["disturbances"],
            name="Disturbances",
            marker_color="#ff6b6b",
        )
    )
    fig.add_trace(
        go.Bar(
            x=sleep_df["date"],
            y=sleep_df["cycles"],
            name="Sleep Cycles",
            marker_color="#7b61ff",
        )
    )
    fig.update_layout(
        title="Sleep Disturbances & Cycles",
        barmode="group",
        yaxis_title="Count",
        xaxis_title="Date",
        height=300,
        margin=dict(t=40, b=40),
    )
    st.plotly_chart(fig, use_container_width=True)


sleep_charts()

st.markdown("---")


# --- Sleep Apnea Risk Signal ---


@st.fragment
def apnea_signal_section():
    st.subheader("Sleep Apnea Risk Signal")
    st.caption(
        "⚠️ This is a screening signal for awareness only — not a medical diagnosis. "
        "Consult a sleep specialist if concerned."
    )

    if apnea_df.empty:
        st.info("No sleep data available.")
        return

    if apnea_df["spo2"].isna().all():
        st.info("SpO2 data unavailable (requires WHOOP 4.0+). Apnea score uses 3 of 4 indicators.")

    latest = apnea_df.iloc[-1]
    score = int(latest["apnea_score"])
    score_label = "Low" if score == 0 else "Moderate" if score <= 2 else "High"
    rolling_score = int(latest["apnea_score_7d"])

    cutoff = apnea_df["date"].max() - timedelta(days=14)
    high_nights_14d = int((apnea_df[apnea_df["date"] >= cutoff]["apnea_score"] >= 2).sum())

    cols = st.columns(3)
    with cols[0]:
        st.metric("Tonight's Risk Score", f"{score}/4 ({score_label})")
    with cols[1]:
        st.metric("7-Night Rolling Score", f"{rolling_score}/28")
    with cols[2]:
        st.metric("High-Risk Nights (14d)", f"{high_nights_14d}")

    def bar_color(val):
        if val <= 3:
            return "#00d4aa"
        elif val <= 7:
            return "#ffaa00"
        elif val <= 14:
            return "#ff8c00"
        else:
            return "#ff4444"

    colors_7d = [bar_color(v) for v in apnea_df["apnea_score_7d"]]

    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=apnea_df["date"],
            y=apnea_df["apnea_score_7d"],
            marker_color=colors_7d,
            name="7-Night Rolling Score",
        )
    )
    fig.add_trace(
        go.Scatter(
            x=apnea_df["date"],
            y=[7] * len(apnea_df),
            mode="lines",
            name="Elevated Threshold",
            line=dict(color="white", width=1, dash="dash"),
        )
    )
    fig.update_layout(
        title="7-Night Rolling Apnea Risk Score",
        yaxis_title="Cumulative Score",
        xaxis_title="Date",
        height=350,
        margin=dict(t=40, b=40),
    )
    st.plotly_chart(fig, use_container_width=True)

    fig2 = go.Figure()
    for col, color, name in [
        ("flag_disturbances", "#ff6b6b", "Disturbances >10"),
        ("flag_spo2", "#ffaa00", "SpO2 <95%"),
        ("flag_resp_rate", "#00aaff", "Resp Rate Elevated"),
        ("flag_deep_sleep", "#7b61ff", "Deep Sleep <15%"),
    ]:
        fig2.add_trace(
            go.Bar(
                x=apnea_df["date"],
                y=apnea_df[col],
                name=name,
                marker_color=color,
            )
        )
    fig2.update_layout(
        title="Nightly Apnea Risk Flags",
        barmode="stack",
        yaxis=dict(range=[0, 4], title="Flags"),
        xaxis_title="Date",
        height=300,
        margin=dict(t=40, b=40),
    )
    st.plotly_chart(fig2, use_container_width=True)


apnea_signal_section()

st.markdown("---")


# --- Strain + Workout Charts ---


@st.fragment
def strain_workout_section():
    col1, col2 = st.columns(2)

    with col1:
        if cycle_df.empty:
            st.info("No strain data.")
        else:
            fig = go.Figure()
            fig.add_trace(
                go.Bar(
                    x=cycle_df["date"],
                    y=cycle_df["strain"],
                    marker_color="#ffaa00",
                    name="Strain",
                )
            )
            fig.update_layout(
                title="Daily Strain",
                yaxis=dict(range=[0, 21], title="Strain"),
                xaxis_title="Date",
                height=350,
                margin=dict(t=40, b=40),
            )
            st.plotly_chart(fig, use_container_width=True)

    with col2:
        if workout_df.empty:
            st.info("No workout data.")
        else:
            zone_cols = [f"zone_{i}_min" for i in range(6)]
            zone_names = [
                "Very Light",
                "Light",
                "Moderate",
                "Hard",
                "Very Hard",
                "Max",
            ]
            zone_colors = [
                "#666666",
                "#00d4aa",
                "#00aaff",
                "#ffaa00",
                "#ff6b6b",
                "#ff0000",
            ]
            fig = go.Figure()
            for col, name, color in zip(zone_cols, zone_names, zone_colors):
                if col in workout_df.columns:
                    fig.add_trace(
                        go.Bar(
                            x=workout_df["sport"]
                            + " ("
                            + workout_df["date"].astype(str)
                            + ")",
                            y=workout_df[col],
                            name=name,
                            marker_color=color,
                        )
                    )
            fig.update_layout(
                title="Workout HR Zones",
                barmode="stack",
                yaxis_title="Minutes",
                xaxis_title="Workout",
                height=350,
                margin=dict(t=40, b=40),
            )
            st.plotly_chart(fig, use_container_width=True)

    if not workout_df.empty:
        st.subheader("Recent Workouts")
        display_cols = [
            "date",
            "sport",
            "duration_min",
            "avg_hr",
            "max_hr",
            "strain",
            "calories",
        ]
        if "distance_m" in workout_df.columns:
            display_cols.append("distance_m")
        if "altitude_gain_m" in workout_df.columns:
            display_cols.append("altitude_gain_m")
        st.dataframe(
            workout_df[display_cols],
            use_container_width=True,
            hide_index=True,
        )


strain_workout_section()
