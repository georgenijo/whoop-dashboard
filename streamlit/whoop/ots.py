import numpy as np
import pandas as pd


def _slope(y_values: np.ndarray) -> float:
    return np.polyfit(np.arange(len(y_values)), y_values, 1)[0]


def calculate_overtraining_score(recovery_df: pd.DataFrame, cycle_df: pd.DataFrame) -> dict | None:
    if recovery_df.empty or cycle_df.empty:
        return None

    merged = pd.merge(
        recovery_df[["date", "hrv", "rhr", "recovery"]],
        cycle_df[["date", "strain"]],
        on="date",
        how="inner",
    )
    merged = merged.dropna(subset=["hrv", "rhr", "recovery", "strain"])

    if len(merged) < 7:
        return None

    window = merged.tail(7).reset_index(drop=True)

    hrv_slope = _slope(window["hrv"].values)
    rhr_slope = _slope(window["rhr"].values)
    rec_slope = _slope(window["recovery"].values)
    strain_slope = _slope(window["strain"].values)

    hrv_signal = 1 if hrv_slope < 0 else 0
    rhr_signal = 1 if rhr_slope > 0 else 0
    rec_signal = 1 if rec_slope < 0 else 0
    strain_elevated = strain_slope >= -0.1

    ots_score = (hrv_signal + rhr_signal + rec_signal) * int(strain_elevated)

    if ots_score == 0:
        level = "low"
        label = "No overtraining signals detected"
        color = "#00d4aa"
    elif ots_score <= 2:
        level = "moderate"
        label = f"Moderate OTS risk — {ots_score} of 3 stress signals present"
        color = "#ffaa00"
    else:
        level = "high"
        label = "High OTS risk — all stress signals firing with sustained strain"
        color = "#ff6b6b"

    return {
        "score": ots_score,
        "level": level,
        "label": label,
        "color": color,
        "slopes": {
            "hrv": round(hrv_slope, 3),
            "rhr": round(rhr_slope, 3),
            "recovery": round(rec_slope, 3),
            "strain": round(strain_slope, 3),
        },
        "signals": {
            "hrv": bool(hrv_signal),
            "rhr": bool(rhr_signal),
            "recovery": bool(rec_signal),
            "strain_elevated": strain_elevated,
        },
        "window": window,
    }
