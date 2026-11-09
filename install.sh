#!/usr/bin/env bash
# Install taste-skill skills into agent skill directories.
#
# Claude Code and Codex get symlinks. Unlike `npx skills add`, this means
# `git pull` updates every installed skill in place. Install names are read
# from each SKILL.md frontmatter, so new upstream skills are picked up
# automatically. DSH gets a plain copy (see below).
#
#   ./install.sh                          # link all skills into Claude Code
#   ./install.sh --codex                  # ... into Codex instead
#   ./install.sh --all-agents             # ... into both
#   ./install.sh design-taste-frontend    # link only these (by install name)
#   ./install.sh --list                   # show install name -> folder
#   ./install.sh --uninstall              # remove links pointing at this repo
#
# DeepSeek Harness (DSH) mode. DSH reads a plain folder, so this mode copies
# instead of linking, through install.mjs (needs Node 18+):
#
#   ./install.sh --dsh                    # copy into $DSH_HOME/skills, else ~/.dsh/skills
#   ./install.sh --dsh --project          # copy into <git root>/.dsh/skills
#   ./install.sh --dsh --list             # show the DSH targets and their state
#   ./install.sh --dsh --uninstall        # remove the copy this script made
#
# DSH flags: --user, --project, --target <dir>, --force. --dsh cannot be
# combined with --claude, --codex or --all-agents: run them one at a time.
#
# Requires bash (arrays, [[ ]]). Node 18+ is needed only for --dsh.

set -euo pipefail

# Windows (Git Bash, MSYS2, Cygwin): plain `ln -s` silently COPIES a folder there, so a
# `git pull` would never reach the install. Ask for a real link, and fall back to a
# directory junction (no admin or Developer Mode needed) when a symlink is not allowed.
WINDOWS=0
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    WINDOWS=1
    export MSYS=winsymlinks:nativestrict CYGWIN=winsymlinks:nativestrict ;;
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$REPO/skills"

targets=()
mode=install
wanted=()
dsh=0
dsh_level=
dsh_target=
dsh_force=0
DSH_SKILL_NAME=design-taste-frontend

while [[ $# -gt 0 ]]; do
  case "$1" in
    --claude)      targets+=("$HOME/.claude/skills") ;;
    --codex)       targets+=("$HOME/.codex/skills") ;;
    --all-agents)  targets+=("$HOME/.claude/skills" "$HOME/.codex/skills") ;;
    --dsh)         dsh=1 ;;
    --user)        dsh_level=user ;;
    --project)     dsh_level=project ;;
    --target)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || { echo "--target needs a folder" >&2; exit 2; }
      dsh_target="$2"; shift ;;
    --force)       dsh_force=1 ;;
    --list)        mode=list ;;
    --uninstall)   mode=uninstall ;;
    -h|--help)     awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*)            echo "unknown flag: $1" >&2; exit 2 ;;
    *)             wanted+=("$1") ;;
  esac
  shift
done

if [[ $dsh -ne 1 ]]; then
  if [[ -n $dsh_level || -n $dsh_target || $dsh_force -eq 1 ]]; then
    echo "--user, --project, --target and --force apply to --dsh; add --dsh (or use --claude / --codex)" >&2
    echo "for a Claude Code project install, run: ./install.sh --claude   (user level is the default)" >&2
    exit 2
  fi
fi

