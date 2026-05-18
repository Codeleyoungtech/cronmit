#!/usr/bin/env bash
set -euo pipefail

mkdir -p streak

USERNAME="${GITHUB_USERNAME:-github-actions[bot]}"
COUNT="${COMMITS_PER_DAY:-5}"
SLOT="${COMMIT_SLOT:-1}"
MODE="${CRONMIT_MODE:-art}"
MANUAL_COUNT="${MANUAL_COUNT:-}"
TODAY="$(date -u +%F)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -n "$MANUAL_COUNT" ]]; then
  TARGET="$MANUAL_COUNT"
elif [[ "$MODE" == "art" && -f cronmit-plan.json ]]; then
  TARGET="$(
    TODAY="$TODAY" node -e "const fs = require('fs'); const plan = JSON.parse(fs.readFileSync('cronmit-plan.json', 'utf8')); const row = (plan.days || []).find(day => day.date === process.env.TODAY); process.stdout.write(String(row ? row.commits : 1));"
  )"
else
  TARGET="$COUNT"
fi

if ! [[ "$TARGET" =~ ^[0-9]+$ ]]; then
  echo "Invalid target: $TARGET" >&2
  exit 1
fi

if (( TARGET < 1 )); then
  echo "Cronmit refuses zero-commit days. Raising target to 1."
  TARGET=1
fi

if (( SLOT > TARGET )); then
  echo "Slot $SLOT is above today's target $TARGET. Nothing to do."
  exit 0
fi

git config user.name "$USERNAME"
git config user.email "$USERNAME@users.noreply.github.com"

RUN_ID="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$SLOT"
STAMP="$(date -u +%s%N)"
DAILY_FILE="streak/$TODAY.md"
LOG_FILE="streak/log.ndjson"

{
  echo ""
  echo "## $NOW"
  echo ""
  echo "- slot: $SLOT"
  echo "- target: $TARGET"
  echo "- mode: $MODE"
  echo "- run: $RUN_ID"
  echo "- nonce: $STAMP"
} >> "$DAILY_FILE"

printf '{"time":"%s","date":"%s","slot":%s,"target":%s,"mode":"%s","run":"%s","nonce":"%s"}\n' \
  "$NOW" "$TODAY" "$SLOT" "$TARGET" "$MODE" "$RUN_ID" "$STAMP" >> "$LOG_FILE"

git add streak

if git diff --cached --quiet; then
  echo "Cronmit safety stop: no tracked file changed, so no commit was created." >&2
  exit 1
fi

git commit -m "chore(cronmit): keep streak $TODAY slot $SLOT/$TARGET"
git pull --rebase --autostash
git push
