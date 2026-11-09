#!/usr/bin/env node
// Does this skill install and load in DeepSeek Harness (DSH)? Offline, no dependencies.
//
//   node tests/dsh-compat.mjs
//
// It checks, against the DSH facts written up in DSH.md: (a) the installed layout is
// <root>/design-taste-frontend/SKILL.md, the only shape DSH's one-level scan finds; (b) the
// frontmatter has the required keys, only keys DSH knows or the Claude Code/Codex-only hooks:
// block, literal true/false booleans, and none of the legacy camelCase invocation keys DSH
// rejects; (c) the description is at most 500 characters (the model catalog's cap; DSH truncates
// silently past it); (d) no ${CLAUDE_} or $CLAUDE_ variable in the instructions DSH shows (the
// SKILL.md body, references/ except the hook chapter of gate.md, which is labelled Claude Code /
// Codex only); (e) every `node <skill>/...` command names a file in this repo; (f) install.mjs
// installs the whole tree into a path with a space and unicode, is idempotent, refuses a foreign
// folder, replaces it with --force, finds the project root at the nearest .git ancestor, exits 2
// on bad usage, and --uninstall removes exactly what it made (and refuses a foreign folder).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, 'skills', 'taste-skill');
const SKILL_MD = path.join(SKILL, 'SKILL.md');
const INSTALL = path.join(ROOT, 'install.mjs');
const NAME = 'design-taste-frontend';
const MARKER = `.${NAME}.install.json`;
const KNOWN = ['name', 'description', 'whenToUse', 'metadata', 'disable-model-invocation', 'user-invocable'];
// DSH rejects these spellings outright (it asks for the kebab-case keys above) and drops the skill.
const LEGACY = ['disableModelInvocation', 'modelInvocable', 'userInvocable'];
const STRICT_BOOLEANS = ['disable-model-invocation', 'user-invocable'];
const SKIP = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db']);

const failures = [];
const warnings = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);
const warn = (where, message) => warnings.push(`${where}: ${message}`);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

// ---------------------------------------------------------------- frontmatter (no YAML parser)