# DSH mode delegates to install.mjs, the one implementation of DSH's target
# rules (DSH_HOME, git root) and of the atomic copy + marker uninstall. Linking
# would be wrong there: DSH reads the skill as a plain folder.
if [[ $dsh -eq 1 ]]; then
  if [[ ${#targets[@]} -gt 0 ]]; then
    echo "--dsh cannot be combined with --claude, --codex or --all-agents: run them separately" >&2
    exit 2
  fi
  for w in "${wanted[@]:-}"; do
    [[ -z $w ]] && continue
    if [[ $w != "$DSH_SKILL_NAME" ]]; then
      echo "error: no skill named '$w' in DSH mode (installs as $DSH_SKILL_NAME)" >&2
      exit 1
    fi
  done
  command -v node >/dev/null 2>&1 || { echo "error: --dsh needs Node.js 18+ (install.mjs is not runnable otherwise)" >&2; exit 1; }
  pass=(--dsh)
  [[ -n $dsh_level ]] && pass+=("--$dsh_level")
  [[ -n $dsh_target ]] && pass+=(--target "$dsh_target")
  [[ $dsh_force -eq 1 ]] && pass+=(--force)
  [[ $mode == uninstall ]] && pass+=(--uninstall)
  [[ $mode == list ]] && pass+=(--list)
  exec node "$REPO/install.mjs" "${pass[@]}"
fi

[[ ${#targets[@]} -eq 0 ]] && targets=("$HOME/.claude/skills")

# resolve_link <symlink> -- absolute target, relative targets resolved against
# the link's own directory so they can be compared against $SKILLS_DIR
resolve_link() {
  local t d b
  t="$(readlink "$1")" || return 1
  [[ $t == /* ]] || t="$(dirname "$1")/$t"
  d="$(cd "$(dirname "$t")" 2>/dev/null && pwd)" || return 1
  b="$(basename "$t")"
  printf '%s/%s\n' "${d%/}" "$b"
}

# owned_by_repo <symlink> -- true if it resolves into this repo's skills/
owned_by_repo() {
  local r
  r="$(resolve_link "$1")" || return 1
  [[ $r == "$SKILLS_DIR"/* ]]
}

# install_name <SKILL.md> -- frontmatter `name:`, falling back to folder name
install_name() {
  awk '
    NR==1 && $0!="---" { exit }
    NR>1 && /^---[[:space:]]*$/ { exit }
    NR>1 && /^name:/ { sub(/^name:[[:space:]]*/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit }
  ' "$1"
}

wants() {
  [[ ${#wanted[@]} -eq 0 ]] && return 0
  local w; for w in "${wanted[@]}"; do [[ "$w" == "$1" ]] && return 0; done
  return 1
}

# make_link <dir> <link> -- a symlink, or on Windows a junction when symlinks are not
# allowed; fails (non-zero) rather than leaving a copy behind
make_link() {
  if ln -s "$1" "$2" 2>/dev/null && [[ -L $2 ]]; then return 0; fi
  [[ -e $2 && ! -L $2 ]] && rm -rf "$2"   # a copy left by a non-strict ln
  if [[ $WINDOWS -eq 1 ]] && command -v cygpath >/dev/null 2>&1; then
    cmd //c mklink //J "$(cygpath -w "$2")" "$(cygpath -w "$1")" >/dev/null 2>&1 && [[ -L $2 || -d $2 ]] && return 0
  fi
  return 1
}

# remove_link <link> -- a symlink or a Windows junction, never the folder it points at
remove_link() {
  if [[ $WINDOWS -eq 1 ]] && command -v cygpath >/dev/null 2>&1; then
    cmd //c rmdir "$(cygpath -w "$1")" >/dev/null 2>&1 && return 0
  fi
  rm "$1"
}

problems=0

if [[ $mode == uninstall ]]; then
  for target in "${targets[@]}"; do
    [[ -d $target ]] || continue
    for link in "$target"/*; do
      if [[ -L $link ]]; then
        if owned_by_repo "$link"; then
          remove_link "$link"; echo "removed  $link"
        fi
      elif [[ -d $link && -f $link/SKILL.md ]] && grep -q "$(basename "$link")" <(for d in "$SKILLS_DIR"/*/; do install_name "$d/SKILL.md"; done) 2>/dev/null; then
        echo "left     $link (a copy, not a link -- delete it by hand)" >&2
        problems=$((problems + 1))
      fi
    done
  done
  exit $(( problems > 0 ? 1 : 0 ))
fi

found=0
all_names=()
matched=()
for dir in "$SKILLS_DIR"/*/; do
  dir="${dir%/}"
  md="$dir/SKILL.md"
  [[ -f $md ]] || continue

  name="$(install_name "$md")"
  [[ -n $name ]] || name="$(basename "$dir")"
  all_names+=("$name")
  wants "$name" || continue
  matched+=("$name")
  found=$((found + 1))

  if [[ $mode == list ]]; then
    printf '%-28s %s\n' "$name" "skills/$(basename "$dir")"
    continue
  fi

  for target in "${targets[@]}"; do
    mkdir -p "$target"
    link="$target/$name"
    if [[ -L $link ]]; then
      if owned_by_repo "$link"; then
        remove_link "$link"
      else
        echo "skip     $link (symlink to another install -- remove it first)" >&2
        problems=$((problems + 1))
        continue
      fi
    elif [[ -e $link ]]; then
      echo "skip     $link (real file/dir, not a symlink: an older copy? move it aside first)" >&2
      problems=$((problems + 1))
      continue
    fi
    if make_link "$dir" "$link"; then
      echo "linked   $link -> skills/$(basename "$dir")"
    else
      echo "error    could not link $link (on Windows: enable Developer Mode, or run from an elevated shell)" >&2
      problems=$((problems + 1))
    fi
  done
done

if [[ ${#wanted[@]} -gt 0 && $found -ne ${#wanted[@]} ]]; then
  for w in "${wanted[@]}"; do
    for m in "${matched[@]:-}"; do [[ $w == "$m" ]] && continue 2; done
    echo "error: no skill named '$w'" >&2
  done
  echo "valid install names:" >&2
  printf '  %s\n' "${all_names[@]}" >&2
  exit 1
fi

if [[ $problems -gt 0 ]]; then
  echo "$problems install(s) not done: see the lines above" >&2
  exit 1
fi
