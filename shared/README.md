# shared/

Runtime state for `apps/web/` (the sole owner of the Whoop domain tables) and
the Python helper library in `streamlit/whoop/` (used only by `scripts/` and
`tests/`; there is no Streamlit app). Contains `whoop_data.db` (gitignored) and
its WAL sidecar files (`-wal`, `-shm`).

The DB path is resolved by `apps/web/src/lib/db/connection.ts` and
`streamlit/whoop/db.py` via the `WHOOP_DB_PATH` env var, falling back to
`<repo_root>/shared/whoop_data.db`. Container
deployments (Podman Quadlet) bind-mount this directory and override the
env var.
