import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInferencePlan,
  B8gMaintenanceInferenceServer,
  loadRegistry,
} from './maintainer.mts';

test('Maintainer registry tracks all 8 sovereign upstreams and generates a valid inference plan', () => {
  const reg = loadRegistry();
  assert.equal(reg.length, 8);

  const plan = buildInferencePlan(false);
  assert.equal(plan.binParity.violations, 0, 'bin parity must be 0 violations');
  assert.equal(plan.upstreams.length, 8);
  assert.ok(plan.upstreams.every((u) => u.present), 'all 8 tracked upstreams must be present on disk');
  assert.ok(plan.inferencePrompt.includes('Awesome-OS Sovereign Maintainer Agent'));
});

test('B8gMaintenanceInferenceServer serves live /api/status and /api/plan JSON inference endpoints', async () => {
  const srv = new B8gMaintenanceInferenceServer({ port: 0 });
  try {
    const url = await srv.start();
    const st = (await (await fetch(`${url}/api/status`)).json()) as { upstreams: unknown[] };
    assert.equal(st.upstreams.length, 8);

    const plan = (await (await fetch(`${url}/api/plan`)).json()) as {
      binParity: { violations: number };
      inferencePrompt: string;
    };
    assert.equal(plan.binParity.violations, 0);
    assert.ok(plan.inferencePrompt.length > 50);
  } finally {
    await srv.stop();
  }
});
