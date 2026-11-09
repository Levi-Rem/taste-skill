#!/usr/bin/env node
/*
  taste-skill installer: DeepSeek Harness (DSH), Claude Code, Codex.

  Copies skills/taste-skill into a skills root as design-taste-frontend/ (a folder, not a
  symlink), through a temp folder and a rename so a half-written install is never visible.
  Zero dependencies, Node 18+.

    node install.mjs                              # DSH, user level
    node install.mjs --project                    # DSH, <git root>/.dsh/skills
    node install.mjs --claude                     # Claude Code, ~/.claude/skills
    node install.mjs --all                        # all three, user level
    node install.mjs --target "D:/some skills"    # any skills root
    node install.mjs --uninstall                  # remove exactly what was installed
    node install.mjs --list                       # show every target and its state

  Run `node install.mjs --help` for the flags. Exit codes: 0 ok, 1 failed, 2 bad usage.
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'skills', 'taste-skill');
// DSH scans exactly one level: <root>/<name>/SKILL.md. The folder is fixed so every
// install lands where the docs, tests and the /design-taste-frontend command expect it.
const SKILL_FOLDER = 'design-taste-frontend';
// Owns the install. Next to the folder, not inside it, so the skill's resource list stays clean.
const MARKER = `.${SKILL_FOLDER}.install.json`;
const SKIP = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db']);
const USAGE_EXIT = 2;

const STATE = {
  absent: 'not installed',
  stale: 'not installed (a stale marker is left)',
  link: 'a symlink this script did not create',
  file: 'a file with that name',
  foreign: 'a folder this script did not install',
  ours: 'installed',
};

const USAGE = `taste-skill installer: DeepSeek Harness (DSH), Claude Code, Codex.

Usage:
  node install.mjs [agent] [where] [options]      install, or refresh an install
  node install.mjs --uninstall [agent] [where]    remove what this script installed
  node install.mjs --list [agent] [where]         show targets and their state

Agents (default: --dsh):
  --dsh          DeepSeek Harness
  --claude       Claude Code
  --codex        Codex
  --all          all three

Where (default: --user):
  --user         user level
  --project      project level: nearest ancestor of the current folder with .git
                 (else the current folder), then /.dsh/skills. DSH only, because
                 that is DSH's project-root rule. For a Claude Code project
                 install use: --claude --target .claude/skills
  --target <dir>  <dir> is the skills root; the skill goes to <dir>/design-taste-frontend

Options:
  --force        replace (or remove) a folder this script did not install
  --help, -h     this text

What it does:
  Copies skills/taste-skill into <root>/design-taste-frontend (a folder, not a
  symlink) through a temp folder and a rename, so a half-copied install is never
  visible. Re-running is safe: an install made by this script is replaced; a
  foreign folder is refused unless --force. --uninstall removes exactly that
  folder and the hidden marker beside it and prints the path; nothing else is
  touched. A stale marker from an interrupted uninstall is cleaned up.

Targets:
  dsh user       $DSH_HOME/skills        (DSH_HOME, else ~/.dsh/skills)
  dsh project    <git root>/.dsh/skills  (git root as DSH defines it: .git, else cwd)
  claude user    ~/.claude/skills
  codex user     ~/.codex/skills

Exit codes: 0 ok, 1 install or removal failed, 2 bad usage.`;

class UsageError extends Error {}

const usageError = (message) => {
  throw new UsageError(message);
};

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const o = {
    agents: new Set(),
    level: null,
    levelSet: false,
    target: null,
    uninstall: false,
    list: false,
    force: false,
  };
  const need = (flag, argv, i) => {
    const value = argv[i + 1];
    if (value === undefined || value === '' || value.startsWith('-')) usageError(`${flag} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dsh': o.agents.add('dsh'); break;
      case '--claude': o.agents.add('claude'); break;
      case '--codex': o.agents.add('codex'); break;
      case '--all': for (const agent of ['dsh', 'claude', 'codex']) o.agents.add(agent); break;
      case '--user':
      case '--project': {
        const level = a.slice(2);
        if (o.levelSet && o.level !== level) usageError('--user and --project cannot be combined');
        o.level = level;
        o.levelSet = true;
        break;
      }
      case '--target': o.target = need(a, argv, i++); break;
      case '--uninstall': o.uninstall = true; break;
      case '--list': o.list = true; break;
      case '--force': o.force = true; break;
      default:
        if (a.startsWith('-')) usageError(`unknown flag: ${a}`);
        usageError(`unexpected argument: ${a} (a folder goes after --target)`);
    }
  }
  return o;
}

function resolveOptions(o) {
  if (!o.agents.size) o.agents.add('dsh');
  if (o.list && o.uninstall) usageError('--list and --uninstall cannot be combined');
  if (o.target !== null) {
    if (o.levelSet) usageError('--target names the skills root itself; do not add --user or --project');
    if (o.agents.size > 1) usageError('--target installs one copy; pick one of --dsh, --claude or --codex');
  } else if (o.level === 'project') {
    const others = [...o.agents].filter((agent) => agent !== 'dsh');
    if (others.length) {
      usageError(`--project is DSH-only in this installer; for ${others.join('/')} use --target <dir>`);
    }
  }
  return o;
}

// ---------------------------------------------------------------- targets

// DSH's project root: nearest ancestor containing .git, else the current folder.
function gitRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    let hasGit = false;
    try { fs.lstatSync(path.join(dir, '.git')); hasGit = true; } catch { /* keep walking */ }
    if (hasGit) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

