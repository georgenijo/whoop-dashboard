# scripts/zsh-helpers.sh
#
# Whoop Dashboard dev pipeline helpers.
# Source from your shell init:
#
#   echo 'source ~/Documents/code/whoop-dashboard/scripts/zsh-helpers.sh' >> ~/.zshrc
#   exec zsh
#
# Provides:
#   work  <issue#>             — worktree + branch + Claude agent in plan mode
#   cwork <issue#>             — same, but Codex CLI instead of Claude
#   swarm <issue#> [issue#...] — lead Claude agent that spawns one sub-agent per issue
#   bug                        — Claude session primed with prompts/PROMPT_BUG.md
#   chat                       — Claude session primed with prompts/PROMPT_CHAT.md
#
# Requirements: gh CLI authed, jq, claude (and codex if using cwork).
# Each helper reads its template from `prompts/` at the repo root.

_repo_info() {
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$REPO_ROOT" ]; then
    echo "Not inside a git repository"
    return 1
  fi
  REPO_NAME=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null)
  if [ -z "$REPO_NAME" ]; then
    echo "Could not detect GitHub remote"
    return 1
  fi
  REPO_SLUG=$(basename "$REPO_ROOT")
}

_load_prompt() {
  local prompt_file="$1"
  if [ -f "$prompt_file" ]; then
    cat "$prompt_file"
  fi
}

_fetch_open_issue_json() {
  local issue_num="$1"
  local issue_json
  if ! issue_json=$(gh api "repos/${REPO_NAME}/issues/${issue_num}" 2>&1); then
    echo "Could not fetch issue #$issue_num from $REPO_NAME" >&2
    return 1
  fi

  if [ "$(jq -r 'has("pull_request")' <<< "$issue_json")" = "true" ]; then
    local pr_url=$(jq -r '.html_url' <<< "$issue_json")
    echo "#$issue_num is a pull request, not an issue: $pr_url" >&2
    return 1
  fi

  local issue_state=$(jq -r '.state' <<< "$issue_json")
  if [ "$issue_state" != "open" ]; then
    local issue_url=$(jq -r '.html_url' <<< "$issue_json")
    echo "Issue #$issue_num is $issue_state, not open: $issue_url" >&2
    return 1
  fi

  jq '{title, body, state, html_url, number}' <<< "$issue_json"
}

