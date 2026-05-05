#!/usr/bin/env bash
# scripts/analyze.sh — runs Claude Code headless to score and order travel photos.
#
# Usage:
#   MAX_PICKS=12 scripts/analyze.sh /path/to/photo1.jpg /path/to/photo2.jpg ...
#
# Each argument may be either:
#   - a plain absolute path (id auto-assigned p0, p1, ...)
#   - id=ID:/abs/path (id explicitly assigned)
#
# Writes a single JSON object to stdout matching the AnalysisResult shape consumed
# by /api/analyze:
#   {"items":[{"id":"...","scene":"...","qualityScore":0.5,"caption":"..."}],
#    "orderedIds":["...", ...]}

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <photo>... (or id=ID:/abs/path)" >&2
  exit 2
fi

MAX_PICKS="${MAX_PICKS:-12}"
MODEL="${CLAUDE_MODEL:-sonnet}"

photo_list=""
i=0
for arg in "$@"; do
  if [[ "$arg" == id=*:* ]]; then
    id="${arg#id=}"
    id="${id%%:*}"
    abs="${arg#id=*:}"
  else
    id="p${i}"
    abs="$arg"
  fi
  if [[ ! -f "$abs" ]]; then
    echo "scripts/analyze.sh: not a file: $abs" >&2
    exit 3
  fi
  photo_list+="${i}. id=${id}, path=${abs}"$'\n'
  i=$((i + 1))
done

read -r -d '' SCHEMA <<'EOF' || true
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string" },
          "scene": { "type": "string" },
          "qualityScore": { "type": "number" },
          "caption": { "type": "string" }
        },
        "required": ["id", "scene", "qualityScore", "caption"]
      }
    },
    "orderedIds": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["items", "orderedIds"]
}
EOF

PROMPT="You are a video editor selecting and ordering travel photos for an Instagram reel.

Read each of these photos with the Read tool and look at them visually:
${photo_list}
Score each photo 0-1 on quality and visual appeal. Tag the dominant scene with one of:
landscape, sunset, beach, city, street, food, portrait, group, detail, other.

Then return an ordering for the best ${MAX_PICKS} photos (or all of them if fewer)
that tells a narrative arc: hook (something striking) → build (variety, places visited)
→ climax (peak moment, sunset, group) → outro (calm, detail, or wide). Avoid
near-duplicates.

For each photo include id, scene, qualityScore (0-1), and a 4-7 word caption.
Then return orderedIds (array of ids) in narrative order. Use only the ids listed
above. Output only the JSON object — no prose, no code fences."

SYSTEM_PROMPT="You are a video editor scoring travel photos for a short-form reel.
Use the Read tool to load each photo, then return the JSON the user asks for.
Do not write to disk, run shell commands, or use any tool other than Read."

envelope="$(
  claude -p "$PROMPT" \
    --system-prompt "$SYSTEM_PROMPT" \
    --no-session-persistence \
    --model "$MODEL" \
    --output-format json \
    --json-schema "$SCHEMA" \
    --allowedTools "Read" \
    --dangerously-skip-permissions \
    || true
)"

# When --json-schema is set, the structured response lands in .structured_output.
# Print just that on success; on failure dump the full envelope to stderr and exit.
if echo "$envelope" | jq -e '.structured_output' >/dev/null 2>&1; then
  echo "$envelope" | jq -c '.structured_output'
else
  echo "scripts/analyze.sh: claude returned no structured_output:" >&2
  echo "$envelope" >&2
  exit 4
fi
