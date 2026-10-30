#!/usr/bin/env bash
#
# SAFETY-02 — Forbidden-words CI grep for ADHD-facing copy.
#
# Scans a POSITIVE allowlist of ADHD-facing source files for words that
# trigger shame/failure framing in ADHD users:
#
#   streak, missed, failed, time's up, expired, broken, wasted, you did not
#
# Matches are word-boundary scoped so "broken link" etc. elsewhere in the
# codebase are unaffected — this script only scans the files listed in
# TARGETS below. That keeps the rule strict where trust matters and silent
# everywhere else.
#
# Targets that don't exist yet are skipped (idempotent across waves —
# downstream plans create new files; re-running here never fails just
# because a wave hasn't landed yet).
#
# Exit 0 clean; exit 1 on match.

set -euo pipefail

# Positive scope — ADHD-facing surfaces ONLY.
TARGETS=(
  "src/settings/components/ADHDSettings.tsx"
  "src/sidepanel/components/BrainDumpPanel.tsx"
  "src/sidepanel/components/BrainDumpEntry.tsx"
  "src/sidepanel/components/SuspendedTabsSection.tsx"
  "src/sidepanel/components/VisualTimeDisc.tsx"
  "src/content/brain-dump-modal.ts"
  "src/services/adhd-service.ts"
  "src/services/auto-suspend-service.ts"
  "src/services/brain-dump-service.ts"
  # Phase 12 new UI + service files (added by Plan 12-01; files created in Plans 12-02 through 12-05)
  "src/sidepanel/components/FlowtimeBar.tsx"
  "src/sidepanel/components/FlowtimeBreakCard.tsx"
  "src/sidepanel/components/HardFocusButton.tsx"
  "src/services/visible-tab-limit-service.ts"
  "src/services/hard-focus-service.ts"
  # Phase 13 new UI surfaces (added by Plan 13-01; files created in Plans 13-03 through 13-05)
  "src/settings/components/mcp/TrustWarningModal.tsx"
  "src/settings/components/mcp/SnapshotConsentModal.tsx"
  "src/settings/components/mcp/ConnectedClientCard.tsx"
  "src/settings/components/mcp/EndpointCard.tsx"
  "src/settings/components/mcp/AddEndpointForm.tsx"
  "src/settings/components/MCPServerSection.tsx"
  "src/settings/components/MCPClientSection.tsx"
  "src/sidepanel/components/ServerAttributionChip.tsx"
  # Phase 14 new UI + service files (added by Plan 14-01; files created in Plans 14-01 through 14-07)
  "src/settings/components/integrations/IntegrationsSection.tsx"
  "src/settings/components/integrations/IntegrationCard.tsx"
  "src/settings/components/integrations/IntegrationConsentModal.tsx"
  "src/settings/components/integrations/IntegrationReauthBanner.tsx"
  "src/settings/components/integrations/IntegrationAccountRow.tsx"
  "src/sidepanel/components/GroupMirrorPicker.tsx"
  "src/services/integrations/registry.ts"
)

# Word-boundary regex — the literal phrase "time's up" has an apostrophe
# which is not a word char, so it needs its own alternative.
PATTERN="\\b(streak|missed|failed|expired|broken|wasted|you did not)\\b|time's up"

MATCHED=0
for file in "${TARGETS[@]}"; do
  if [[ ! -f "$file" ]]; then
    continue
  fi
  # grep -iPn: case-insensitive, PCRE, line-numbered.
  # grep returns 1 on no match — that's the success case.
  if grep -iPn "$PATTERN" "$file"; then
    MATCHED=1
  fi
done

if [[ $MATCHED -ne 0 ]]; then
  echo ""
  echo "Forbidden ADHD-framing words found in ADHD-facing source (SAFETY-02 violation)."
  echo "Rephrase without: streak | missed | failed | time's up | expired | broken | wasted | you did not."
  echo "Neutral alternatives: pending, still here, not yet enabled, paused, ready."
  exit 1
fi

echo "SAFETY-02 OK: no forbidden ADHD-framing words in scanned ADHD-facing files."
exit 0