work() {
  if [ -z "$1" ]; then
    echo "Usage: work <issue-number>"
    return 1
  fi

  _repo_info || return 1

  local issue_num="$1"

  local issue_json
  issue_json=$(_fetch_open_issue_json "$issue_num") || return 1

  git -C "$REPO_ROOT" fetch origin && git -C "$REPO_ROOT" pull --ff-only origin main 2>/dev/null

  local issue_title=$(jq -r '.title' <<< "$issue_json")
  local issue_body=$(jq -r '.body' <<< "$issue_json")

  local branch_slug=$(echo "$issue_title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
  local branch_name="issue/${issue_num}-${branch_slug}"
  local worktree_dir="${REPO_ROOT}/../${REPO_SLUG}-issue-${issue_num}"

  if [ ! -d "$worktree_dir" ]; then
    git -C "$REPO_ROOT" worktree add "$worktree_dir" -b "$branch_name"
    if [ $? -ne 0 ]; then
      echo "Failed to create worktree at $worktree_dir"
      return 1
    fi
  else
    echo "Worktree already exists at $worktree_dir — reusing it"
  fi

  local base_prompt=$(_load_prompt "${REPO_ROOT}/prompts/PROMPT.md")
  local prompt="${base_prompt}

## Your Assignment

You are working on GitHub Issue #${issue_num}: ${issue_title}

${issue_body}

Work on this issue and nothing else. Your branch is already created: ${branch_name}. Do not create a new branch.
Start by entering plan mode. Present your implementation plan and wait for approval before writing any code."

  echo "Launching agent for issue #${issue_num}: ${issue_title}"
  echo "Repo:      ${REPO_NAME}"
  echo "Worktree:  ${worktree_dir}"
  echo "Branch:    ${branch_name}"
  echo ""

  cd "$worktree_dir" && claude --dangerously-skip-permissions "$prompt"
}

cwork() {
  if [ -z "$1" ]; then
    echo "Usage: cwork <issue-number>"
    return 1
  fi

  _repo_info || return 1

  local issue_num="$1"

  local issue_json
  issue_json=$(_fetch_open_issue_json "$issue_num") || return 1

  git -C "$REPO_ROOT" fetch origin && git -C "$REPO_ROOT" pull --ff-only origin main 2>/dev/null

  local issue_title=$(jq -r '.title' <<< "$issue_json")
  local issue_body=$(jq -r '.body' <<< "$issue_json")

  local branch_slug=$(echo "$issue_title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
  local branch_name="issue/${issue_num}-${branch_slug}"
  local worktree_dir="${REPO_ROOT}/../${REPO_SLUG}-issue-${issue_num}"

  if [ ! -d "$worktree_dir" ]; then
    git -C "$REPO_ROOT" worktree add "$worktree_dir" -b "$branch_name"
    if [ $? -ne 0 ]; then
      echo "Failed to create worktree at $worktree_dir"
      return 1
    fi
  else
    echo "Worktree already exists at $worktree_dir — reusing it"
  fi

  local base_prompt=$(_load_prompt "${REPO_ROOT}/prompts/PROMPT.md")
  local prompt="${base_prompt}

## Your Assignment

You are working on GitHub Issue #${issue_num}: ${issue_title}

${issue_body}

Work on this issue and nothing else. Your branch is already created: ${branch_name}. Do not create a new branch.
Read AGENTS.md at the repo root before doing anything else. Read every file in the issue's 'Read first' section before writing code. Implement the Steps in order. Respect Anti-patterns. Run every Acceptance check and paste the output in the PR description. Use the branch, commit message, and PR title from the issue. Comment on the issue with the PR URL when done."

  echo "Launching Codex for issue #${issue_num}: ${issue_title}"
  echo "Repo:      ${REPO_NAME}"
  echo "Worktree:  ${worktree_dir}"
  echo "Branch:    ${branch_name}"
  echo ""

  cd "$worktree_dir" && codex --dangerously-bypass-approvals-and-sandbox "$prompt"
}

bug() {
  _repo_info || return 1
  local prompt=$(_load_prompt "${REPO_ROOT}/prompts/PROMPT_BUG.md")
  if [ -z "$prompt" ]; then
    echo "No prompts/PROMPT_BUG.md found in ${REPO_ROOT}"
    return 1
  fi
  cd "$REPO_ROOT" && claude --dangerously-skip-permissions "$prompt"
}

chat() {
  _repo_info || return 1
  local prompt=$(_load_prompt "${REPO_ROOT}/prompts/PROMPT_CHAT.md")
  if [ -z "$prompt" ]; then
    echo "No prompts/PROMPT_CHAT.md found in ${REPO_ROOT}"
    return 1
  fi
  cd "$REPO_ROOT" && claude --dangerously-skip-permissions "$prompt"
}

swarm() {
  if [ -z "$1" ]; then
    echo "Usage: swarm <issue1> <issue2> ..."
    return 1
  fi

  _repo_info || return 1

  local issue_num
  for issue_num in "$@"; do
    _fetch_open_issue_json "$issue_num" >/dev/null || return 1
  done

  git -C "$REPO_ROOT" fetch origin && git -C "$REPO_ROOT" pull --ff-only origin main 2>/dev/null

  local prompt=$(_load_prompt "${REPO_ROOT}/prompts/PROMPT_SWARM.md")
  if [ -z "$prompt" ]; then
    echo "No prompts/PROMPT_SWARM.md found in ${REPO_ROOT}"
    return 1
  fi

  local issue_list=""
  for issue_num in "$@"; do
    issue_list="${issue_list}- #${issue_num}\n"
  done

  prompt="${prompt}
$(printf "$issue_list")"

  echo "Launching swarm for issues: $*"
  cd "$REPO_ROOT" && claude --dangerously-skip-permissions "$prompt"
}
