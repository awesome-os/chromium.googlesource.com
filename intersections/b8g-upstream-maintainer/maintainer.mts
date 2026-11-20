#!/usr/bin/env node
/**
 * B8G Sovereign Upstream Maintenance & Auto-Update Intersection (`.\bin\b8g-maintain`).
 *
 * Unified control plane + working inference point for tracking, verifying,
 * and auto-updating all 8 adopted upstream stacks (Chromium, Node, NW.js,
 * Code-OSS, Workerd, Wasmer, OBS, PowerShell/.NET BCL).
 *
 * Commands:
 *   b8g-maintain status [--remote] [--json]   # Scan all 8 upstreams + bin parity
 *   b8g-maintain infer-plan [--remote]        # Emit machine-readable inference action plan
 *   b8g-maintain check-all                    # Run full sovereign verification suite
 *   b8g-maintain sync <id>                    # Safe shallow upstream sync for one target
 *   b8g-maintain serve [--port 7430]          # Live HTTP Inference Point (/api/status, /api/plan, /api/verify)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBinParity } from '../b8g-bin-parity/bin-parity.mts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, '..', '..');
const REGISTRY_PATH = join(__dirname, 'registry.json');
const GIT_BIN = process.platform === 'win32' ? 'git.exe' : 'git';

export interface UpstreamEntry {
  id: string;
  kind: 'git-repo' | 'git-sparse' | 'spec-tracker';
  localPath: string;
  remoteUrl: string;
  trackRef: string;
  sparsePaths?: string[];
  projection: string;
  verifyCmd: string;
  compatLedger?: Record<string, unknown>;
}

export interface UpstreamStatus {
  id: string;
  kind: string;
  present: boolean;
  localHead: string;
  remoteHead: string;
  drift: 'up-to-date' | 'drift-detected' | 'missing' | 'local-only';
  projection: string;
  verifyCmd: string;
}

export interface MaintenanceInferencePlan {
  timestamp: string;
  workspaceRoot: string;
  binParity: { totalTools: number; compliantTools: number; violations: number };
  upstreams: UpstreamStatus[];
  recommendedActions: Array<{ target: string; priority: 'high' | 'normal'; action: string; command: string }>;
  inferencePrompt: string;
}

export function loadRegistry(): UpstreamEntry[] {
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  return raw.upstreams as UpstreamEntry[];
}

function safeGit(args: string[]): string {
  try {
    return execFileSync(GIT_BIN, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).trim();
  } catch {
    return '';
  }
}

export function inspectUpstreams(checkRemote = false): UpstreamStatus[] {
  const entries = loadRegistry();
  const out: UpstreamStatus[] = [];

  for (const e of entries) {
    const present = existsSync(e.localPath);
    let localHead = 'n/a';
    let remoteHead = 'skipped';
    let drift: UpstreamStatus['drift'] = present ? 'local-only' : 'missing';

    if (present && e.kind !== 'spec-tracker') {
      localHead = safeGit(['-C', e.localPath, 'rev-parse', '--short', 'HEAD']) || 'unknown';
    } else if (present && e.kind === 'spec-tracker') {
      localHead = 'spec-v1';
    }

    if (checkRemote) {
      const ls = safeGit(['-c', 'protocol.version=2', 'ls-remote', e.remoteUrl, e.trackRef]);
      const fullRemote = ls.split(/\s+/)[0] || '';
      remoteHead = fullRemote ? fullRemote.slice(0, 10) : 'unreachable';
      if (present && e.kind !== 'spec-tracker' && fullRemote) {
        const localFull = safeGit(['-C', e.localPath, 'rev-parse', 'HEAD']);
        drift = localFull.startsWith(remoteHead) || fullRemote.startsWith(localHead) ? 'up-to-date' : 'drift-detected';
      }
    }

    out.push({
      id: e.id,
      kind: e.kind,
      present,
      localHead,
      remoteHead,
      drift,
      projection: e.projection,
      verifyCmd: e.verifyCmd,
    });
  }

  return out;
}

export function buildInferencePlan(checkRemote = false): MaintenanceInferencePlan {
  const parity = auditBinParity(join(WORKSPACE_ROOT, 'bin'));
  const upstreams = inspectUpstreams(checkRemote);
  const actions: MaintenanceInferencePlan['recommendedActions'] = [];

  if (parity.violations.length > 0) {
    actions.push({
      target: 'bin-parity',
      priority: 'high',
      action: `Heal ${parity.violations.length} orphaned bin wrappers to restore 100% atomic triplet parity.`,
      command: '.\\bin\\b8g-bin-parity heal',
    });
  }

  for (const u of upstreams) {
    if (!u.present) {
      actions.push({
        target: u.id,
        priority: 'high',
        action: `Re-hydrate missing upstream tree for ${u.id}.`,
        command: `.\\bin\\b8g-maintain sync ${u.id}`,
      });
    } else if (u.drift === 'drift-detected') {
      actions.push({
        target: u.id,
        priority: 'normal',
        action: `Upstream ${u.id} moved (${u.localHead} -> ${u.remoteHead}). Sync & re-verify projection.`,
        command: `.\\bin\\b8g-maintain sync ${u.id}`,
      });
    }
  }

  const summaryLines = upstreams.map(
    (u) => `- ${u.id} [${u.kind}]: local=${u.localHead} remote=${u.remoteHead} status=${u.drift} -> ${u.projection}`,
  );
  const inferencePrompt = [
    `You are the Awesome-OS Sovereign Maintainer Agent.`,
    `Bin Parity: ${parity.compliantTools}/${parity.totalTools} (${parity.violations.length} violations).`,
    `Tracked Upstreams (${upstreams.length}):`,
    ...summaryLines,
    actions.length > 0
      ? `Pending Actions (${actions.length}):\n${actions.map((a) => `  * [${a.priority}] ${a.target}: ${a.action} (${a.command})`).join('\n')}`
      : `All upstreams present and bin parity is 100%. Ready for incremental feature or compat expansion.`,
  ].join('\n');

  return {
    timestamp: new Date().toISOString(),
    workspaceRoot: WORKSPACE_ROOT,
    binParity: {
      totalTools: parity.totalTools,
      compliantTools: parity.compliantTools,
      violations: parity.violations.length,
    },
    upstreams,
    recommendedActions: actions,
    inferencePrompt,
  };
}

export function runAllVerifications(): { passed: boolean; output: string } {
  const testFiles = [
    'intersections/b8g-bin-parity/bin-parity.test.mts',
    'intersections/b8g-terminal-chrome/b8g-terminal-chrome.test.mts',
    'intersections/b8g-electron/b8g-electron.test.mts',
    'intersections/b8g-nwjs/b8g-nwjs.test.mts',
    'intersections/b8g-vscode-oss/b8g-vscode-oss.test.mts',
    'intersections/b8g-git-server/git-server.test.mts',
    'intersections/b8g-workerd-wasi/b8g-worker-wasi-host.test.mts',
    'intersections/b8g-ps-compat/ps-compat.test.mts',
  ].filter((f) => existsSync(join(WORKSPACE_ROOT, f)));

  try {
    const out = execFileSync(process.execPath, ['--test', ...testFiles], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    });
    return { passed: true, output: out };
  } catch (err: any) {
    return { passed: false, output: String(err?.stdout || '') + String(err?.stderr || err?.message || '') };
  }
}

export class B8gMaintenanceInferenceServer {
  private server: Server;
  private host: string;
  private port: number;

  constructor(opts: { host?: string; port?: number } = {}) {
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 7430;
    this.server = createServer((req, res) => this.handle(req, res));
  }

  get url(): string {
    const addr = this.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.port;
    return `http://${this.host}:${port}`;
  }

  async start(): Promise<string> {
    await new Promise<void>((res, rej) => {
      this.server.once('error', rej);
      this.server.listen(this.port, this.host, () => res());
    });
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((res) => this.server.close(() => res()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const u = new URL(req.url || '/', this.url);
    const checkRemote = u.searchParams.get('remote') === '1';

    if (req.method === 'GET' && u.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ upstreams: inspectUpstreams(checkRemote) }, null, 2));
      return;
    }

    if (req.method === 'GET' && u.pathname === '/api/plan') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildInferencePlan(checkRemote), null, 2));
      return;
    }

    if (req.method === 'POST' && u.pathname === '/api/verify') {
      const result = runAllVerifications();
      res.writeHead(result.passed ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        service: 'b8g-upstream-maintainer-inference-point',
        endpoints: ['GET /api/status', 'GET /api/plan', 'POST /api/verify'],
      }),
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'status';
  const checkRemote = args.includes('--remote');
  const asJson = args.includes('--json');

  if (cmd === 'status') {
    const plan = buildInferencePlan(checkRemote);
    if (asJson) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(plan.inferencePrompt);
    }
  } else if (cmd === 'infer-plan') {
    console.log(JSON.stringify(buildInferencePlan(checkRemote), null, 2));
  } else if (cmd === 'check-all') {
    const r = runAllVerifications();
    console.log(r.output);
    process.exit(r.passed ? 0 : 1);
  } else if (cmd === 'serve') {
    const pIdx = args.indexOf('--port');
    const port = pIdx >= 0 && args[pIdx + 1] ? Number(args[pIdx + 1]) : 7430;
    const srv = new B8gMaintenanceInferenceServer({ port });
    const url = await srv.start();
    console.log(`[b8g-maintain] Inference Point listening on ${url} (/api/status, /api/plan, /api/verify)`);
  } else if (cmd === 'sync' && args[1]) {
    const entry = loadRegistry().find((x) => x.id === args[1]);
    if (!entry) {
      console.error(`Unknown upstream id: ${args[1]}`);
      process.exit(2);
    }
    if (entry.kind === 'spec-tracker') {
      console.log(`[b8g-maintain] ${entry.id} is a spec-tracker (${entry.remoteUrl}). Use --remote status to check ref drift.`);
      process.exit(0);
    }
    execFileSync(GIT_BIN, ['-C', entry.localPath, 'fetch', '--depth=1', 'origin'], { stdio: 'inherit' });
    console.log(`[b8g-maintain] Fetched latest shallow delta for ${entry.id} at ${entry.localPath}`);
  } else {
    console.error('Usage: b8g-maintain [status|infer-plan|check-all|sync <id>|serve] [--remote] [--json]');
    process.exit(2);
  }
}
