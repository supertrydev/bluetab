#!/usr/bin/env bash
#
# PROCESS-02 — Turkish-character CI grep.
#
# Fails CI if Turkish characters (şŞğĞüÜöÖçÇıİ) appear in user-facing
# source (src/**/*.{ts,tsx,html}). Turkish developer notes belong in
# .planning/** (outside scanned scope); anything that ends up in the
# rendered UI must be English.
#
# Positive allowlist: scripts/ci/turkish-allowlist.txt (default empty).
#
# Exit 0 clean; exit 1 on match.

set -euo pipefail

PATTERN='[şŞğĞüÜöÖçÇıİ]'
ALLOWLIST_FILE="scripts/ci/turkish-allowlist.txt"

# Positive scope — git grep pathspecs with :(glob) magic so `**` recurses.
# Without :(glob), default pathspec semantics use fnmatch where `**` does
# NOT cross directory boundaries, and real offenders would slip through.
TARGETS=(
  ':(glob)src/**/*.ts'
  ':(glob)src/**/*.tsx'
  ':(glob)src/**/*.html'
)

# Build exclusion pathspecs from the allowlist (if present and non-empty).
EXCLUDE=()
if [[ -f "$ALLOWLIST_FILE" ]]; then
  while IFS= read -r line; do
    # Strip comments and blank lines.
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [[ -n "$line" ]]; then
      EXCLUDE+=(":(glob,exclude)$line")
    fi
  done < "$ALLOWLIST_FILE"
fi

# git grep returns 1 when no matches are found; that's the success path
# for this check. Any other non-zero is an actual tooling error.
set +e
git grep -nP "$PATTERN" -- "${TARGETS[@]}" "${EXCLUDE[@]}"
RC=$?
set -e

if [[ $RC -eq 0 ]]; then
  echo ""
  echo "Turkish characters found in user-facing source (PROCESS-02 violation)."
  echo "User-facing copy must be English. Turkish notes belong in .planning/**."
  echo "If a match is a legitimate exception, add its path to $ALLOWLIST_FILE."
  exit 1
elif [[ $RC -eq 1 ]]; then
  echo "PROCESS-02 OK: no Turkish characters in src/**/*.{ts,tsx,html}."
  exit 0
else
  echo "PROCESS-02 grep tooling error (rc=$RC)."
  exit "$RC"
fi
