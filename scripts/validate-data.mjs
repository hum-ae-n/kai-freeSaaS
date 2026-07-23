#!/usr/bin/env node
/**
 * Validates data/tools.json against the schema in PRD.md section 4.
 * Zero dependencies. Run: node scripts/validate-data.mjs [--summary]
 * Exit code 0 = clean, 1 = errors found.
 *
 * This is a dev-time gate only. It is never shipped to the browser and
 * does not make the project depend on npm or a build step.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'tools.json');

const REQUIRED = ['id', 'name', 'urls', 'category', 'type', 'description', 'alternatives', 'training', 'value', 'when'];
const TYPES = new Set(['core', 'noncore', 'm365', 'sector']);
const MIN_ALTERNATIVES = 2;
const MIN_TRAINING = 2;

const errors = [];
const warnings = [];
const err = (id, rule, msg) => errors.push({ id, rule, msg });
const warn = (id, rule, msg) => warnings.push({ id, rule, msg });

let tools;
try {
  tools = JSON.parse(readFileSync(DATA, 'utf8'));
} catch (e) {
  console.error(`FATAL: cannot parse data/tools.json: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(tools)) {
  console.error('FATAL: tools.json must be a top-level array.');
  process.exit(1);
}

/** Walk every user-facing string in a tool, for house-style checks. */
function* strings(tool) {
  yield ['name', tool.name];
  yield ['description', tool.description];
  yield ['when', tool.when];
  yield ['category', tool.category];
  for (const u of tool.urls ?? []) yield ['urls.label', u?.label];
  for (const a of tool.alternatives ?? []) yield ['alternatives.name', a?.name];
  for (const t of tool.training ?? []) yield ['training.name', t?.name];
  for (const n of tool.notes ?? []) yield ['notes', n];
  if (tool.byo !== undefined) yield ['byo', tool.byo];
  if (tool.free_limit !== undefined) yield ['free_limit', tool.free_limit];
}

const isLive = (u) => typeof u === 'string' && /^https?:\/\/.+/.test(u.trim());

const seenIds = new Map();

