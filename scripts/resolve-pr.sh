#!/usr/bin/env bash
#
# Writes `number=<pr>` to $GITHUB_OUTPUT, or `number=` when this build does not
# belong to an open pull request.
#
# On a pull_request event the number is already in the payload. On a manual
# workflow_dispatch it is not, and that is the case this exists for: a run
# started by hand from the Actions tab should still label its installers after
# the PR the branch belongs to, because otherwise the artifacts are named exactly
# like a release build of the same version.
#
# Empty output is the normal answer, not a failure — a dispatch on main, or on a
# branch with no PR open yet, has nothing to label with, and the step that reads
# this is skipped rather than guessing. That is also what keeps release.yml's
# concerns out of this: a tag build never reaches here at all.
#
# A single script rather than two inline blocks because GitHub's workflow parser
# has no YAML anchors, and the linux/windows and macOS jobs both need it.
set -euo pipefail

if [ "${GITHUB_EVENT_NAME:-}" = 'pull_request' ]; then
  printf 'number=%s\n' "${EVENT_PR:-}" >> "$GITHUB_OUTPUT"
  exit 0
fi

# `--head` takes the branch name; GITHUB_REF_NAME is that on a dispatch. (On a
# pull_request event it would be "<n>/merge", which is why that case returns
# above rather than falling through to here.)
number=$(gh pr list \
  --repo "$GITHUB_REPOSITORY" \
  --head "$GITHUB_REF_NAME" \
  --state open \
  --json number \
  --jq '.[0].number // empty')

if [ -n "$number" ]; then
  printf 'labelling artifacts for PR #%s\n' "$number"
else
  printf 'no open PR for %s — leaving the artifacts unlabelled\n' "$GITHUB_REF_NAME"
fi

printf 'number=%s\n' "$number" >> "$GITHUB_OUTPUT"
