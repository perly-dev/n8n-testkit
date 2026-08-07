import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const cli = fileURLToPath(new URL('../bin/n8n-testkit.js', import.meta.url));
const evidenceDir = new URL('evidence/', import.meta.url);
mkdirSync(evidenceDir, { recursive: true });

const build = spawnSync(process.execPath, [fileURLToPath(new URL('mutations/build-mutations.mjs', import.meta.url))], {
  cwd: here,
  encoding: 'utf8',
});
if (build.status !== 0) throw new Error((build.stdout || '') + (build.stderr || 'mutation build failed'));

const runs = [
  ['baseline.txt', 'lead-intake.qa.tests.json', 0],
  ['f02-open-honeypot-mismatch.txt', 'findings/f02-honeypot-doc-mismatch.tests.json', 1],
  ['m01-leading-zero.txt', 'mutations/m01-leading-zero.tests.mjs', 1],
  ['m02-link-threshold.txt', 'mutations/m02-link-threshold.tests.mjs', 1],
  ['m03-nested-array.txt', 'mutations/m03-nested-array.tests.mjs', 1],
];

for (const [logName, suite, expectedExit] of runs) {
  const run = spawnSync(process.execPath, [cli, fileURLToPath(new URL(suite, import.meta.url))], {
    cwd: here,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const output = (run.stdout || '') + (run.stderr || '');
  writeFileSync(new URL(logName, evidenceDir), `${output}EXIT_CODE=${run.status}\n`);
  if (run.status !== expectedExit) {
    throw new Error(`${suite}: expected exit ${expectedExit}, got ${run.status}\n${output}`);
  }
  console.log(`${suite}: exit ${run.status} (expected ${expectedExit})`);
}

const baseline = readFileSync(new URL('baseline.txt', evidenceDir), 'utf8');
if (!baseline.includes('21 of 21 passed')) throw new Error('baseline summary was not found');
console.log('Evidence logs verified.');