for (const [index, tool] of tools.entries()) {
  const id = tool?.id ?? `index:${index}`;

  for (const field of REQUIRED) {
    if (!(field in tool)) err(id, 'required-field', `missing required field "${field}"`);
  }

  // id: integer, unique, stable. Note 0 is a valid id, so check type not truthiness.
  if (!Number.isInteger(tool.id)) {
    err(id, 'id-type', `id must be an integer, got ${JSON.stringify(tool.id)}`);
  } else if (seenIds.has(tool.id)) {
    err(id, 'id-unique', `duplicate id, also used at index ${seenIds.get(tool.id)}`);
  } else {
    seenIds.set(tool.id, index);
  }

  if (!TYPES.has(tool.type)) {
    err(id, 'type-enum', `type must be one of ${[...TYPES].join(', ')}, got ${JSON.stringify(tool.type)}`);
  }

  if (!Number.isInteger(tool.value) || tool.value < 0) {
    err(id, 'value-type', `value must be a non-negative integer (GBP/yr), got ${JSON.stringify(tool.value)}`);
  }

  for (const field of ['name', 'description', 'category', 'when']) {
    if (typeof tool[field] !== 'string' || !tool[field].trim()) {
      err(id, 'empty-string', `"${field}" must be a non-empty string`);
    }
  }

  // urls[]: domain drives favicon lookup (PRD section 8), so it must be present.
  if (!Array.isArray(tool.urls) || tool.urls.length === 0) {
    err(id, 'urls-missing', 'urls must be a non-empty array');
  } else {
    for (const u of tool.urls) {
      if (!u?.domain?.trim()) err(id, 'urls-domain', `urls entry missing "domain": ${JSON.stringify(u)}`);
      if (!u?.label?.trim()) err(id, 'urls-label', `urls entry missing "label": ${JSON.stringify(u)}`);
      if (u?.domain && /^https?:\/\//.test(u.domain)) {
        err(id, 'urls-domain', `"domain" must be a bare hostname, not a URL: ${JSON.stringify(u.domain)}`);
      }
    }
  }

  // alternatives / training: every entry must be a live clickable link.
  // Non-linkable caveats belong in the optional "notes" array, not here.
  for (const [field, min] of [['alternatives', MIN_ALTERNATIVES], ['training', MIN_TRAINING]]) {
    const list = tool[field];
    if (!Array.isArray(list)) {
      err(id, `${field}-type`, `${field} must be an array`);
      continue;
    }
    const linkable = list.filter((e) => isLive(e?.url));
    if (linkable.length < min) {
      err(id, `${field}-min`, `needs at least ${min} entries with a live URL, has ${linkable.length} of ${list.length}`);
    }
    for (const entry of list) {
      if (!entry?.name?.trim()) {
        err(id, `${field}-name`, `${field} entry missing "name": ${JSON.stringify(entry)}`);
      }
      if (!isLive(entry?.url)) {
        err(id, `${field}-dead-url`, `${field} entry has no live URL, move it to "notes" or supply one: ${JSON.stringify(entry?.name ?? entry)}`);
      }
    }
  }

  if (tool.notes !== undefined && !Array.isArray(tool.notes)) {
    err(id, 'notes-type', 'optional "notes" must be an array of strings');
  }

  if (tool.archived !== undefined && typeof tool.archived !== 'boolean') {
    err(id, 'archived-type', `optional "archived" must be a boolean, got ${JSON.stringify(tool.archived)}`);
  }

  if (tool.byo !== undefined && (typeof tool.byo !== 'string' || !tool.byo.trim())) {
    err(id, 'byo-type', 'optional "byo" must be a non-empty string');
  }

  // Pricing trio (PRD section 4): each optional, validated when present.
  if (tool.free_limit !== undefined && (typeof tool.free_limit !== 'string' || !tool.free_limit.trim())) {
    err(id, 'free-limit-type', 'optional "free_limit" must be a non-empty string');
  }
  if (tool.paid_from !== undefined && (!Number.isInteger(tool.paid_from) || tool.paid_from < 0)) {
    err(id, 'paid-from-type', `optional "paid_from" must be a non-negative integer (GBP/month), got ${JSON.stringify(tool.paid_from)}`);
  }
  if (tool.scales_with !== undefined && !['users', 'usage', 'features', 'none'].includes(tool.scales_with)) {
    err(id, 'scales-with-enum', `optional "scales_with" must be users, usage, features or none, got ${JSON.stringify(tool.scales_with)}`);
  }

  // last_verified: optional ISO date, must parse and must not be in the future.
  if (tool.last_verified !== undefined) {
    const ok = typeof tool.last_verified === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(tool.last_verified)
      && !Number.isNaN(Date.parse(tool.last_verified));
    if (!ok) {
      err(id, 'last-verified-format', `optional "last_verified" must be an ISO date YYYY-MM-DD, got ${JSON.stringify(tool.last_verified)}`);
    } else if (Date.parse(tool.last_verified) > Date.now()) {
      err(id, 'last-verified-future', `"last_verified" is in the future: ${tool.last_verified}`);
    }
  }

  // PRD section 10: house style bans em dashes. En dashes for ranges are fine.
  for (const [field, value] of strings(tool)) {
    if (typeof value === 'string' && value.includes('—')) {
      err(id, 'em-dash', `em dash in ${field}: "${value.slice(0, 60)}"`);
    }
  }
}

// ids should be sequential with no gaps, so new tools get the next number.
const ids = [...seenIds.keys()].sort((a, b) => a - b);
if (ids.length) {
  const gaps = [];
  for (let i = ids[0]; i <= ids.at(-1); i++) if (!seenIds.has(i)) gaps.push(i);
  if (gaps.length) warn('-', 'id-gaps', `gaps in id sequence: ${gaps.join(', ')}`);
}

// Report ------------------------------------------------------------------
const summaryOnly = process.argv.includes('--summary');
const byRule = (list) => list.reduce((m, e) => m.set(e.rule, (m.get(e.rule) ?? 0) + 1), new Map());
const affected = (list) => new Set(list.map((e) => e.id)).size;

console.log(`tools.json: ${tools.length} tools, ${new Set(tools.map((t) => t.category)).size} categories`);
const counts = tools.reduce((m, t) => m.set(t.type, (m.get(t.type) ?? 0) + 1), new Map());
console.log(`types: ${[...counts].map(([k, v]) => `${k}=${v}`).join(' ')}`);

if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const [rule, n] of byRule(warnings)) console.log(`  ${rule}: ${n}`);
  if (!summaryOnly) for (const w of warnings) console.log(`    [${w.id}] ${w.msg}`);
}

if (!errors.length) {
  console.log('\nPASS: no schema errors.');
  process.exit(0);
}

console.log(`\nERRORS: ${errors.length} across ${affected(errors)} of ${tools.length} tools`);
for (const [rule, n] of [...byRule(errors)].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule}: ${n}`);
}
if (!summaryOnly) {
  console.log('');
  for (const e of errors) console.log(`  [${e.id}] ${e.rule}: ${e.msg}`);
} else {
  console.log('\n  (run without --summary for the full list)');
}
process.exit(1);
