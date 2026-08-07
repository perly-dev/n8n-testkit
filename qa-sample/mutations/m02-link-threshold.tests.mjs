import { readFileSync } from 'node:fs';

const suite = JSON.parse(readFileSync(new URL('../lead-intake.qa.tests.json', import.meta.url), 'utf8'));
export default { ...suite, workflow: 'm02-link-threshold.workflow.json' };
