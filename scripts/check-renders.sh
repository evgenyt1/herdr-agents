#!/bin/sh
# `herdr-app check` renders a mod once, with no props and no agents: the rows are never drawn.
# This checks copies of the mod that start in demo mode at a fixed width, so every kind of row
# (table, compact, rail) goes through the app's renderer. Needs herdr-app on PATH.
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
source="$here/mods/herdr-agents"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

herdr-app check "$source"

for width in 1400 700 300 200 120 60; do
  copy="$work/herdr-agents-$width"
  mkdir "$copy"
  cp -R "$source/main.js" "$source/mod.json" "$source/demo.js" "$source/lib" "$copy/"
  sed -e 's/if (given\.demo) {/if (true) {/' -e "s/this\.size = null;/this.size = { width: $width, height: 600 };/" "$source/main.js" > "$copy/main.js"
  if ! grep -q 'if (true) {' "$copy/main.js" || ! grep -q "width: $width, height: 600" "$copy/main.js"; then
    echo "check-renders: main.js no longer has the lines this script rewrites" >&2
    exit 1
  fi
  if ! out=$(herdr-app check "$copy" 2>&1); then
    echo "demo at $width px: $out" >&2
    exit 1
  fi
  echo "check passed: demo at $width px"
done
