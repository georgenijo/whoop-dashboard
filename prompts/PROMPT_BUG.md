# Agent Startup — Bug Fix Mode

You are starting a new session on the Whoop Dashboard project in bug-fix mode. Follow these steps exactly and in order.

## 1. Load Context

Read these files silently:
- `CLAUDE.md` — project overview, architecture, key conventions
- `README.md` — setup and run commands

## 2. Health Check (silent)

Run `git status` in the background. Only surface results if there are unexpected uncommitted changes. Otherwise say nothing about health checks.

## 3. Pick the Next Bug

Run:
```bash
gh issue list --label "bug" --state open --json number,title,labels --repo georgenijo/whoop-dashboard
```

From the results, pick the open issue with the highest priority label (p1 > p2 > p3). If no issues carry a p1/p2/p3 label, pick the most recently updated open bug:
```bash
gh issue list --label "bug" --state open --sort updated --limit 1 --repo georgenijo/whoop-dashboard
```
If that also returns nothing, stop and report "no open bug issues found" with no further action. Otherwise fetch the body:
```bash
gh issue view <number> --json title,body --repo georgenijo/whoop-dashboard
```

Use the issue body as the full bug spec.

## 4. Create Branch

```bash
git checkout -b fix/<number>-<short-slug>
```

## 5. Present Your Plan

Tell me:
- Which bug you're fixing (issue number + name, one-line description)
- Your investigation and fix plan: root cause hypothesis, files to change, approach

Then ask: **"Confirm to proceed?"**

Do not write any code until I confirm.

## 6. Implement

After confirmation, implement the fix. Stay focused — fix the bug, nothing else. Don't refactor surrounding code or "clean up" unrelated sections.

## 7. Verify

Before committing:
- `python3 -m py_compile streamlit/app.py streamlit/whoop/*.py sync/daily_sync.py` — no syntax errors
- For dashboard/chart bugs: run `streamlit run streamlit/app.py` (serves on `http://localhost:8501`) and visually confirm the bug is gone and nothing else regressed
- For sync/DB bugs: run `python3 sync/daily_sync.py` locally (requires valid `tokens.json`) and confirm expected output

If any check fails, fix before proceeding.

## 8. Commit and PR

1. Stage and commit with a conventional commit message (`fix: <description>`)
2. Push the branch: `git push -u origin fix/<number>-<short-slug>`
3. Open a PR:
   ```bash
   gh pr create --title "fix: <concise description>" --body "Closes #<issue-number>" --repo georgenijo/whoop-dashboard
   ```
4. Report the PR URL.
