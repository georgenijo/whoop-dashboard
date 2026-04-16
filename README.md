# Whoop Dashboard

Personal Whoop data dashboard built with Streamlit and Plotly.

## Setup

1. Register an app at [developer.whoop.com](https://developer.whoop.com)
2. Set the redirect URI to `http://localhost:8501`
3. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   cp .env.example .env
   ```
4. Create a virtual environment and install dependencies:
   ```
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
5. Run the dashboard:
   ```
   streamlit run app.py
   ```
6. Click "Connect to Whoop" and authorize the app.

## Features

- OAuth2 auth with auto-refreshing tokens
- Parallel API fetching (5 endpoints at once)
- 10-minute data cache
- KPI row: Recovery, HRV, RHR, Sleep Performance, Day Strain, SpO2
- Charts: recovery trend (color zones), HRV, RHR, sleep duration vs need, sleep stages, sleep performance/efficiency, daily strain, workout HR zones
- Sortable workout table