function dshHome() {
  const fromEnv = (process.env.DSH_HOME || '').trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), '.dsh');
}

function userRoot(agent) {
  if (agent === 'dsh') return path.join(dshHome(), 'skills');
  if (agent === 'claude') return path.join(os.homedir(), '.claude', 'skills');
  if (agent === 'codex') return path.join(os.homedir(), '.codex', 'skills');
  throw new Error(`unknown agent: ${agent}`);
}

function projectRootForDsh() {
  return path.join(gitRoot(), '.dsh', 'skills');
}

function targetsFor(o) {
  if (o.target !== null) {
    return [{ agent: [...o.agents][0], level: 'target', root: path.resolve(o.target) }];
  }
  const level = o.level || 'user';
  return [...o.agents].map((agent) => ({
    agent,
    level,
    root: level === 'project' ? projectRootForDsh() : userRoot(agent),
  }));
}

// ---------------------------------------------------------------- files

function doesExist(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

// A skills root at or inside the source would make the copy recurse into itself.
function assertSafeRoot(root) {
  const abs = path.resolve(root);
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (fold(abs) === fold(SOURCE) || fold(abs).startsWith(fold(SOURCE) + path.sep)) {
    throw new Error(`refusing to use ${abs} as a skills root: it is inside the skill source (${SOURCE})`);
  }
}

function inspect(root) {
  const dest = path.join(root, SKILL_FOLDER);
  const markerPath = path.join(root, MARKER);
  const out = { root, dest, markerPath, marker: null, markerFile: false, kind: null, state: 'absent' };
  try {
    const raw = fs.readFileSync(markerPath, 'utf8');
    out.markerFile = true;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.marker = parsed;
  } catch { /* no marker, or not JSON: not ours */ }
  try {
    const st = fs.lstatSync(dest);
    out.kind = st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file';
  } catch { out.kind = null; }

  if (!out.kind) out.state = out.markerFile ? 'stale' : 'absent';
  else if (out.kind === 'link') out.state = 'link';
  else if (out.kind !== 'dir') out.state = 'file';
  else out.state = out.marker && out.marker.skill === SKILL_FOLDER ? 'ours' : 'foreign';
  return out;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (attempt >= 4) throw e;
      sleep(100);
    }
  }
}

// Remove one path without ever following a symlink or a Windows junction into its target.
function removeEntry(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return false; }
  if (st.isSymbolicLink()) {
    try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } // a junction needs rmdir
  } else if (st.isDirectory()) {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } else {
    fs.unlinkSync(p);
  }
  return true;
}