function unquote(raw) {
  const s = raw.trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.endsWith(s[0])) {
    const body = s.slice(1, -1);
    return s[0] === "'" ? body.replace(/''/g, "'") : body.replace(/\\(["\\])/g, '$1');
  }
  return s;
}

// the body of a `>` (folded) or `|` (literal) block scalar, without the trailing newline
function blockValue(lines, style) {
  const indents = lines.filter((l) => l.trim() !== '').map((l) => l.match(/^\s*/)[0].length);
  const indent = indents.length ? Math.min(...indents) : 0;
  const cut = lines.map((l) => l.slice(Math.min(indent, l.match(/^\s*/)[0].length)).trimEnd());
  if (style === '|') return cut.join('\n').replace(/\n+$/, '');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(para.join(' ')); para = []; } };
  for (const line of cut) {
    if (line.trim() === '') { flush(); if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    para.push(line.trim());
  }
  flush();
  return out.join('\n').replace(/\n+$/, '');
}

// returns null when there is no --- block, else [{ key, value, quoted, line }] for top-level keys
function parseFrontmatter(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const block = clean.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!block) return null;
  const lines = block[1].split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (/^\s/.test(line)) { entries.push({ key: null, raw: line, line: i + 2 }); continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!kv) { entries.push({ key: null, raw: line, line: i + 2 }); continue; }
    const key = kv[1];
    const rest = kv[2].trim();
    const nested = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() !== '' && !/^\s/.test(lines[j])) break;
      nested.push(lines[j]);
    }
    const hasNested = nested.some((l) => l.trim() !== '');
    let value;
    if (rest === '' && hasNested) value = null;                 // a mapping or a list (metadata:, hooks:)
    else if (/^[>|][+-]?$/.test(rest)) value = blockValue(nested, rest[0]);
    else if (/^["']/.test(rest)) value = unquote(rest);
    else if (rest.startsWith('{') || rest.startsWith('[')) value = rest;
    else if (rest !== '' && hasNested) {
      // a plain scalar folded over its indented continuation lines
      value = [rest, ...nested.filter((l) => l.trim() !== '').map((l) => l.trim())].join(' ');
    } else value = rest;
    entries.push({ key, value, quoted: /^["']/.test(rest), line: i + 2 });
    i = j - 1;
  }
  return entries;
}

// ---------------------------------------------------------------- checks

function checkFrontmatter() {
  const where = rel(SKILL_MD);
  let text;
  try { text = fs.readFileSync(SKILL_MD, 'utf8'); } catch (e) {
    fail(where, `cannot read it: ${e.message}`); return null;
  }
  const entries = parseFrontmatter(text);
  if (!entries) {
    fail(where, 'no --- frontmatter block at the top; DSH will not load the skill');
    return null;
  }
  const seen = new Set();
  const byKey = new Map();
  for (const entry of entries) {
    if (entry.key === null) {
      fail(`${where}:${entry.line}`, `frontmatter line is not a "key: value" pair: ${JSON.stringify(entry.raw.trim())}`);
      continue;
    }
    if (seen.has(entry.key)) fail(`${where}:${entry.line}`, `duplicate frontmatter key "${entry.key}"`);
    seen.add(entry.key);
    byKey.set(entry.key, entry);
    if (LEGACY.includes(entry.key)) {
      fail(`${where}:${entry.line}`, `frontmatter key "${entry.key}" is the legacy camelCase spelling; DSH rejects it and drops the skill (write "${entry.key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}")`);
    } else if (!KNOWN.includes(entry.key) && entry.key !== 'hooks') {
      fail(`${where}:${entry.line}`, `frontmatter key "${entry.key}" is not one DSH reads (${KNOWN.join(', ')}); DSH silently ignores keys it does not know`);
    }
  }

  // hooks: is Claude Code / Codex only. DSH's loader reads name, description, whenToUse and
  // metadata, so it ignores the key and the block can stay for the other hosts.
  const hooks = byKey.get('hooks');
  if (hooks) {
    const from = text.slice(text.search(/^hooks:[ \t]*$/m));
    const block = from.slice(0, from.search(/\n---/));
    if (hooks.value !== null) {
      fail(`${where}:${hooks.line}`, '"hooks:" must be a mapping (the key on its own line, entries indented under it)');
    } else {
      if (!/^\s+Stop:/m.test(block)) fail(`${where}:${hooks.line}`, '"hooks:" has no Stop: entry; a malformed block would break the YAML both hosts parse');
      if (!/--hook claude/.test(block)) fail(`${where}:${hooks.line}`, 'the Stop hook does not run gate.mjs --hook claude');
    }
  }

  const name = byKey.get('name');
  if (!name || typeof name.value !== 'string' || !name.value.trim()) fail(where, 'name is required (a kebab-case string)');
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.value)) fail(`${where}:${name.line}`, `name must be kebab-case (got ${JSON.stringify(name.value)})`);
  else if (name.value.length > 64) fail(`${where}:${name.line}`, `name is ${name.value.length} characters; 64 at most`);
  else if (name.value !== NAME) fail(`${where}:${name.line}`, `name is "${name.value}" but install.mjs installs the folder as "${NAME}"; keep the two equal so /${NAME} and the docs agree`);

  const description = byKey.get('description');
  if (!description || typeof description.value !== 'string' || !description.value.trim()) {
    fail(where, 'description is required (a non-empty string)');
  } else {
    const n = description.value.length;
    // DSH normalizes and caps the catalog line at catalogDescriptionMaxLength (500 by default), so
    // a longer description is silently cut in the catalog. The body is unaffected either way.
    if (n > 500) fail(`${where}:${description.line}`, `description is ${n} characters; DSH's catalog keeps the first 500, so the rest never reaches the model`);
  }

  for (const key of STRICT_BOOLEANS) {
    const entry = byKey.get(key);
    if (!entry) continue;
    if (entry.quoted || (entry.value !== 'true' && entry.value !== 'false')) {
      fail(`${where}:${entry.line}`, `${key} must be the literal true or false (got ${JSON.stringify(entry.value)}); a string drops the skill in DSH`);
    }
  }

  const when = byKey.get('whenToUse');
  if (when && (typeof when.value !== 'string' || !when.value.trim())) {
    fail(`${where}:${when.line}`, 'whenToUse must be a non-empty string when present');
  }
  const metadata = byKey.get('metadata');
  if (metadata && metadata.value !== null && !metadata.value.startsWith('{')) {
    fail(`${where}:${metadata.line}`, 'metadata must be a mapping: nested keys under "metadata:" or an inline { ... }');
  }
  return byKey;
}

function checkClaudeVariables() {
  const targets = [{ file: SKILL_MD, bodyOnly: true }];
  const references = path.join(SKILL, 'references');
  if (fs.existsSync(references)) {
    for (const entry of fs.readdirSync(references, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) targets.push({ file: path.join(references, entry.name), bodyOnly: false });
    }
  }
  const variable = /\$\{?CLAUDE_[A-Za-z0-9_]*\}?/g;
  let found = 0;
  for (const { file, bodyOnly } of targets) {
    const name = rel(file);
    let text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    // gate.md's hook chapter is Claude Code / Codex only and says so; the rest of the file is
    // read on DSH too.
    if (name.endsWith('references/gate.md')) {
      if (!/## As a hook[\s\S]{0,400}DSH has no skill hooks/.test(text)) {
        fail(name, 'its hook chapter must say DSH has no skill hooks; that chapter is Claude Code / Codex only');
      }
      continue;
    }
    let offset = 0;
    if (bodyOnly) {
      // DSH renders the body, never the frontmatter (which carries the Claude Code hook).
      const block = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
      if (block) { offset = block[0].split(/\r?\n/).length - 1; text = text.slice(block[0].length); }
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      variable.lastIndex = 0;
      const match = variable.exec(line);
      if (!match) return;
      found++;
      fail(`${name}:${i + 1 + offset}`, `${match[0]} is a Claude Code variable; DSH does no variable substitution (the skill tool prints the base directory)`);
    });
  }
  if (found === 0) return true;
  return false;
}

