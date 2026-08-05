#!/usr/bin/env bash
#
# Stamps the PR number into installer filenames, so a build downloaded from a
# pull request can be told apart from a release. Both carry the same version —
# the one in package.json — and a PR build is by definition a version that has
# not been cut yet, so the filename is the only thing that can say which is
# which.
#
#   Digital-DM-Screen-0.3.0-x64-setup.exe
#   Digital-DM-Screen-0.3.0-PR-17-x64-setup.exe
#
# Only the filename changes. What the package reports once installed is still
# the plain version, because that comes from the control file inside it.
#
#   ./scripts/label-pr-build.sh <directory> <pr-number>
set -euo pipefail

dir=${1:?usage: label-pr-build.sh <directory> <pr-number>}
pr=${2:?usage: label-pr-build.sh <directory> <pr-number>}

# Renaming nothing means the upload is unlabelled and nobody notices until they
# are staring at two identical filenames wondering which one they installed.
renamed=0

shopt -s nullglob
for path in "$dir"/*.exe "$dir"/*.AppImage "$dir"/*.deb "$dir"/*.dmg; do
  name=$(basename "$path")

  # Insert after the version rather than before the extension: the arch and
  # target that follow it are what people scan the filename for.
  labelled=$(printf '%s' "$name" | sed -E "s/^(.*-[0-9]+\.[0-9]+\.[0-9]+)/\1-PR-${pr}/")

  if [ "$labelled" = "$name" ]; then
    printf 'no version found in %s — refusing to guess where the label goes\n' "$name" >&2
    exit 1
  fi

  mv "$path" "$dir/$labelled"
  printf '%s -> %s\n' "$name" "$labelled"
  renamed=$((renamed + 1))
done

if [ "$renamed" -eq 0 ]; then
  printf 'no installers found in %s\n' "$dir" >&2
  exit 1
fi
