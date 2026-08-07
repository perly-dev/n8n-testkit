import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../lead-intake.workflow.json', import.meta.url), 'utf8');

function writeMutation(filename, before, after) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${filename}: expected exactly one mutation target, found ${occurrences}`);
  }
  writeFileSync(new URL(filename, import.meta.url), source.replace(before, after));
}

writeMutation(
  'm01-leading-zero.workflow.json',
  'const TOGLI_ZERO_INIZIALE = false;',
  'const TOGLI_ZERO_INIZIALE = true;',
);

writeMutation(
  'm02-link-threshold.workflow.json',
  'const MAX_LINK = 2;',
  'const MAX_LINK = 3;',
);

writeMutation(
  'm03-nested-array.workflow.json',
  'if (Array.isArray(v)) return v.map(ripulisci);',
  'if (Array.isArray(v)) return v;',
);

console.log('Wrote 3 mutation workflows.');
