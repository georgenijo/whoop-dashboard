import os
from datetime import datetime, timedelta, timezone

import numpy as np
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
from whoop.db import init_db, sync_all, get_latest_insight, get_workout_history
from whoop.insights import generate_insight
from whoop.ots import calculate_overtraining_score

load_dotenv()
import logging

_log_dir = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(_log_dir, exist_ok=True)

ui_logger = logging.getLogger("whoop.ui")
_ui_handler = logging.FileHandler(os.path.join(_log_dir, "ui.log"))
_ui_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", "%Y-%m-%d %H:%M:%S"))
ui_logger.addHandler(_ui_handler)
ui_logger.setLevel(logging.INFO)

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
        df["ans_index"] = df["hrv"] / df["rhr"].replace(0, pd.NA)
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
        start_dt = parse_date(r["start"])
        end_dt = parse_date(r["end"])
        bedtime_h = start_dt.hour + start_dt.minute / 60
        if bedtime_h < 12:
            bedtime_h += 24  # normalize midnight-crossers (e.g., 1am → 25)
        rows.append(
            {
                "date": start_dt.date(),
                "start_time": start_dt,
                "end_time": end_dt,
                "bedtime_hour": bedtime_h,
                "wake_hour": end_dt.hour + end_dt.minute / 60,
                "is_weekend": start_dt.weekday() >= 5,
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


def build_nap_df(records: list) -> pd.DataFrame:
    rows = []
    for r in scored(records):
        if not r.get("nap"):
            continue
        s = r["score"]
        ss = s["stage_summary"]
        start = parse_date(r["start"])
        end = parse_date(r["end"])
        duration_min = (end - start).total_seconds() / 60
        rows.append({
            "date": start.date(),
            "start_time": start,
            "end_time": end,
            "duration_min": round(duration_min, 1),
            "start_hour": start.hour + start.minute / 60,
            "sleep_need_reduction_hrs": ms_to_hours(
                s["sleep_needed"].get("need_from_recent_nap_milli", 0)
            ),
        })
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


def compute_rebound_events(df: pd.DataFrame) -> pd.DataFrame:
    empty = pd.DataFrame(columns=["red_date", "green_date", "days_to_rebound"])
    if df.empty or len(df) < 2:
        return empty

    is_red = df["recovery"] < 33
    streak_start = is_red & ~is_red.shift(1, fill_value=False)
    start_indices = df.index[streak_start].tolist()

    events = []
    for idx in start_indices:
        red_date = df.loc[idx, "date"]
        subsequent = df[df.index > idx]
        green_rows = subsequent[subsequent["recovery"] > 66]
        if green_rows.empty:
            continue
        green_date = green_rows.iloc[0]["date"]
        days_to_rebound = (green_date - red_date).days
        events.append({"red_date": red_date, "green_date": green_date, "days_to_rebound": days_to_rebound})

    if not events:
        return empty
    return pd.DataFrame(events)


def detect_cardiac_drift(workout_history: list[dict]) -> dict:
    if not workout_history:
        return {}

    df = pd.DataFrame(workout_history)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df = df.dropna(subset=["avg_hr", "duration_sec"])

    if df.empty:
        return {}

    results = {}
    for sport, group in df.groupby("sport"):
        group = group.copy().reset_index(drop=True)
        median_dur = group["duration_sec"].median()
        lo, hi = median_dur * 0.75, median_dur * 1.25
        group = group[(group["duration_sec"] >= lo) & (group["duration_sec"] <= hi)]

        if len(group) < 3:
            continue

        min_date = group["date"].min()
        max_date = group["date"].max()
        date_span = (max_date - min_date).days

        if date_span < 28:
            continue

        ordinals = np.array([d.toordinal() for d in group["date"]])
        avg_hrs = group["avg_hr"].values.astype(float)

        coeffs = np.polyfit(ordinals, avg_hrs, 1)
        slope = coeffs[0]
        intercept = coeffs[1]

        y_pred = slope * ordinals + intercept
        y_mean = avg_hrs.mean()
        ss_res = np.sum((avg_hrs - y_pred) ** 2)
        ss_tot = np.sum((avg_hrs - y_mean) ** 2)

        if ss_tot == 0:
            r_squared = 0.0
            slope = 0.0
            intercept = float(avg_hrs[0])
        else:
            r_squared = 1 - ss_res / ss_tot

        slope_per_28d = slope * 28
        drift_detected = slope_per_28d > 5.0

        results[sport] = {
            "sport": sport,
            "slope": slope,
            "slope_per_28d": slope_per_28d,
            "intercept": intercept,
            "r_squared": r_squared,
            "drift_detected": drift_detected,
            "workout_count": len(group),
            "date_span_days": date_span,
            "dates": group["date"].tolist(),
            "avg_hrs": avg_hrs.tolist(),
            "ordinals": ordinals.tolist(),
        }

    return results


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
nap_df = build_nap_df(data["sleep"])
workout_df = build_workout_df(data["workouts"])
apnea_df = build_apnea_df(sleep_df, recovery_df)
illness_df = compute_illness_signal(recovery_df, sleep_df)


@st.cache_data(ttl=600)
def _cached_workout_history():
    return get_workout_history()


_workout_history = _cached_workout_history()
drift_results = detect_cardiac_drift(_workout_history)


# --- Section Functions ---


@st.fragment
def ots_card():
    result = calculate_overtraining_score(recovery_df, cycle_df)
    if result is None:
        st.info("Overtraining detection needs 7+ days of data.")
        return

    level = result["level"]
    if level == "low":
        st.success(result["label"])
    elif level == "moderate":
        st.warning(result["label"])
    else:
        st.error(result["label"])

    sparkline_fig = go.Figure()
    sparkline_fig.add_trace(go.Scatter(
        x=result["window"]["date"],
        y=result["window"]["recovery"],
        mode="lines",
        line=dict(color=result["color"], width=2),
    ))
    sparkline_fig.update_layout(
        height=100,
        margin=dict(t=10, b=10, l=10, r=10),
        xaxis=dict(visible=False),
        yaxis=dict(visible=False),
        showlegend=False,
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
    )
    st.plotly_chart(sparkline_fig, use_container_width=True)

    with st.expander("OTS Details"):
        slopes = result["slopes"]
        signals = result["signals"]
        detail_cols = st.columns(4)
        with detail_cols[0]:
            st.metric("HRV Slope", f"{slopes['hrv']:+.2f} ms/day",
                      delta="firing" if signals["hrv"] else "ok",
                      delta_color="inverse" if signals["hrv"] else "normal")
        with detail_cols[1]:
            st.metric("RHR Slope", f"{slopes['rhr']:+.2f} bpm/day",
                      delta="firing" if signals["rhr"] else "ok",
                      delta_color="inverse" if signals["rhr"] else "normal")
        with detail_cols[2]:
            st.metric("Recovery Slope", f"{slopes['recovery']:+.2f} %/day",
                      delta="firing" if signals["recovery"] else "ok",
                      delta_color="inverse" if signals["recovery"] else "normal")
        with detail_cols[3]:
            strain_note = "sustained" if signals["strain_elevated"] else "dropping"
            st.metric("Strain Slope", f"{slopes['strain']:+.2f} /day", delta=strain_note)

        w = result["window"]
        norm_fig = go.Figure()
        for col, color, name in [
            ("hrv", "#7b61ff", "HRV"),
            ("rhr", "#ff6b6b", "RHR"),
            ("recovery", "#00d4aa", "Recovery"),
            ("strain", "#ffaa00", "Strain"),
        ]:
            vals = w[col].values.astype(float)
            lo, hi = vals.min(), vals.max()
            normed = (vals - lo) / (hi - lo) if hi != lo else vals * 0
            norm_fig.add_trace(go.Scatter(
                x=w["date"], y=normed, mode="lines+markers",
                name=name, line=dict(color=color, width=2),
            ))
        norm_fig.update_layout(
            title="7-Day Normalized Trends",
            yaxis_title="Normalized (0–1)",
            xaxis_title="Date",
            height=250,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(norm_fig, use_container_width=True)


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

    ans_data = recovery_df.dropna(subset=["ans_index"])
    if not ans_data.empty:
        ans_rolling = ans_data["ans_index"].rolling(7, min_periods=1).mean()
        ans_mean = ans_data["ans_index"].mean()
        ans_std = ans_data["ans_index"].std()
        baseline_upper = ans_mean + ans_std
        baseline_lower = ans_mean - ans_std
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=ans_data["date"], y=[baseline_lower] * len(ans_data),
            mode="lines", line=dict(width=0), showlegend=False, hoverinfo="skip",
        ))
        fig.add_trace(go.Scatter(
            x=ans_data["date"], y=[baseline_upper] * len(ans_data),
            mode="lines", line=dict(width=0), fill="tonexty",
            fillcolor="rgba(123, 97, 255, 0.12)", name="Baseline ±1σ", hoverinfo="skip",
        ))
        fig.add_trace(go.Scatter(
            x=ans_data["date"], y=ans_data["ans_index"],
            mode="lines+markers", name="ANS Index",
            line=dict(color="#7b61ff", width=2),
        ))
        fig.add_trace(go.Scatter(
            x=ans_data["date"], y=ans_rolling,
            mode="lines", name="7d Avg",
            line=dict(color="#ffaa00", width=2, dash="dash"),
        ))
        fig.update_layout(
            title="Autonomic Balance (HRV/RHR)",
            yaxis_title="ANS Index",
            xaxis_title="Date",
            height=350,
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


@st.fragment
def rebound_charts():
    rebound_df = compute_rebound_events(recovery_df)
    if rebound_df.empty:
        st.info("No red → green rebound events in this window. Try extending the history slider.")
        return

    st.subheader("Recovery Rebound Rate")
    cols = st.columns(3)
    with cols[0]:
        st.metric("Avg Rebound", f"{rebound_df['days_to_rebound'].mean():.1f} days")
    with cols[1]:
        st.metric("Fastest Rebound", f"{rebound_df['days_to_rebound'].min()} days")
    with cols[2]:
        st.metric("Rebound Events", f"{len(rebound_df)}")

    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=rebound_df["red_date"],
        y=rebound_df["days_to_rebound"],
        marker_color="#7b61ff",
        hovertemplate="Red: %{x}<br>Days to green: %{y}<extra></extra>",
    ))
    fig.update_layout(
        title="Recovery Rebound Duration",
        yaxis_title="Days",
        xaxis_title="Red Recovery Date",
        height=300,
        margin=dict(t=40, b=40),
        bargap=0.3,
    )
    st.plotly_chart(fig, use_container_width=True)
    st.caption("Rebound = days from first red day (<33%) to first green day (>66%). Lower is better.")


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
        resp_data = resp_data.copy()
        resp_data["rr_rolling_mean"] = resp_data["respiratory_rate"].rolling(14, min_periods=1).mean()
        resp_data["rr_upper"] = resp_data["rr_rolling_mean"] + 2.0
        resp_data["rr_lower"] = resp_data["rr_rolling_mean"] - 2.0
        resp_data["rr_anomaly"] = (resp_data["respiratory_rate"] - resp_data["rr_rolling_mean"]).abs() > 2.0
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=resp_data["date"], y=resp_data["rr_lower"],
            mode="lines", line=dict(width=0), showlegend=False, hoverinfo="skip",
        ))
        fig.add_trace(go.Scatter(
            x=resp_data["date"], y=resp_data["rr_upper"],
            mode="lines", line=dict(width=0), fill="tonexty",
            fillcolor="rgba(0,170,255,0.12)", name="±2 bpm band", showlegend=True, hoverinfo="skip",
        ))
        fig.add_trace(go.Scatter(
            x=resp_data["date"], y=resp_data["rr_rolling_mean"],
            mode="lines", name="14-day Avg",
            line=dict(color="#00aaff", width=1, dash="dash"),
            hovertemplate="Avg: %{y:.1f} bpm<extra></extra>",
        ))
        fig.add_trace(go.Scatter(
            x=resp_data["date"], y=resp_data["respiratory_rate"],
            mode="lines+markers", name="Respiratory Rate",
            line=dict(color="#00aaff", width=2),
        ))
        anomalies = resp_data[resp_data["rr_anomaly"]]
        if not anomalies.empty:
            fig.add_trace(go.Scatter(
                x=anomalies["date"], y=anomalies["respiratory_rate"],
                mode="markers", name="Anomaly",
                marker=dict(color="#ff4444", size=10, symbol="diamond"),
                hovertemplate="Anomaly: %{y:.1f} bpm<extra></extra>",
            ))
        fig.update_layout(
            title="Respiratory Rate (14-day baseline ± 2 bpm)",
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


@st.fragment
def deep_sleep_efficiency_chart():
    if sleep_df.empty or cycle_df.empty:
        st.info("Not enough data for deep sleep efficiency.")
        return

    strain_shifted = cycle_df[["date", "strain"]].copy()
    strain_shifted["date"] = strain_shifted["date"] + timedelta(days=1)

    merged = pd.merge(sleep_df[["date", "deep_hrs"]], strain_shifted, on="date", how="inner")
    merged = merged[merged["strain"] > 0]
    merged = pd.merge(merged, recovery_df[["date", "recovery"]], on="date", how="left")
    merged["deep_sleep_efficiency"] = merged["deep_hrs"] / merged["strain"]

    if len(merged) < 2:
        st.info("Not enough matched data for deep sleep efficiency chart.")
        return

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=merged["strain"],
        y=merged["deep_hrs"],
        mode="markers",
        marker=dict(
            size=10,
            color=merged["recovery"],
            colorscale="RdYlGn",
            showscale=True,
            colorbar=dict(title="Recovery"),
            cmin=0,
            cmax=100,
        ),
        customdata=merged["deep_sleep_efficiency"],
        hovertemplate="Strain: %{x:.1f}<br>Deep Sleep: %{y:.2f} hrs<br>Efficiency: %{customdata:.2f} hrs/strain<extra></extra>",
        name="Deep Sleep vs Strain",
    ))

    z = np.polyfit(merged["strain"], merged["deep_hrs"], 1)
    p = np.poly1d(z)
    x_line = np.linspace(merged["strain"].min(), merged["strain"].max(), 50)
    fig.add_trace(go.Scatter(
        x=x_line, y=p(x_line),
        mode="lines", name="Trend",
        line=dict(color="#888", dash="dash", width=2),
        hoverinfo="skip",
    ))

    fig.update_layout(
        title="Deep Sleep vs. Previous Day Strain",
        xaxis_title="Previous Day Strain",
        yaxis_title="Deep Sleep (hrs)",
        height=350,
        margin=dict(t=40, b=40),
        showlegend=False,
    )
    st.plotly_chart(fig, use_container_width=True)


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


