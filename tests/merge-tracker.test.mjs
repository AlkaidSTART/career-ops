import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

import { parseTsvContent } from '../merge-tracker.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function createWorkspace(prefix = 'career-ops-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(join(ROOT, 'merge-tracker.mjs'), join(dir, 'merge-tracker.mjs'));
  cpSync(join(ROOT, 'verify-pipeline.mjs'), join(dir, 'verify-pipeline.mjs'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'batch/tracker-additions'), { recursive: true });
  writeFileSync(join(dir, 'data/applications.md'), [
    '# Applications',
    '',
    '| # | Fecha | Empresa | Rol | Score | Estado | PDF | Report | Notas |',
    '|---|-------|---------|-----|-------|--------|-----|--------|-------|',
    '| 5 | 2026-03-01 | Acme Corp | Senior AI Engineer | 3.5/5 | Evaluada | ✅ | [005](reports/005.md) | initial |',
  ].join('\n'));
  return dir;
}

test('parseTsvContent preserves empty cells in pipe-delimited rows', () => {
  const row = '| 12 | 2026-03-03 | Gamma Inc | ML Infrastructure Engineer | 4.2/5 | Evaluada |  | [012](reports/012.md) |  |';
  const parsed = parseTsvContent(row, '12.tsv');
  assert.ok(parsed);
  assert.equal(parsed.num, 12);
  assert.equal(parsed.company, 'Gamma Inc');
  assert.equal(parsed.score, '4.2/5');
  assert.equal(parsed.status, 'Evaluada');
  assert.equal(parsed.pdf, '');
  assert.equal(parsed.report, '[012](reports/012.md)');
  assert.equal(parsed.notes, '');
});

test('merge-tracker keeps highest score across multiple same-batch updates to one existing row', () => {
  const dir = createWorkspace();
  try {
    writeFileSync(
      join(dir, 'batch/tracker-additions/1.tsv'),
      '5\t2026-03-02\tAcme Corp\tSenior AI Engineer\tEvaluada\t4.0/5\t✅\t[005](reports/005.md)\tsecond'
    );
    writeFileSync(
      join(dir, 'batch/tracker-additions/2.tsv'),
      '5\t2026-03-03\tAcme Corp\tSenior AI Engineer\tEvaluada\t4.5/5\t✅\t[005](reports/005.md)\tthird'
    );

    execFileSync(process.execPath, [join(dir, 'merge-tracker.mjs')], { encoding: 'utf-8' });
    const content = readFileSync(join(dir, 'data/applications.md'), 'utf-8');
    const dataRows = content.split('\n').filter(l => /^\| \d+ \|/.test(l));
    assert.equal(dataRows.length, 1);
    assert.match(dataRows[0], /\| 5 \| 2026-03-03 \| Acme Corp \| Senior AI Engineer \| 4\.5\/5 \|/);
    assert.match(dataRows[0], /third/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge-tracker deduplicates intra-batch duplicates and keeps highest score', () => {
  const dir = createWorkspace();
  try {
    writeFileSync(
      join(dir, 'batch/tracker-additions/3.tsv'),
      '10\t2026-03-03\tBeta Labs\tStaff Platform Engineer\tEvaluada\t4.1/5\t❌\t[010](reports/010.md)\tfirst'
    );
    writeFileSync(
      join(dir, 'batch/tracker-additions/4.tsv'),
      '11\t2026-03-03\tBeta Labs\tStaff Platform Engineer\tEvaluada\t4.8/5\t❌\t[011](reports/011.md)\tsecond'
    );

    execFileSync(process.execPath, [join(dir, 'merge-tracker.mjs')], { encoding: 'utf-8' });
    const content = readFileSync(join(dir, 'data/applications.md'), 'utf-8');
    const betaRows = content.split('\n').filter(l => l.includes('Beta Labs'));
    assert.equal(betaRows.length, 1);
    assert.match(betaRows[0], /\| 4\.8\/5 \|/);
    assert.match(betaRows[0], /\[011\]\(reports\/011\.md\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge-tracker leaves malformed TSVs in tracker-additions while moving processed ones', () => {
  const dir = createWorkspace();
  try {
    writeFileSync(join(dir, 'batch/tracker-additions/1.tsv'), 'not-a-valid-row');
    writeFileSync(
      join(dir, 'batch/tracker-additions/2.tsv'),
      '| 12 | 2026-03-03 | Gamma Inc | ML Infrastructure Engineer | 4.2/5 | Evaluada |  | [012](reports/012.md) |  |'
    );

    execFileSync(process.execPath, [join(dir, 'merge-tracker.mjs')], { encoding: 'utf-8' });
    assert.equal(existsSync(join(dir, 'batch/tracker-additions/1.tsv')), true);
    assert.equal(existsSync(join(dir, 'batch/tracker-additions/merged/1.tsv')), false);
    assert.equal(existsSync(join(dir, 'batch/tracker-additions/2.tsv')), false);
    assert.equal(existsSync(join(dir, 'batch/tracker-additions/merged/2.tsv')), true);

    const content = readFileSync(join(dir, 'data/applications.md'), 'utf-8');
    assert.match(content, /\| 12 \| 2026-03-03 \| Gamma Inc \| ML Infrastructure Engineer \| 4\.2\/5 \| Evaluada \|  \| \[012\]\(reports\/012\.md\) \|  \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merge-tracker --verify works when workspace path contains spaces', () => {
  const dir = createWorkspace('career ops with spaces ');
  try {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    writeFileSync(join(dir, 'reports/005.md'), '# Report 005\n');
    writeFileSync(join(dir, 'reports/010.md'), '# Report 010\n');
    writeFileSync(
      join(dir, 'batch/tracker-additions/1.tsv'),
      '10\t2026-03-03\tDelta AI\tApplied AI Engineer\tEvaluada\t4.4/5\t❌\t[010](reports/010.md)\tnotes'
    );
    const out = execFileSync(
      process.execPath,
      [join(dir, 'merge-tracker.mjs'), '--verify'],
      { encoding: 'utf-8' }
    );
    assert.match(out, /Running verification/);
    assert.match(out, /Pipeline Health: 0 errors/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
