# shared/

Runtime state shared between `streamlit/`, `sync/`, and `apps/web/`. Contains
`whoop_data.db` (gitignored) and its WAL sidecar files (`-wal`, `-shm`).

The DB path is resolved by `streamlit/whoop/db.py` via the `WHOOP_DB_PATH`
env var, falling back to `<repo_root>/shared/whoop_data.db`. Container
deployments (Podman Quadlet) bind-mount this directory and override the
env var.