@st.fragment
def strain_recovery_balance_section():
    if recovery_df.empty or cycle_df.empty:
        st.info("Not enough data for strain-recovery balance chart.")
        return

    merged = pd.merge(
        recovery_df[["date", "recovery"]],
        cycle_df[["date", "strain"]],
        on="date",
        how="inner",
    ).dropna()

    if merged.empty:
        st.info("Not enough data for strain-recovery balance chart.")
        return

    merged = merged.sort_values("date").reset_index(drop=True)
    merged["strain_norm"] = merged["strain"] / 21 * 100
    merged["delta"] = merged["recovery"] - merged["strain_norm"]

    st.subheader("Strain-Recovery Balance")
    window = st.select_slider("Balance window (days)", options=[7, 14, 30, 60, 90], value=30)
    window = min(window, len(merged))
    windowed = merged.tail(window).copy()
    windowed["balance"] = windowed["delta"].cumsum()

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=windowed["date"],
        y=windowed["balance"],
        mode="lines",
        name="Balance",
        line=dict(color="#7b61ff", width=2),
        fill="tozeroy",
        fillcolor="rgba(123, 97, 255, 0.15)",
    ))
    fig.add_hline(y=0, line_dash="dash", line_color="white", opacity=0.4)
    fig.update_layout(
        title="Cumulative Strain-Recovery Balance",
        yaxis_title="Balance",
        xaxis_title="Date",
        height=400,
        margin=dict(t=40, b=40),
    )
    st.plotly_chart(fig, use_container_width=True)
    st.caption("Positive = recovery surplus · Negative = recovery debt · Reset each window")


