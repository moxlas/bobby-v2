#!/usr/bin/env node
/**
 * Guards the locale files against drifting apart.
 *
 * Fails when:
 *  - a key exists in one locale but not another
 *  - a value is empty
 *  - {placeholders} differ between locales
 *  - source code calls t('some.key') that no locale defines
 *
 * Run with: pnpm i18n:check
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const LOCALES = ['en', 'lt'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.idea', '.vercel', 'scripts']);

const flatten = (value, prefix = '', out = new Map()) => {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(child)) {
      child.forEach((item, index) => {
        if (item && typeof item === 'object') flatten(item, `${path}[${index}]`, out);
        else out.set(`${path}[${index}]`, String(item));
      });
    } else if (child && typeof child === 'object') {
      flatten(child, path, out);
    } else {
      out.set(path, String(child));
    }
  }
  return out;
};

const placeholders = (text) => (text.match(/\{(\w+)\}/g) ?? []).sort().join(',');

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [full] : [];
  });

const messages = Object.fromEntries(
  LOCALES.map((lang) => [lang, flatten(JSON.parse(readFileSync(`locales/${lang}.json`, 'utf8')))]),
);

const base = messages[LOCALES[0]];
const problems = [];

for (const lang of LOCALES.slice(1)) {
  const other = messages[lang];
  for (const key of base.keys()) {
    if (!other.has(key)) {
      problems.push(`missing in ${lang}: ${key}`);
      continue;
    }
    if (!other.get(key).trim()) problems.push(`empty value in ${lang}: ${key}`);
    if (placeholders(base.get(key)) !== placeholders(other.get(key))) {
      problems.push(`placeholder mismatch in ${lang}: ${key}`);
    }
  }
  for (const key of other.keys()) {
    if (!base.has(key)) problems.push(`extra key in ${lang}: ${key}`);
  }
}

// Keys referenced from source must exist (skips template keys like `card.value.${value}`).
const sourceRefs = new Map();
const callPattern = /\bt\(\s*'([a-zA-Z0-9_.[\]]+)'/g;
for (const file of walk('.')) {
  const source = readFileSync(file, 'utf8');
  let match;
  while ((match = callPattern.exec(source))) {
    const key = match[1];
    if (!sourceRefs.has(key)) sourceRefs.set(key, file);
  }
}

for (const [key, file] of sourceRefs) {
  if (!base.has(key)) problems.push(`undefined key used in ${file}: ${key}`);
}

if (problems.length > 0) {
  console.error(`i18n check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `i18n check passed: ${base.size} keys in ${LOCALES.join(' / ')}, ${sourceRefs.size} static references resolved.`,
);
