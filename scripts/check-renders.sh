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

# render <name> <width> [more sed expressions]: checks a copy that starts in demo mode at that width.
render() {
  name=$1
  width=$2
  shift 2
  copy="$work/herdr-agents-$name"
  mkdir "$copy"
  cp -R "$source/main.js" "$source/mod.json" "$source/demo.js" "$source/lib" "$copy/"
  sed -e 's/if (given\.demo) {/if (true) {/' -e "s/this\.size = this\.stored(\"size\", parseSize);/this.size = { width: $width, height: 600 };/" "$@" "$source/main.js" > "$copy/main.js"
  if ! grep -q 'if (true) {' "$copy/main.js" || ! grep -q "width: $width, height: 600" "$copy/main.js"; then
    echo "check-renders: main.js no longer has the lines this script rewrites" >&2
    exit 1
  fi
  if ! out=$(herdr-app check "$copy" 2>&1); then
    echo "demo, $name: $out" >&2
    exit 1
  fi
  echo "check passed: demo, $name"
}

for width in 1400 700 300 200 120 60; do
  render "$width px" "$width"
done

# A divider held, and a column being measured for a double-click: drawn in those moments only.
render "a divider held" 1400 -e 's/this\.drag = null; \/\/.*/this.drag = { key: "dir", x: 0, width: 150, now: 200 };/'
grep -q 'now: 200' "$work/herdr-agents-a divider held/main.js" || { echo "check-renders: the drag line is gone" >&2; exit 1; }
for key in name status model git pr dir; do
  render "fitting $key" 1400 -e "s/this\.fit = null; \/\/.*/this.fit = { key: \"$key\", turn: 1 };/"
  grep -q "key: \"$key\", turn: 1" "$work/herdr-agents-fitting $key/main.js" || { echo "check-renders: the fit line is gone" >&2; exit 1; }
done