function checkSkillCommands() {
  const where = rel(SKILL_MD);
  let text;
  try { text = fs.readFileSync(SKILL_MD, 'utf8'); } catch { return; }
  const command = /\bnode\s+"?<skill>\/([^\s"'`<>()]+)/g;
  const missing = new Map();
  let count = 0;
  for (const match of text.matchAll(command)) {
    count++;
    const file = match[1].replace(/[.,;:)\]}]+$/, '');
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    let stat = null;
    try { stat = fs.statSync(path.join(SKILL, file)); } catch { /* reported below */ }
    if (!stat || !stat.isFile()) {
      if (!missing.has(file)) missing.set(file, line);
    }
  }
  if (count === 0) warn(where, 'no "node <skill>/..." command found; the skill is expected to call its own scripts this way');
  for (const [file, line] of missing) {
    fail(`${where}:${line}`, `node <skill>/${file} does not exist in the repo`);
  }
}

function checkInstall() {
  const where = 'install.mjs';
  if (!fs.existsSync(INSTALL)) {
    fail(where, 'is missing; it is what writes the <root>/design-taste-frontend/SKILL.md layout DSH scans');
    return;
  }
  let srcFiles;
  try { srcFiles = listFiles(SKILL); } catch (e) {
    fail('skills/taste-skill', `cannot read the skill folder: ${e.message}`);
    return;
  }
  const run = (args, options = {}) => spawnSync(process.execPath, [INSTALL, ...args], { cwd: ROOT, ...options, encoding: 'utf8', timeout: 120000 });
  const tail = (r) => ((r.stderr || '') || (r.stdout || '')).trim().split(/\r?\n/).slice(-3).join(' | ');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compat '));
  // a skills root whose path has a space and a non-ASCII character
  const root = path.join(tmp, 'skills root 技能');
  const dest = path.join(root, NAME);
  const markerPath = path.join(root, MARKER);
  try {
    // a foreign folder is not overwritten without --force
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'keep.txt'), 'not this script\'s\n');
    let r = run(['--dsh', '--target', root]);
    if (r.status === 0) fail('install.mjs', 'replaced a foreign folder without --force');
    else if (!fs.existsSync(path.join(dest, 'keep.txt'))) fail('install.mjs', 'a refused install changed the foreign folder');
    fs.rmSync(dest, { recursive: true, force: true });

    // install: the layout DSH scans, the whole tree, the printed target and skill name
    r = run(['--dsh', '--target', root]);
    if (r.status !== 0) {
      fail('install.mjs', `install exited ${r.status}: ${tail(r)}`);
    } else {
      const installedMd = path.join(dest, 'SKILL.md');
      if (!fs.existsSync(installedMd)) fail('install.mjs', `no ${NAME}/SKILL.md after install; DSH scans <root>/<name>/SKILL.md at one level only`);
      if (!fs.existsSync(path.join(dest, 'scripts', 'gate.mjs'))) fail('install.mjs', `no ${NAME}/scripts/gate.mjs after install`);
      if (fs.existsSync(installedMd) && fs.readFileSync(installedMd, 'utf8') !== fs.readFileSync(SKILL_MD, 'utf8')) {
        fail('install.mjs', 'the installed SKILL.md differs from skills/taste-skill/SKILL.md');
      }
      const got = listFiles(dest);
      const missingFiles = srcFiles.filter((f) => !got.includes(f));
      const extraFiles = got.filter((f) => !srcFiles.includes(f));
      if (missingFiles.length) fail('install.mjs', `the copy is missing ${missingFiles.length} file(s): ${missingFiles.slice(0, 5).join(', ')}${missingFiles.length > 5 ? ', ...' : ''}`);
      if (extraFiles.length) fail('install.mjs', `the copy has ${extraFiles.length} file(s) that are not in skills/taste-skill: ${extraFiles.slice(0, 5).join(', ')}`);
      if (!r.stdout.includes(dest)) fail('install.mjs', 'install did not print the resolved target path');
      if (!r.stdout.includes(NAME)) fail('install.mjs', 'install did not print the skill name');
    }

    // re-install: idempotent, no temp folder or second copy left behind
    r = run(['--dsh', '--target', root]);
    if (r.status !== 0) fail('install.mjs', `re-install is not idempotent (exit ${r.status}): ${tail(r)}`);
    else {
      const got = listFiles(dest);
      if (got.join('\n') !== srcFiles.join('\n')) fail('install.mjs', 're-install changed the installed tree');
      const leftovers = fs.readdirSync(root).filter((n) => n.startsWith(`.${NAME}.tmp-`));
      if (leftovers.length) fail('install.mjs', `left a temp folder behind: ${leftovers.join(', ')}`);
      const entries = fs.readdirSync(root).sort();
      if (entries.join('\n') !== [MARKER, NAME].sort().join('\n')) fail('install.mjs', `the skills root holds ${entries.join(', ')} instead of the folder and its marker`);
    }

    // --list sees the install
    r = run(['--dsh', '--list', '--target', root]);
    if (r.status !== 0) fail('install.mjs --list', `exited ${r.status}: ${tail(r)}`);
    else if (!r.stdout.includes('installed')) fail('install.mjs --list', 'does not report the skill as installed');

    // uninstall: exactly the folder and the marker go, and the path is printed
    r = run(['--dsh', '--target', root, '--uninstall']);
    if (r.status !== 0) fail('install.mjs --uninstall', `exited ${r.status}: ${tail(r)}`);
    else {
      if (fs.existsSync(dest)) fail('install.mjs --uninstall', 'left the installed folder behind');
      if (fs.existsSync(markerPath)) fail('install.mjs --uninstall', 'left the install marker behind');
      if (!r.stdout.includes(dest)) fail('install.mjs --uninstall', 'did not print what it removed');
      const left = fs.readdirSync(root);
      if (left.length) fail('install.mjs --uninstall', `left ${left.join(', ')} in the skills root`);
    }

    // uninstalling again is a no-op that succeeds
    r = run(['--dsh', '--target', root, '--uninstall']);
    if (r.status !== 0) fail('install.mjs --uninstall', `a second uninstall exited ${r.status}: ${tail(r)}`);
    else if (!r.stdout.includes('not installed')) fail('install.mjs --uninstall', 'a second uninstall did not say it was not installed');

    // bad usage exits 2
    r = run(['--bogus']);
    if (r.status !== 2) fail('install.mjs', `an unknown flag exited ${r.status}; bad usage must exit 2`);

    // --force replaces a foreign folder
    const forcedRoot = path.join(tmp, 'skills root force');
    const forcedDest = path.join(forcedRoot, NAME);
    fs.mkdirSync(forcedDest, { recursive: true });
    fs.writeFileSync(path.join(forcedDest, 'keep.txt'), 'not this script\'s\n');
    r = run(['--dsh', '--target', forcedRoot, '--force']);
    if (r.status !== 0) fail('install.mjs --force', `exited ${r.status}: ${tail(r)}`);
    else {
      if (!fs.existsSync(path.join(forcedDest, 'SKILL.md'))) fail('install.mjs --force', 'did not install over the foreign folder');
      if (fs.existsSync(path.join(forcedDest, 'keep.txt'))) fail('install.mjs --force', 'left the foreign file in place');
    }

    // --uninstall refuses a folder it did not install
    const foreignRoot = path.join(tmp, 'skills root foreign');
    const foreignDest = path.join(foreignRoot, NAME);
    fs.mkdirSync(foreignDest, { recursive: true });
    fs.writeFileSync(path.join(foreignDest, 'keep.txt'), 'not this script\'s\n');
    r = run(['--dsh', '--target', foreignRoot, '--uninstall']);
    if (r.status === 0) fail('install.mjs --uninstall', 'removed a folder it did not install');
    else if (!fs.existsSync(path.join(foreignDest, 'keep.txt'))) fail('install.mjs --uninstall', 'a refused --uninstall changed the foreign folder');

    // --project installs under the nearest .git ancestor, not the current folder
    const project = path.join(tmp, 'project 工程');
    const deep = path.join(project, 'a', 'b');
    fs.mkdirSync(path.join(project, '.git'), { recursive: true });
    fs.mkdirSync(deep, { recursive: true });
    r = run(['--dsh', '--project'], { cwd: deep, env: { ...process.env, DSH_HOME: path.join(tmp, 'fake home') } });
    const projectDest = path.join(project, '.dsh', 'skills', NAME);
    if (r.status !== 0) fail('install.mjs --project', `exited ${r.status}: ${tail(r)}`);
    else if (!fs.existsSync(path.join(projectDest, 'SKILL.md'))) fail('install.mjs --project', `did not install under the .git ancestor (${projectDest})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// ---------------------------------------------------------------- run

checkFrontmatter();
checkClaudeVariables();
checkSkillCommands();
checkInstall();

for (const w of warnings) console.log(`warn - ${w}`);
const unique = [...new Set(failures)];
if (unique.length) {
  console.error(`not ok - ${unique.length} DSH compatibility problem(s):`);
  for (const f of unique) console.error(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log('ok - DSH layout (<root>/' + NAME + '/SKILL.md), frontmatter, description length,');
  console.log('     no $CLAUDE_ variables, every node <skill>/... path, and install/uninstall pass');
}
