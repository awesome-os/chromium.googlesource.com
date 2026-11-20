import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { B8gGitServer } from './git-server.mts';

const execFileAsync = promisify(execFile);
const GIT = process.platform === 'win32' ? 'git.exe' : 'git';
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const git = (args: string[]) => execFileAsync(GIT, args, { env: GIT_ENV });

test('B8gGitServer serves real Smart HTTP git clone, commit, git push, and re-clone + Web UI', async () => {
  const work = mkdtempSync(join(tmpdir(), 'b8g-git-srv-'));
  const reposRoot = join(work, 'repos');
  const srv = new B8gGitServer({ host: '127.0.0.1', port: 0, reposRoot, allowPush: true });

  try {
    srv.initBareRepo('demo');
    const addr = await srv.start();

    // 1. Verify Web UI & JSON API
    const html = await (await fetch(`${addr.url}/`)).text();
    assert.ok(html.includes('B8G Sovereign Git Server') && html.includes('demo'));
    const api = (await (await fetch(`${addr.url}/api/repos`)).json()) as {
      repos: Array<{ name: string; cloneUrl: string }>;
    };
    assert.equal(api.repos[0].name, 'demo');

    // 2. Real `git clone` over Smart HTTP
    const clone1 = join(work, 'clone1');
    await git(['-c', 'credential.helper=', 'clone', `${addr.url}/demo.git`, clone1]);
    await git(['-C', clone1, 'config', 'user.email', 'b8g@awesome-os.local']);
    await git(['-C', clone1, 'config', 'user.name', 'B8G Test']);

    // 3. Commit & real `git push` over Smart HTTP
    writeFileSync(join(clone1, 'hello.txt'), 'Nunquam ante, numquam iterum\n', 'utf8');
    await git(['-C', clone1, 'add', 'hello.txt']);
    await git(['-C', clone1, 'commit', '-m', 'init sovereign commit']);
    await git(['-C', clone1, '-c', 'credential.helper=', 'push', 'origin', 'HEAD:main']);

    // 4. Fresh second `git clone` verifies pushed objects & refs arrived bit-for-bit
    const clone2 = join(work, 'clone2');
    await git(['-c', 'credential.helper=', 'clone', '-b', 'main', `${addr.url}/demo.git`, clone2]);
    const content = readFileSync(join(clone2, 'hello.txt'), 'utf8').trim();
    assert.equal(content, 'Nunquam ante, numquam iterum');
  } finally {
    await srv.stop();
    rmSync(work, { recursive: true, force: true });
  }
});
