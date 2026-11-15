// Exports backend/scripts/test-scripts.ts to ml/hmm/data/test_scripts.json for the HMM evaluation.
// Usage (from repo root): npx tsx ml/hmm/export-test-scripts.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { TEST_SCRIPTS } from '../../backend/scripts/test-scripts.js';

const out = new URL('./data/test_scripts.json', import.meta.url);
mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify(TEST_SCRIPTS.map(({ name, expectedPeak, lines }) => ({ name, expectedPeak, lines })), null, 2));
console.log(`wrote ${TEST_SCRIPTS.length} scripts to ${out.pathname}`);
