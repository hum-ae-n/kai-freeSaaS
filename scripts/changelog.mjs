#!/usr/bin/env node
/**
 * Generates data/changelog.json from the git history of data/tools.json:
 * tool additions, retirements (archived flips) and paid-tier price changes.
 * Run after data changes (or from the weekly sweep): node scripts/changelog.mjs
 * Dev-time only, zero dependencies beyond git itself. The public page renders
 * the newest entries as the "Recently updated" strip; retirements are shown
 * deliberately, removals are a trust signal (see docs/how-we-choose.md).
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const commits = git('log --reverse --format="%H|%ad" --date=short -- data/tools.json')
  .trim().split('\n').filter(Boolean)
  .map((line) => { const [sha, date] = line.split('|'); return { sha, date }; });

const load = (sha) => {
  try { return JSON.parse(git(`show ${sha}:data/tools.json`)); }
  catch { return null; }
};

const entries = [];
let prev = load(commits[0].sha);
for (let i = 1; i < commits.length; i++) {
  const { sha, date } = commits[i];
  const curr = load(sha);
  if (!curr || !prev) { prev = curr ?? prev; continue; }
  const prevById = new Map(prev.map((t) => [t.id, t]));

  for (const tool of curr) {
    const before = prevById.get(tool.id);
    if (!before) {
      entries.push({ date, kind: 'added', tool: tool.name, detail: `Added ${tool.name} to ${tool.category}` });
      continue;
    }
    if (!before.archived && tool.archived) {
      entries.push({ date, kind: 'archived', tool: tool.name, detail: `Retired ${tool.name} from the directory` });
    }
    // Price changes only count when both sides carry a real figure, so the
    // one-off population of the pricing fields does not read as 80 changes.
    if (Number.isInteger(before.paid_from) && Number.isInteger(tool.paid_from) && before.paid_from !== tool.paid_from) {
      entries.push({ date, kind: 'price', tool: tool.name, detail: `${tool.name} paid tier is now £${tool.paid_from}/month (was £${before.paid_from})` });
    }
  }
  prev = curr;
}

entries.reverse(); // newest first
const out = entries.slice(0, 12);
writeFileSync(join(ROOT, 'data', 'changelog.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`data/changelog.json: ${out.length} entries (${entries.length} total in history)`);
for (const e of out.slice(0, 6)) console.log(`  ${e.date} [${e.kind}] ${e.detail}`);