function frontmatterName() {
  try {
    const text = fs.readFileSync(path.join(SOURCE, 'SKILL.md'), 'utf8').replace(/^\uFEFF/, '');
    const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const name = block && block[1].match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m);
    return name ? name[1].trim() : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- actions

function install(t, o) {
  assertSafeRoot(t.root);
  if (!doesExist(path.join(SOURCE, 'SKILL.md'))) {
    throw new Error(`cannot find ${path.join(SOURCE, 'SKILL.md')}; run install.mjs from the repository root`);
  }
  const cur = inspect(t.root);
  if (cur.state !== 'absent' && cur.state !== 'ours' && cur.state !== 'stale' && !o.force) {
    throw new Error(`refusing to replace ${cur.dest}: it is ${STATE[cur.state]}; pass --force to replace it`);
  }

  fs.mkdirSync(t.root, { recursive: true });
  const stamp = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const stage = path.join(t.root, `.${SKILL_FOLDER}.tmp-${stamp}`);
  const previous = path.join(t.root, `.${SKILL_FOLDER}.old-${stamp}`);
  try {
    fs.cpSync(SOURCE, stage, {
      recursive: true,
      filter: (src) => !SKIP.has(path.basename(src)),
    });
    // Move the old install aside first: if the final rename fails (a file lock, an
    // antivirus scan), the old copy is put back instead of being lost.
    const hadPrevious = doesExist(cur.dest);
    if (hadPrevious) renameWithRetry(cur.dest, previous);
    try {
      renameWithRetry(stage, cur.dest);
    } catch (e) {
      if (hadPrevious) {
        try { renameWithRetry(previous, cur.dest); } catch { /* the old copy stays under .old-<stamp> */ }
      }
      throw e;
    }
    if (hadPrevious) {
      try { removeEntry(previous); } catch { /* a leftover .old-<stamp> folder is harmless */ }
    }
  } finally {
    if (doesExist(stage)) fs.rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  const marker = {
    skill: SKILL_FOLDER,
    source: SOURCE,
    installer: 'install.mjs',
    installedAt: new Date().toISOString(),
  };
  let markerNote = '';
  try {
    fs.writeFileSync(cur.markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  } catch (e) {
    markerNote = ` (warning: could not write ${cur.markerPath}: ${e.message}; --uninstall will need --force)`;
  }

  const name = frontmatterName();
  console.log(`installed  ${name || SKILL_FOLDER}${name && name !== SKILL_FOLDER ? ` (folder ${SKILL_FOLDER}; DSH lists the frontmatter name)` : ''}`);
  console.log(`target     ${cur.dest}`);
  console.log(`source     ${SOURCE}${markerNote}`);
  return cur.dest;
}

function uninstall(t, o) {
  assertSafeRoot(t.root);
  const cur = inspect(t.root);
  if (cur.state === 'absent') {
    console.log(`not installed  ${cur.dest}`);
    return null;
  }
  if (cur.state === 'stale') {
    fs.rmSync(cur.markerPath, { force: true });
    console.log(`cleaned    ${cur.markerPath} (the skill folder was already gone)`);
    return null;
  }
  const ours = cur.state === 'ours';
  if (!ours && !o.force) {
    throw new Error(`refusing to remove ${cur.dest}: it is ${STATE[cur.state]}; pass --force to remove it`);
  }
  removeEntry(cur.dest);
  fs.rmSync(cur.markerPath, { force: true });
  const from = ours && cur.marker && typeof cur.marker.source === 'string' ? ` (installed from ${cur.marker.source})` : ' (forced)';
  console.log(`removed    ${cur.dest}${from}`);
  return cur.dest;
}

function list(o) {
  const rows = targetsFor(o).map((t) => ({ ...t, cur: inspect(t.root) }));
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
  const wAgent = Math.max(5, ...rows.map((r) => r.agent.length));
  const wLevel = Math.max(5, ...rows.map((r) => r.level.length));
  console.log('taste-skill installer');
  console.log(`source  ${SOURCE}`);
  console.log(`skill   ${SKILL_FOLDER}`);
  console.log('');
  console.log(`${pad('agent', wAgent)}  ${pad('level', wLevel)}  skills root`);
  for (const r of rows) {
    console.log(`${pad(r.agent, wAgent)}  ${pad(r.level, wLevel)}  ${r.cur.root}  [${STATE[r.cur.state]}]`);
  }
}

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  let o;
  try {
    o = resolveOptions(parseArgs(argv));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`install: ${e.message}`);
    console.error('run "node install.mjs --help" for the flags');
    return USAGE_EXIT;
  }

  if (o.list) {
    list(o);
    return 0;
  }

  let failed = 0;
  for (const t of targetsFor(o)) {
    try {
      if (o.uninstall) uninstall(t, o);
      else install(t, o);
    } catch (e) {
      console.error(`install: ${e.message}`);
      failed++;
    }
  }
  return failed ? 1 : 0;
}

// Set the code, do not call process.exit(): stdout to a pipe is async and would be cut off.
process.exitCode = main();