@st.fragment
def cardiac_drift_section():
    st.subheader("Cardiac Drift Detection")
    st.caption(
        "Tracks average HR trends per sport over similar-duration workouts. "
        "Drift flagged when avg HR rises >5 bpm over 4 weeks."
    )

    if not drift_results:
        st.info("Not enough workout history for drift detection. Need 3+ workouts of similar duration per sport spanning 4+ weeks.")
        return

    sport = st.selectbox("Sport", options=sorted(drift_results.keys()))
    res = drift_results[sport]

    slope_per_28d = res["slope_per_28d"]
    cols = st.columns(4)
    with cols[0]:
        st.metric("HR Trend (4 wk)", f"{slope_per_28d:+.1f} bpm",
                  delta=f"{slope_per_28d:+.1f}", delta_color="inverse")
    with cols[1]:
        st.metric("Workouts Analyzed", res["workout_count"])
    with cols[2]:
        st.metric("Date Span", f"{res['date_span_days']} days")
    with cols[3]:
        st.metric("R²", f"{res['r_squared']:.2f}")

    if res["drift_detected"]:
        st.warning(f"Cardiac drift detected in {sport}: avg HR rising {slope_per_28d:+.1f} bpm per 4 weeks.")

    import datetime as _dt
    dates = res["dates"]
    avg_hrs = res["avg_hrs"]
    ordinals = res["ordinals"]
    slope = res["slope"]
    intercept = res["intercept"]

    min_ord, max_ord = min(ordinals), max(ordinals)
    trend_y = [intercept + slope * min_ord, intercept + slope * max_ord]
    trend_x = [_dt.date.fromordinal(min_ord), _dt.date.fromordinal(max_ord)]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=dates, y=avg_hrs,
        mode="markers", name="Avg HR",
        marker=dict(color="#00aaff", size=8),
    ))
    trend_color = "#ff6b6b" if res["drift_detected"] else "#00d4aa"
    fig.add_trace(go.Scatter(
        x=trend_x, y=trend_y,
        mode="lines", name="Trend",
        line=dict(color=trend_color, width=2, dash="dash"),
    ))
    if res["drift_detected"]:
        fig.add_annotation(
            x=trend_x[1], y=trend_y[1],
            text="Drift detected",
            showarrow=True, arrowhead=2,
            font=dict(color="#ff0000"),
        )
    fig.update_layout(
        title=f"Avg HR Over Time — {sport}",
        yaxis_title="Avg HR (bpm)",
        xaxis_title="Date",
        height=400,
        margin=dict(t=40, b=40),
    )
    st.plotly_chart(fig, use_container_width=True)


