import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPsContext, runPsScript } from './ps-engine.mts';

test('Zero-CLR PowerShell executes object pipelines (Get-ChildItem | Where-Object | Select-Object | Measure-Object)', () => {
  const ctx = createPsContext({ cwd: process.cwd() });
  const out = runPsScript(
    `
    $files = Get-ChildItem intersections/b8g-ps-compat -File | Where-Object { $_.Name -like '*.mts' } | Select-Object Name
    $files | Measure-Object
    `,
    ctx,
  );
  const measure = out.results[0] as { Count: number };
  assert.ok(measure.Count >= 3, `expected >= 3 .mts files, got ${measure.Count}`);
});

test('Zero-CLR .NET BCL static calls ([System.IO.File], [math], [System.Guid], [System.Environment]) work with 0 MB CLR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b8g-ps-bcl-'));
  try {
    const file = join(dir, 'hello.txt').replace(/\\/g, '/');
    const ctx = createPsContext({ cwd: dir });
    const out = runPsScript(
      `
      [System.IO.File]::WriteAllText('${file}', 'Zero-CLR Victory')
      [System.IO.File]::ReadAllText('${file}')
      [math]::Round(3.14159, 2)
      [System.Environment]::ProcessorCount
      [System.Guid]::NewGuid()
      `,
      ctx,
    );
    assert.equal(out.results[0], 'Zero-CLR Victory');
    assert.equal(out.results[1], 3.14);
    assert.ok(Number(out.results[2]) >= 1);
    assert.match(String(out.results[3]), /^[0-9a-f-]{36}$/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Zero-CLR PowerShell supports $env:VAR, Join-Path, Split-Path, Test-Path, and string interpolation', () => {
  const ctx = createPsContext({ cwd: process.cwd() });
  const out = runPsScript(
    `
    $env:B8G_TEST_KEY = "sovereign"
    $joined = Join-Path 'intersections' 'b8g-ps-compat'
    Test-Path $joined
    Write-Output "mode=$env:B8G_TEST_KEY dir=$joined"
    `,
    ctx,
  );
  assert.equal(out.results[0], true);
  assert.equal(out.results[1], 'mode=sovereign dir=intersections\\b8g-ps-compat');
});
