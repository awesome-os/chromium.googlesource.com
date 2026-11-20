#!/usr/bin/env node
/**
 * B8G Sovereign Git Server (`.\bin\b8g-git-server`).
 *
 * Zero-dependency Git Smart HTTP server (`git-upload-pack` + `git-receive-pack`)
 * + Built-in Forge Web UI & JSON API:
 *   - Zero GitHub 2 GB push limits, zero rate limits, zero Credential Manager popups
 *   - Supports `git clone`, `git fetch`, `git pull`, and `git push` over HTTP
 *   - Mounts bare/normal repos from `--root <dir>` plus named live repo mounts
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, '..', '..');
const GIT_BIN = process.platform === 'win32' ? 'git.exe' : 'git';

function pktLine(payload: string): string {
  const len = (payload.length + 4).toString(16).padStart(4, '0');
  return `${len}${payload}`;
}

export interface GitServerOptions {
  host?: string;
  port?: number;
  reposRoot: string;
  mounts?: Record<string, string>;
  allowPush?: boolean;
}

export interface RepoSummary {
  name: string;
  path: string;
  cloneUrl: string;
  headCommit: string;
  branch: string;
}

export class B8gGitServer {
  private server: Server;
  private reposRoot: string;
  private mounts: Map<string, string>;
  private allowPush: boolean;
  private host: string;
  private port: number;

  constructor(opts: GitServerOptions) {
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 7420;
    this.reposRoot = resolve(opts.reposRoot);
    this.allowPush = opts.allowPush ?? true;
    this.mounts = new Map();
    if (opts.mounts) {
      for (const [k, v] of Object.entries(opts.mounts)) {
        const key = k.replace(/\.git$/i, '');
        if (existsSync(v)) this.mounts.set(key, resolve(v));
      }
    }
    mkdirSync(this.reposRoot, { recursive: true });
    this.server = createServer((req, res) => void this.handleRequest(req, res));
  }

  get address(): { host: string; port: number; url: string } {
    const addr = this.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.port;
    return { host: this.host, port, url: `http://${this.host}:${port}` };
  }

  async start(): Promise<{ host: string; port: number; url: string }> {
    await new Promise<void>((resolveStart, rejectStart) => {
      this.server.once('error', rejectStart);
      this.server.listen(this.port, this.host, () => resolveStart());
    });
    return this.address;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolveStop) => this.server.close(() => resolveStop()));
  }

  initBareRepo(name: string): string {
    const clean = name.replace(/[^a-zA-Z0-9._-]/g, '').replace(/\.git$/i, '');
    const target = join(this.reposRoot, `${clean}.git`);
    if (!existsSync(target)) {
      mkdirSync(target, { recursive: true });
      execFileSync(GIT_BIN, ['init', '--bare', target], { stdio: 'ignore' });
      execFileSync(GIT_BIN, ['-C', target, 'config', 'http.receivepack', 'true'], { stdio: 'ignore' });
    }
    return target;
  }

  private resolveRepoPath(rawName: string): string | null {
    const clean = rawName.replace(/\.git$/i, '');
    if (!/^[a-zA-Z0-9._-]+$/.test(clean)) return null;

    if (this.mounts.has(clean)) {
      return this.mounts.get(clean)!;
    }
    const bare = join(this.reposRoot, `${clean}.git`);
    if (existsSync(bare)) return bare;
    const norm = join(this.reposRoot, clean);
    if (existsSync(join(norm, '.git'))) return norm;
    return null;
  }

  listRepos(): RepoSummary[] {
    const seen = new Map<string, string>();
    for (const [k, v] of this.mounts.entries()) seen.set(k, v);
    if (existsSync(this.reposRoot)) {
      for (const entry of readdirSync(this.reposRoot)) {
        const full = join(this.reposRoot, entry);
        try {
          if (!statSync(full).isDirectory()) continue;
        } catch {
          continue;
        }
        if (entry.endsWith('.git') || existsSync(join(full, '.git'))) {
          const name = entry.replace(/\.git$/i, '');
          if (!seen.has(name)) seen.set(name, full);
        }
      }
    }

    const baseUrl = this.address.url;
    const out: RepoSummary[] = [];
    for (const [name, repoPath] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      let headCommit = '(empty)';
      let branch = 'main';
      try {
        headCommit = execFileSync(GIT_BIN, ['-C', repoPath, 'log', '-1', '--oneline'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // empty bare repo
      }
      try {
        branch = execFileSync(GIT_BIN, ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // detached or empty
      }
      out.push({
        name,
        path: repoPath,
        cloneUrl: `${baseUrl}/${name}.git`,
        headCommit: headCommit || '(empty)',
        branch,
      });
    }
    return out;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const urlObj = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const pathname = decodeURIComponent(urlObj.pathname);

    // 1. Forge Web UI
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const repos = this.listRepos();
      const rows = repos
        .map(
          (r) =>
            `<tr><td><b>${r.name}</b></td><td><code>${r.branch}</code></td><td><code>${r.headCommit}</code></td><td><code>git clone ${r.cloneUrl}</code></td></tr>`,
        )
        .join('\n');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>B8G Sovereign Git Forge</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:28px;margin:0}
h1{color:#58a6ff;margin:0 0 6px}
p{color:#8b949e;margin:0 0 20px}
table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #30363d;font-size:13px}
th{color:#7ee787;font-size:11px;text-transform:uppercase;letter-spacing:.7px}
code{background:#0b0f14;padding:2px 6px;border-radius:4px;color:#a5f3fc;font-family:Consolas,monospace}
</style></head><body>
<h1>⚡ B8G Sovereign Git Server</h1>
<p>Smart HTTP Git Forge • Zero 2 GB push limits • Zero rate limits • <code>${this.address.url}</code></p>
<table><thead><tr><th>Repository</th><th>Branch</th><th>HEAD</th><th>Clone Command</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4">No repositories mounted yet.</td></tr>'}</tbody></table>
</body></html>`);
      return;
    }

    // 2. JSON API
    if (req.method === 'GET' && pathname === '/api/repos') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ url: this.address.url, repos: this.listRepos() }, null, 2));
      return;
    }

    // 3. Git Smart HTTP: GET /<repo>.git/info/refs?service=git-upload-pack|git-receive-pack
    const refsMatch = pathname.match(/^\/([^/]+)\/info\/refs$/);
    if (req.method === 'GET' && refsMatch) {
      const service = urlObj.searchParams.get('service');
      if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Only Smart HTTP git-upload-pack / git-receive-pack supported');
        return;
      }
      if (service === 'git-receive-pack' && !this.allowPush) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Push disabled on this server');
        return;
      }
      const repoPath = this.resolveRepoPath(refsMatch[1]);
      if (!repoPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Repository not found: ${refsMatch[1]}`);
        return;
      }

      const subcmd = service.slice(4); // 'upload-pack' or 'receive-pack'
      res.writeHead(200, {
        'Content-Type': `application/x-${service}-advertisement`,
        'Cache-Control': 'no-cache',
      });
      res.write(pktLine(`# service=${service}\n`));
      res.write('0000');

      const proc = spawn(GIT_BIN, [subcmd, '--stateless-rpc', '--advertise-refs', repoPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.stdout.pipe(res);
      proc.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      return;
    }

    // 4. Git Smart HTTP: POST /<repo>.git/git-upload-pack | git-receive-pack
    const rpcMatch = pathname.match(/^\/([^/]+)\/(git-upload-pack|git-receive-pack)$/);
    if (req.method === 'POST' && rpcMatch) {
      const service = rpcMatch[2];
      if (service === 'git-receive-pack' && !this.allowPush) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Push disabled');
        return;
      }
      const repoPath = this.resolveRepoPath(rpcMatch[1]);
      if (!repoPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Repository not found: ${rpcMatch[1]}`);
        return;
      }

      const subcmd = service.slice(4);
      res.writeHead(200, {
        'Content-Type': `application/x-${service}-result`,
        'Cache-Control': 'no-cache',
      });

      const proc = spawn(GIT_BIN, [subcmd, '--stateless-rpc', repoPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (req.headers['content-encoding'] === 'gzip') {
        req.pipe(createGunzip()).pipe(proc.stdin);
      } else {
        req.pipe(proc.stdin);
      }
      proc.stdout.pipe(res);
      proc.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let port = 7420;
  let host = '127.0.0.1';
  let reposRoot = 'E:\\b8g-git-repos';
  const mounts: Record<string, string> = {
    'awesome-os': WORKSPACE_ROOT,
    'b8g-chromium': 'E:\\b8g-chromium-real\\src',
    'vscode-oss': join(WORKSPACE_ROOT, 'third_party', 'vscode-oss'),
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--port' && args[i + 1]) port = Number(args[++i]);
    else if (a === '--host' && args[i + 1]) host = args[++i];
    else if (a === '--root' && args[i + 1]) reposRoot = args[++i];
    else if (a === '--mount' && args[i + 1]) {
      const [k, v] = args[++i].split('=');
      if (k && v) mounts[k] = v;
    }
  }

  const srv = new B8gGitServer({ host, port, reposRoot, mounts });
  const addr = await srv.start();
  console.log(`[b8g-git-server] Sovereign Git Forge listening on ${addr.url}`);
  for (const r of srv.listRepos()) {
    console.log(`  - ${r.name} (${r.branch}): git clone ${r.cloneUrl}`);
  }
}