# --- Sleep Deep Dive Sections ---


@st.fragment
def nap_tracker_section():
    st.subheader("Nap Tracker")

    if nap_df.empty or len(nap_df) < 2:
        st.info("Not enough nap data for trend charts (need 2+ nap records).")
        if not nap_df.empty:
            st.metric("Total Naps", len(nap_df))
            st.metric("Avg Duration", f"{nap_df['duration_min'].mean():.0f} min")
        return

    kpi_cols = st.columns(3)
    with kpi_cols[0]:
        st.metric("Total Naps", len(nap_df))
    with kpi_cols[1]:
        st.metric("Avg Duration", f"{nap_df['duration_min'].mean():.0f} min")
    with kpi_cols[2]:
        avg_reduction = nap_df["sleep_need_reduction_hrs"].mean()
        st.metric("Avg Sleep Need Reduction", f"{avg_reduction:.2f} hrs")

    # Nap timing scatter
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=nap_df["date"],
        y=nap_df["start_hour"],
        mode="markers",
        marker=dict(
            size=nap_df["duration_min"] / 5,
            color="#7b61ff",
            opacity=0.8,
        ),
        hovertemplate="Date: %{x}<br>Start: %{y:.1f}h<br>Duration: %{text} min<extra></extra>",
        text=nap_df["duration_min"].astype(int),
        name="Nap",
    ))
    fig.update_layout(
        title="Nap Timing (bubble size = duration)",
        xaxis_title="Date",
        yaxis_title="Hour of Day",
        yaxis=dict(tickvals=list(range(8, 22)), ticktext=[f"{h}:00" for h in range(8, 22)]),
        height=350,
        margin=dict(t=40, b=40),
    )
    st.plotly_chart(fig, use_container_width=True)

    # Nap impact on next-night sleep
    if len(nap_df) >= 3 and not sleep_df.empty:
        nap_dates = set(nap_df["date"].astype(str))
        sleep_copy = sleep_df.copy()
        sleep_copy["prev_date"] = (
            pd.to_datetime(sleep_copy["date"]) - pd.Timedelta(days=1)
        ).dt.date.astype(str)
        sleep_copy["had_nap"] = sleep_copy["prev_date"].isin(nap_dates)

        with_nap = sleep_copy[sleep_copy["had_nap"]]
        without_nap = sleep_copy[~sleep_copy["had_nap"]]

        if not with_nap.empty and not without_nap.empty:
            st.subheader("Next-Night Sleep After Nap")
            cmp_cols = st.columns(3)
            for i, (metric, label, fmt) in enumerate([
                ("performance", "Sleep Performance", "{:.0f}%"),
                ("efficiency", "Sleep Efficiency", "{:.0f}%"),
                ("deep_hrs", "Deep Sleep (hrs)", "{:.2f}"),
            ]):
                with cmp_cols[i]:
                    wn = with_nap[metric].dropna().mean()
                    wo = without_nap[metric].dropna().mean()
                    if pd.notna(wn) and pd.notna(wo):
                        st.metric(
                            label,
                            f"After nap: {fmt.format(wn)}",
                            delta=f"{wn - wo:+.1f} vs no nap",
                        )


