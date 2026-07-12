#!/bin/bash
# SessionStart hook (Claude Code on the web): fix a false positive in CCR's
# launcher-provisioned Stop hook, ~/.claude/stop-hook-git-check.sh.
#
# That hook inspects `origin/<branch>..HEAD`. This repo's workflow restarts
# the working branch from origin/main after each PR merge, whose tip is
# GitHub's own squash-merge commit (committer noreply@github.com — Verified
# on GitHub via web-flow signing). The old range then contains published
# main history, so the hook demands an amend/rebase of a commit that isn't
# ours to rewrite — and would count it as "unpushed" besides.
#
# The patch recomputes both ranges as `HEAD --not --remotes`: commits
# reachable from any remote-tracking ref are published — neither ours to
# amend nor unpushed. Genuinely local commits still trip both checks
# exactly as before.
#
# Idempotent (a re-run finds nothing to replace) and defensive: if CCR
# ships a fixed or restructured hook the seds simply no-op, and this always
# exits 0 so session startup can never be wedged by it.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

target="$HOME/.claude/stop-hook-git-check.sh"
[ -f "$target" ] || exit 0

sed -i \
  -e "s/git log --format='%h %G? %ce' \"\$upstream\.\.HEAD\"/git log --format='%h %G? %ce' HEAD --not --remotes/" \
  -e 's/git rev-list "\$upstream\.\.HEAD" --count/git rev-list --count HEAD --not --remotes/' \
  "$target" 2>/dev/null

exit 0
