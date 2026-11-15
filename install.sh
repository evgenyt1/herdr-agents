#!/bin/sh
# Puts the herdr-agents mod into Herdr.app's folder.
#
#   ./install.sh              copy the mod (run again after `git pull` to update it)
#   ./install.sh --link       link to this checkout instead (for working on the mod)
#   ./install.sh --uninstall  take it out again
#
# Herdr.app's folder is $HERDR_APP_HOME, else ~/.config/herdr-app.
set -eu

name=herdr-agents
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
source="$here/mods/$name"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
target="$app/mods/$name"

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
}

mode=copy
for arg in "$@"; do
  case "$arg" in
    --copy) mode="copy" ;;
    --link) mode="link" ;;
    --uninstall) mode="uninstall" ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# What this repository puts there. Herdr adds files of its own (type definitions) beside them.
ours="main.js mod.json demo.js lib"

for item in $ours; do
  if [ ! -e "$source/$item" ]; then
    echo "No mod at $source ($item is missing). Run install.sh from its checkout." >&2
    exit 1
  fi
done

# The folder the mod would land in, with links followed. If that is this checkout's own copy
# (Herdr's folder, or its mods folder, points into the checkout), there is nothing to copy
# and removing "the installed mod" would remove the source.
onto_itself() {
  [ -d "$app/mods" ] || return 1
  [ "$(CDPATH='' cd -- "$app/mods" && pwd -P)/$name" = "$(CDPATH='' cd -- "$source" && pwd -P)" ]
}

remove_ours() {
  for item in $ours; do rm -rf "${target:?}/$item"; done
}

if [ "$mode" = uninstall ]; then
  if [ -L "$target" ]; then
    rm "$target"
    echo "Removed the link $target."
  elif onto_itself; then
    echo "$target is this checkout itself: nothing was installed, nothing removed." >&2
    exit 1
  elif [ -d "$target" ]; then
    remove_ours
    rm -f "$target/gpui-kit.d.ts" "$target/jsconfig.json"
    if rmdir "$target" 2>/dev/null; then
      echo "Removed $target."
    else
      echo "Removed the mod's files; left $target, which holds files that are not this mod's." >&2
    fi
  else
    echo "$name is not installed in $app/mods."
  fi
  exit 0
fi

if [ ! -d "$app" ]; then
  echo "Herdr.app's folder is not at $app. Start Herdr.app once, or set HERDR_APP_HOME." >&2
  exit 1
fi
mkdir -p "$app/mods"

if [ "$mode" = link ]; then
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    echo "$target is a folder. Run ./install.sh --uninstall first." >&2
    exit 1
  fi
  ln -sfn "$source" "$target"
  echo "Linked $target -> $source"
  echo "Herdr does not reload a linked mod when a file changes: reopen it to see an edit."
else
  [ -L "$target" ] && rm "$target"
  if onto_itself; then
    echo "$target is this checkout itself: Herdr already reads the mod from here." >&2
    exit 1
  fi
  mkdir -p "$target"
  remove_ours
  for item in $ours; do cp -R "$source/$item" "$target/$item"; done
  echo "Installed $name in $target"
fi

echo "Show it:  herdr-app do mod.open --name $name"