@st.fragment
def bedtime_patterns_section():
    st.subheader("Bedtime & Wake Time Patterns")

    if sleep_df.empty or len(sleep_df) < 5:
        st.info("Need 5+ sleep records for bedtime pattern analysis.")
        return

    df = sleep_df[["date", "bedtime_hour", "wake_hour", "is_weekend",
                   "in_bed_hrs", "awake_hrs"]].copy()
    df["actual_sleep_hrs"] = df["in_bed_hrs"] - df["awake_hrs"]

    # Consistency KPIs
    bt_std = df["bedtime_hour"].std() * 60  # convert to minutes
    wake_std = df["wake_hour"].std() * 60
    kpi_cols = st.columns(3)
    with kpi_cols[0]:
        st.metric("Bedtime Std Dev", f"{bt_std:.0f} min")
    with kpi_cols[1]:
        st.metric("Wake Time Std Dev", f"{wake_std:.0f} min")
    with kpi_cols[2]:
        weekend_df = df[df["is_weekend"]]
        weekday_df = df[~df["is_weekend"]]
        if not weekend_df.empty and not weekday_df.empty:
            social_jet_lag = (weekend_df["bedtime_hour"].mean() - weekday_df["bedtime_hour"].mean()) * 60
            st.metric("Weekend Bedtime Shift", f"{social_jet_lag:+.0f} min")

    # Bedtime + wake scatter with rolling mean
    df_sorted = df.sort_values("date").reset_index(drop=True)
    rolling_bt = df_sorted["bedtime_hour"].rolling(7, min_periods=1).mean()
    rolling_wake = df_sorted["wake_hour"].rolling(7, min_periods=1).mean()

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df_sorted["date"], y=df_sorted["bedtime_hour"],
        mode="markers", name="Bedtime",
        marker=dict(color="#7b61ff", size=7, opacity=0.7),
        hovertemplate="Date: %{x}<br>Bedtime: %{y:.2f}h<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=df_sorted["date"], y=rolling_bt,
        mode="lines", name="Bedtime 7d avg",
        line=dict(color="#7b61ff", width=2, dash="dash"),
    ))
    fig.add_trace(go.Scatter(
        x=df_sorted["date"], y=df_sorted["wake_hour"],
        mode="markers", name="Wake Time",
        marker=dict(color="#00d4aa", size=7, opacity=0.7),
        hovertemplate="Date: %{x}<br>Wake: %{y:.2f}h<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=df_sorted["date"], y=rolling_wake,
        mode="lines", name="Wake 7d avg",
        line=dict(color="#00d4aa", width=2, dash="dash"),
    ))

    def _hour_to_label(h):
        h_mod = h % 24
        return f"{int(h_mod):02d}:00"

    tick_range = list(range(int(df_sorted["bedtime_hour"].min()), int(df_sorted["wake_hour"].max()) + 2))
    fig.update_layout(
        title="Bedtime & Wake Time Over Time",
        xaxis_title="Date",
        yaxis_title="Time of Day",
        yaxis=dict(
            tickvals=tick_range,
            ticktext=[_hour_to_label(h) for h in tick_range],
        ),
        height=400,
        margin=dict(t=40, b=40),
    )
    st.plotly_chart(fig, use_container_width=True)

    # Weekend vs weekday comparison
    if not weekend_df.empty and not weekday_df.empty:
        st.subheader("Weekday vs Weekend")
        cmp_cols = st.columns(3)
        with cmp_cols[0]:
            wd_bt = weekday_df["bedtime_hour"].mean()
            we_bt = weekend_df["bedtime_hour"].mean()
            st.metric("Avg Bedtime", f"WD {_hour_to_label(wd_bt)} / WE {_hour_to_label(we_bt)}")
        with cmp_cols[1]:
            wd_wk = weekday_df["wake_hour"].mean()
            we_wk = weekend_df["wake_hour"].mean()
            st.metric("Avg Wake", f"WD {_hour_to_label(wd_wk)} / WE {_hour_to_label(we_wk)}")
        with cmp_cols[2]:
            wd_sl = weekday_df["actual_sleep_hrs"].mean()
            we_sl = weekend_df["actual_sleep_hrs"].mean()
            st.metric("Avg Sleep", f"WD {wd_sl:.1f}h / WE {we_sl:.1f}h")

    # Bedtime deviation vs next-day recovery
    if not recovery_df.empty:
        bt_mean = df["bedtime_hour"].mean()
        df["bt_dev_min"] = (df["bedtime_hour"] - bt_mean) * 60
        next_day = df[["date", "bt_dev_min"]].copy()
        next_day["date"] = (
            pd.to_datetime(next_day["date"]) + pd.Timedelta(days=1)
        ).dt.date
        merged = pd.merge(next_day, recovery_df[["date", "recovery"]], on="date", how="inner")

        if len(merged) >= 5:
            corr = merged["bt_dev_min"].corr(merged["recovery"])
            fig2 = go.Figure()
            fig2.add_trace(go.Scatter(
                x=merged["bt_dev_min"],
                y=merged["recovery"],
                mode="markers",
                marker=dict(color="#ffaa00", size=8, opacity=0.8),
                hovertemplate="Bedtime dev: %{x:.0f} min<br>Recovery: %{y:.0f}%<extra></extra>",
            ))
            z = np.polyfit(merged["bt_dev_min"], merged["recovery"], 1)
            p = np.poly1d(z)
            x_line = np.linspace(merged["bt_dev_min"].min(), merged["bt_dev_min"].max(), 50)
            fig2.add_trace(go.Scatter(
                x=x_line, y=p(x_line),
                mode="lines", name="Trend",
                line=dict(color="#888", dash="dash", width=2),
                hoverinfo="skip",
            ))
            fig2.update_layout(
                title=f"Bedtime Deviation vs Next-Day Recovery (r={corr:.2f})",
                xaxis_title="Bedtime Deviation from Personal Mean (min)",
                yaxis_title="Recovery (%)",
                height=350,
                margin=dict(t=40, b=40),
                showlegend=False,
            )
            st.plotly_chart(fig2, use_container_width=True)
            st.caption(
                "Negative = earlier than usual · Positive = later than usual. "
                f"Correlation with next-day recovery: r={corr:.2f}"
            )


