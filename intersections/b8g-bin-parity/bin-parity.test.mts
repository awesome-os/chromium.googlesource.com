import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditBinParity, stampNodeTriplet, healBinParity } from './bin-parity.mts';

test('stampNodeTriplet creates complete atomic (posix, cmd+utf8, ps1) triplet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b8g-parity-'));
  try {
    stampNodeTriplet(dir, 'my-tool', 'intersections/my-tool/cli.mts');
    const report = auditBinParity(dir);
    assert.equal(report.totalTools, 1);
    assert.equal(report.compliantTools, 1);
    assert.equal(report.violations.length, 0);

    const cmdTxt = readFileSync(join(dir, 'my-tool.cmd'), 'utf8');
    assert.ok(cmdTxt.includes('chcp 65001 >nul'), 'cmd wrapper must enforce UTF-8 codepage');
    assert.ok(cmdTxt.includes('intersections\\my-tool\\cli.mts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auditBinParity detects orphaned .ps1 and healBinParity restores 100% parity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b8g-parity-heal-'));
  try {
    writeFileSync(
      join(dir, 'orphan-tool.ps1'),
      `& (Join-Path $PSScriptRoot 'node.ps1') (Join-Path $Root 'sections\\demo\\run.mts') @args\n`,
      'utf8',
    );
    const before = auditBinParity(dir);
    assert.equal(before.violations.length, 1);
    assert.deepEqual(before.violations[0].missing, ['posix', 'cmd']);

    healBinParity(dir);
    const after = auditBinParity(dir);
    assert.equal(after.violations.length, 0);
    assert.equal(after.compliantTools, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
