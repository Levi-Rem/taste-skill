# DeepSeek Harness (DSH)

`design-taste-frontend` (tasteskill 2.5.x) runs as a normal DSH skill: the same `SKILL.md`, the same
`references/` and the same Node scripts. This page covers where DSH looks for it, what a load returns,
what differs from Claude Code and Codex, and how to fix a skill that does not appear.

## Install

User level, available in every project:

```bash
mkdir -p "$HOME/.dsh/skills"
cp -R skills/taste-skill "$HOME/.dsh/skills/design-taste-frontend"
```

Project level, available in one repository:

```bash
mkdir -p .dsh/skills
cp -R skills/taste-skill .dsh/skills/design-taste-frontend
```

`node install.mjs --dsh` and `node install.mjs --dsh --project` do the same from a clone, and
`./install.sh --dsh` copies it through `install.mjs` (`--project` for a project). The folder
`design-taste-frontend` is the convention the installers use; DSH scans only one level below each
root, so `SKILL.md` must sit directly in that folder.

## Where DSH looks

Roots by rank:

| Rank | Root | Path |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | each directory in `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` (the `.system` folder is skipped) |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | bundled | `DSH_BUNDLED_SKILL_DIR` |

- `<projectRoot>` is the nearest ancestor containing `.git`, else the current directory.
- `<dshHome>` is `$DSH_HOME` when set, else `~/.dsh` (so user level is `~/.dsh/skills` by default).
- Only one level is scanned: `<root>/<name>/SKILL.md` or `<root>/<name>.md`. A nested `**/SKILL.md`
  is never found and package manifests are ignored.
- The watcher covers depth 1 and the skill body is re-read on every load, so edits need no restart.

## What a load looks like

The model-side catalog shows one line per skill:

```
- `design-taste-frontend`: tasteskill 2.5.1, the anti-slop frontend skill. Builds websites; use ...
```

The description is normalized and capped at `catalogDescriptionMaxLength`, which is **500 characters**
by default.

Loading it (through the `skill` tool, or when the user types `/design-taste-frontend`) returns:

```
<skill_content name="design-taste-frontend">
<skill_resources>
  ... <resource-guidance> ...
</skill_resources>

<skill_instructions>
... the SKILL.md body ...
</skill_instructions>
</skill_content>
```

For a directory skill DSH also prints the base directory in the guidance:

```
Base directory for this skill: <path>
Resolve relative paths mentioned by this skill against the base directory before using them.
Load referenced resources only as needed.
```

That `<path>` is `<skill>` in every command in this repo (`node <skill>/scripts/gate.mjs <page>`).
DSH performs no variable substitution.

## Differences from Claude Code and Codex

| Aspect | DSH | Claude Code / Codex |
| --- | --- | --- |
| Frontmatter keys | `name`, `description`, `whenToUse`, `metadata`, `disable-model-invocation`, `user-invocable`. Other keys are ignored (the `hooks:` block in this repo's `SKILL.md` is Claude Code's and costs nothing here), except the three legacy camelCase spellings `disableModelInvocation`, `modelInvocable` and `userInvocable`, which DSH rejects with a warning and drops the skill. | Claude Code reads a `hooks:` block from skill frontmatter; Codex uses `.codex/hooks.json`. |
| Stop hook | **None.** Run `node <skill>/scripts/gate.mjs <page>` by hand. | A Stop hook runs the gate at the end of the turn in Claude Code; Codex takes the same command from `.codex/hooks.json` (see `references/gate.md`). |
| Base directory | No substitution. The skill tool result prints `Base directory for this skill: <path>`; use it as `<skill>`. | Claude Code substitutes its path variables before a command runs. |
| Catalog description | A bullet per skill, `- <name>: <description>`, capped at 500 characters. | — |

Booleans must be strict (`true`/`false`, `yes`/`no`, `on`/`off`, `1`/`0`); an invalid value drops the
whole skill with a warning.

## Troubleshooting

**The skill is not in the list.** Check, in this order:

- The file is `<root>/design-taste-frontend/SKILL.md` (or `<root>/design-taste-frontend.md`), one level
  under a root from the table. Extra nesting, such as `<root>/design-taste-frontend/skills/SKILL.md`, is
  not scanned.
- The root is right. A project-level install must sit under the nearest `.git` ancestor, not only under
  the current directory.
- The frontmatter opens with `---` at line 1, closes with `---`, and has a kebab-case `name` and a
  `description`. An invalid `disable-model-invocation` or `user-invocable` drops the skill with a
  warning; other unknown keys are ignored, not an error, with one exception: the legacy camelCase
  spellings `disableModelInvocation`, `modelInvocable` and `userInvocable` are rejected with a
  warning and drop the skill too.
- The skill was just installed: refresh the skill list. The body is re-read on every load, so a
  restart is not needed.

**`Error: invalid skill name "<name>"`** — DSH rejected the name before looking it up. Names are
kebab-case: `/design-taste-frontend`, no spaces, capitals, underscores or slashes. Check the name you
typed and `name:` in the frontmatter.

**Duplicate names.** A user-level and a project-level copy both provide `design-taste-frontend`. Keep
one: check the project roots (`<git root>/.dsh/skills`, `<git root>/.agents/skills`), the user roots
(`~/.dsh/skills` when `DSH_HOME` is unset, `<agentsHome>/skills`) and `Config.customSkillDirs`.

**`Error: skill "<name>" is unknown or no longer available`** — the folder was removed or moved while
the session held it. Reinstall it and reload.

**`Error: skill "<name>" is not available for model invocation`** — the frontmatter sets
`disable-model-invocation: true`, which hides the skill from the catalog and the `skill` tool while
the user can still type `/design-taste-frontend`.

## Uninstall

```bash
node install.mjs --dsh --uninstall              # user level
node install.mjs --dsh --project --uninstall    # project level
```

Or delete the folder yourself:

```bash
rm -rf "$HOME/.dsh/skills/design-taste-frontend"     # user level
rm -rf .dsh/skills/design-taste-frontend             # project level, from the git root
```

Nothing else is installed; `install.mjs` leaves one small marker file beside the folder so a later
`--uninstall` removes only what it installed, and removes both. `.taste-skill` build state lives in
the project that was built, not in the skill.