# --- Tabs ---

from whoop.chat import send_chat_message

tab_dashboard, tab_sleep, tab_chat = st.tabs(["Dashboard", "Sleep Deep Dive", "Chat"])

with tab_dashboard:
    st.markdown("---")

    # --- KPI Row (always visible) ---
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

    # --- AI Insights (collapsible, default open) ---
    with st.expander("AI Insights", expanded=True):
        insight_box = st.empty()
        if st.button("Generate Fresh Insights"):
            with st.spinner("Claude is analyzing your data..."):
                insight = generate_insight(days)
            insight_box.markdown(insight)
        else:
            cached_insight = get_latest_insight()
            if cached_insight:
                insight_box.markdown(cached_insight)

    # --- Recovery (collapsible, default open) ---
    with st.expander("Recovery", expanded=True):
        recovery_charts()

        st.markdown("---")
        rebound_charts()

        st.markdown("---")
        st.subheader("Overtraining Risk")
        ots_card()

        st.markdown("---")
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

        illness_charts()

    # --- Sleep (collapsible, default open) ---
    with st.expander("Sleep", expanded=True):
        quality_gaps = detect_sleep_quality_gaps(sleep_df)
        if quality_gaps:
            st.subheader("⚠️ Sleep Quality Alerts")
        render_sleep_quality_alerts(quality_gaps)

        sleep_charts()

        st.markdown("---")
        deep_sleep_efficiency_chart()

        st.markdown("---")
        apnea_signal_section()

    # --- Strain & Workouts (collapsible, default open) ---
    with st.expander("Strain & Workouts", expanded=True):
        strain_workout_section()

        st.markdown("---")
        strain_recovery_balance_section()

        st.markdown("---")
        cardiac_drift_section()


with tab_sleep:
    nap_tracker_section()
    st.markdown("---")
    bedtime_patterns_section()


with tab_chat:
    st.subheader("Chat with your Whoop data")

    chips = [
        "Why was recovery low today?",
        "Compare this week vs last",
        "What should I do today?",
        "Analyze my sleep patterns",
    ]
    chip_cols = st.columns(len(chips))
    for i, chip in enumerate(chips):
        with chip_cols[i]:
            if st.button(chip, key=f"chip_{i}"):
                st.session_state.chat_pending = chip

    if "messages" not in st.session_state:
        st.session_state.messages = []

    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    user_input = st.chat_input("Ask about your data...")

    if "chat_pending" in st.session_state:
        user_input = st.session_state.pop("chat_pending")

    if user_input:
        ui_logger.info("CHAT_INPUT | message=%s", user_input[:200])
        st.session_state.messages.append({"role": "user", "content": user_input})
        with st.chat_message("user"):
            st.markdown(user_input)

        with st.chat_message("assistant"):
            with st.spinner("Thinking..."):
                response = send_chat_message(
                    user_input, st.session_state.messages[:-1], days
                )
            st.markdown(response)

        st.session_state.messages.append({"role": "assistant", "content": response})
        st.rerun()
