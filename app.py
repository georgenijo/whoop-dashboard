import os
from datetime import datetime, timedelta, timezone

import pandas as pd
import plotly.graph_objects as go
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
        rows.append(row)
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("date", ascending=False).reset_index(drop=True)
    return df


recovery_df = build_recovery_df(data["recovery"])
cycle_df = build_cycle_df(data["cycles"])
sleep_df = build_sleep_df(data["sleep"])
workout_df = build_workout_df(data["workouts"])


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
        fig.update_layout(
            title="Sleep Performance & Efficiency",
            yaxis=dict(range=[0, 100], title="%"),
            xaxis_title="Date",
            height=300,
            margin=dict(t=40, b=40),
        )
        st.plotly_chart(fig, use_container_width=True)


sleep_charts()

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
        st.dataframe(
            workout_df[display_cols],
            use_container_width=True,
            hide_index=True,
        )


strain_workout_section()
