# Agent Startup — Feature Mode

You are starting a new session on the Whoop Dashboard project. Follow these steps exactly and in order.

## 1. Load Context

Read these files silently:
- `CLAUDE.md` — project overview, architecture, key conventions (may already be loaded)
- `README.md` — setup, features, run commands
- Any file in `whoop/` relevant to your ticket (`auth.py`, `client.py`, `db.py`, `insights.py`, `chat.py`, `ots.py`)
- The relevant sections of `app.py` — it is ~2000 lines but organized by `@st.fragment` section, so grep for the section name rather than reading end-to-end

## 2. Health Check (silent)

Run `git status` — check branch and working tree. Surface results only if there are unexpected uncommitted changes. Otherwise say nothing.

## 3. Your Assignment

The issue to work on is injected at the end of this prompt — title, number, and full body are included. Do not re-fetch it.

## 4. Plan Mode

Enter plan mode (use the `EnterPlanMode` tool). While in plan mode:
- Read all files relevant to the ticket
- Design your implementation approach, reusing existing patterns (`build_*_df()`, `@st.fragment` sections, `@st.cache_data(ttl=600)`, `score_state == "SCORED"` filter)
- Write a plan covering: which ticket (issue number + name), files to change, approach, and any risks
- Exit plan mode for user approval

Do not write any code until the user approves the plan.

## 5. Implement

After approval, implement exactly what was planned. No scope creep — do not refactor surrounding code, add comments to unchanged code, or introduce features not in the ticket.

**For dashboard/chart changes:** Run `streamlit run app.py` locally (serves on `http://localhost:8501`) and visually verify the new section renders correctly with real data. Check that KPI deltas, chart axes, and any new metrics look right before committing. If you cannot test the UI, say so explicitly rather than claiming success.

## 6. Verify

Before committing, run:
- `python3 -m py_compile app.py whoop/*.py` — no syntax errors
- `python3 -c "import ast; [ast.parse(open(f).read()) for f in ['app.py'] + __import__('glob').glob('whoop/*.py')]"` — parses clean

If any check fails, fix the issue before proceeding. This repo has no test suite or linter — correctness is verified by running the app.

## 7. Commit and PR

1. Stage and commit with a conventional commit message (`feat:`, `fix:`, `chore:`, `refactor:`, etc.)
2. Push the branch: `git push -u origin <branch-name>`
3. Open a PR:
   ```bash
   gh pr create --title "<concise title>" --body "Closes #<issue-number>" --repo georgenijo/whoop-dashboard
   ```
4. Report the PR URL.
