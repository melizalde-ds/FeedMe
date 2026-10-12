#!/usr/bin/env bash
# Runs one harness script in the open playwright-cli session.
#   .redesign/scripts/run.sh 02-setup.js [before|after]
# The planner fixture is inlined where the script says __FIXTURE__, and the
# buying-agent fixture at __SHOPPING__, and the output folder at __PHASE__.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
phase="${2:-before}"
built="$(mktemp --suffix=.js)"
AUTH_RESULT="$here/../results/$phase-01-auth.json" node -e '
const fs = require("fs")
const [src, fixture, shopping, phase, out] = process.argv.slice(1)
let code = fs.readFileSync(src, "utf8")
// The account 01-auth.js registered in this phase, for scripts that sign in again.
let email = ""
try { email = JSON.parse(fs.readFileSync(process.env.AUTH_RESULT, "utf8")).email } catch {}
code = code.replace("__FIXTURE__", () => fs.readFileSync(fixture, "utf8")).replace("__SHOPPING__", () => fs.readFileSync(shopping, "utf8")).replaceAll("__PHASE__", phase).replaceAll("__EMAIL__", email)
fs.writeFileSync(out, code)
' "$here/$1" "$here/../fixtures/meal-options.json" "$here/../fixtures/shopping.json" "$phase" "$built"
mkdir -p "$here/../results"
result="$here/../results/$phase-${1%.js}.json"
raw="$(playwright-cli run-code --filename="$built" 2>&1 || true)"
if ! grep -q '^### Result' <<<"$raw"; then
  # The script itself threw: show why instead of an empty result.
  sed -n '1,12p' <<<"$raw"
  rm -f "$built"
  exit 1
fi
sed -n '/^### Result/,/^### Ran Playwright code/p' <<<"$raw" | sed '1d;$d' > "$result"
# One line per check, then the console errors seen while it ran.
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
for (const line of r.log) console.log(line)
console.log(`console errors: ${r.errors.length}`)
for (const e of r.errors) console.log("  " + e)
' "$result"
rm -f "$built"
