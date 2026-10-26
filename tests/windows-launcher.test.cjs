const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const helper = path.resolve(__dirname, '../scripts/start-windows.ps1');
const batchLauncher = path.resolve(__dirname, '../启动.bat');
const readyMessage = '服务已就绪：http://127.0.0.1:3000';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Replace npm/Next with tiny real processes, but use the real Windows process
// inventory, TCP listeners, HTTP requests and PowerShell launcher throughout.
const fixtureSource = String.raw`
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = __dirname;
const args = process.argv.slice(2);
const mode = process.env.FIXTURE_MODE || 'ok';
const marker = name => path.join(root, name);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.appendFileSync(marker('calls.jsonl'), JSON.stringify({args, cwd: process.cwd()}) + '\n');
setInterval(() => {
  if (fs.existsSync(marker('stop'))) process.exit(0);
}, 100).unref();
(async () => {
  if (args[0] === 'install') {
    fs.mkdirSync(marker('node_modules'), {recursive: true});
    if (fs.existsSync(marker('fail-install'))) process.exit(23);
    if (fs.existsSync(marker('gate-install'))) {
      fs.writeFileSync(marker('install-started'), '');
      while (!fs.existsSync(marker('continue-install'))) await delay(50);
    }
    fs.mkdirSync(marker('node_modules/.bin'), {recursive: true});
    fs.mkdirSync(marker('node_modules/next/dist/bin'), {recursive: true});
    fs.writeFileSync(marker('node_modules/.bin/next.cmd'), '@echo off\r\n');
    fs.writeFileSync(marker('node_modules/next/dist/bin/next'), '// fixture\n');
    return;
  }
  if (args[0] !== 'foreign') {
    if (JSON.stringify(args) !== JSON.stringify(['run', 'dev', '--', '--port', '3000', '--hostname', '127.0.0.1'])) process.exit(88);
    if (mode === 'exit') process.exit(17);
    if (mode === 'idle') {
      fs.writeFileSync(marker('dev-started'), '');
      setInterval(() => {}, 1000);
      return;
    }
  }
  const server = http.createServer((request, response) => {
    if (mode === 'hang' && args[0] !== 'foreign') return;
    response.writeHead(mode === 'error' && args[0] !== 'foreign' ? 500 : 200);
    response.end('fixture');
  });
  server.on('error', error => { console.error(error.code); process.exit(19); });
  server.listen(args[0] === 'foreign' ? Number(args[1] || 3000) : 3000, '127.0.0.1', () => console.log('fixture-listening'));
})();
`;

async function waitFor(predicate, description, timeout = 15000) {
  const started = Date.now();
  while (!(await predicate())) {
    assert.ok(Date.now() - started < timeout, `Timed out waiting for ${description}`);
    await delay(100);
  }
}

function run(command, args, options = {}) {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const result = { child, output: '', exited: false };
  child.stdout.on('data', (data) => { result.output += data.toString('utf8'); });
  child.stderr.on('data', (data) => { result.output += data.toString('utf8'); });
  result.done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      result.exited = true;
      result.code = code;
      result.signal = signal;
      resolve(result);
    });
  });
  return result;
}

async function portIsFree(port = 3000) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function getStatus(port = 3000) {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}`, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.setTimeout(2000, () => request.destroy(new Error('HTTP timeout')));
    request.once('error', reject);
  });
}

async function fixture(t, { installed = true, mode = 'ok' } = {}) {
  assert.ok(await portIsFree(), 'Port 3000 must be free before running launcher tests; no existing process will be stopped.');
  const temporaryDirectory = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temporaryDirectory, 'waimei launcher 测试 '));
  const children = [];
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(helper, path.join(root, 'scripts/start-windows.ps1'));
  await fs.copyFile(batchLauncher, path.join(root, '启动.bat'));
  await fs.writeFile(path.join(root, 'fixture.cjs'), fixtureSource);
  await fs.writeFile(path.join(root, 'npm.cmd'), '@echo off\r\nnode "%~dp0fixture.cjs" %*\r\nexit /b %errorlevel%\r\n');
  const env = { ...process.env, FIXTURE_MODE: mode };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path';
  env[pathKey] = `${root};${path.dirname(process.execPath)};${env[pathKey] || ''}`;
  const start = (command, args, options = {}) => {
    const result = run(command, args, { env, cwd: os.tmpdir(), ...options });
    children.push(result);
    return result;
  };
  t.after(async () => {
    // Every fixture watches this marker, including children of an exited launcher.
    await fs.writeFile(path.join(root, 'stop'), '');
    await delay(500);
    for (const result of children) {
      if (!result.exited) {
        // Restrict emergency cleanup to a process handle created by this test.
        const cleanup = run('taskkill.exe', ['/PID', String(result.child.pid), '/T', '/F']);
        await cleanup.done;
        await result.done;
      }
    }
    await waitFor(portIsFree, 'fixture port cleanup', 5000);
    assert.equal(path.dirname(root), temporaryDirectory);
    assert.ok(path.basename(root).startsWith('waimei launcher 测试 '));
    await fs.rm(root, { recursive: true, force: true });
  });
  if (installed) {
    const install = start(process.execPath, [path.join(root, 'fixture.cjs'), 'install'], { cwd: root });
    assert.equal((await install.done).code, 0);
    await fs.writeFile(path.join(root, 'calls.jsonl'), '');
  }
  return {
    root,
    start,
    async mark(name) { await fs.writeFile(path.join(root, name), ''); },
    async exists(name) { return fs.access(path.join(root, name)).then(() => true, () => false); },
    async calls() {
      const text = await fs.readFile(path.join(root, 'calls.jsonl'), 'utf8').catch(() => '');
      return text.trim() ? text.trim().split('\n').map(JSON.parse) : [];
    },
    launch(timeout = 8) {
      const script = path.join(root, 'scripts/start-windows.ps1').replaceAll("'", "''");
      return start('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & '${script}' -NoBrowser -StartupTimeoutSeconds ${timeout}`]);
    },
    async succeed(result) {
      await waitFor(() => result.output.includes(readyMessage) || result.exited, 'launcher readiness');
      assert.ok(result.output.includes(readyMessage), result.output);
      assert.equal(result.exited, false, 'launcher stays attached to the running server');
      await fs.writeFile(path.join(root, 'stop'), '');
      await waitFor(() => result.exited, 'normal server shutdown');
      assert.equal(result.code, 0, result.output);
    },
    async fail(result) {
      await waitFor(() => result.exited, 'launcher failure', 20000);
      assert.equal(result.code, 1, result.output);
      assert.ok(!result.output.includes(readyMessage), result.output);
    },
  };
}

test('Windows launcher integration', { skip: process.platform !== 'win32', timeout: 180000 }, async (t) => {
  await t.test('port conflict preserves the unrelated listener and does not install or start', async (t) => {
    const f = await fixture(t, { installed: false });
    const foreign = f.start(process.execPath, [path.join(f.root, 'fixture.cjs'), 'foreign']);
    await waitFor(() => foreign.output.includes('fixture-listening'), 'foreign server');
    const launch = f.launch();
    await f.fail(launch);
    assert.match(launch.output, /3000.*已被占用/);
    assert.equal(foreign.exited, false);
    assert.equal(await getStatus(), 200);
    assert.deepEqual((await f.calls()).map((call) => call.args[0]), ['foreign']);
  });

  await t.test('successful startup resolves a spaced Unicode project path from another working directory', async (t) => {
    const f = await fixture(t);
    await f.succeed(f.launch(12));
    const calls = await f.calls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, f.root);
    assert.deepEqual(calls[0].args, ['run', 'dev', '--', '--port', '3000', '--hostname', '127.0.0.1']);
  });

  await t.test('port 30000 is not mistaken for port 3000', async (t) => {
    assert.ok(await portIsFree(30000), 'Port 30000 must be free for this exact-port regression test.');
    const f = await fixture(t);
    const foreign = f.start(process.execPath, [path.join(f.root, 'fixture.cjs'), 'foreign', '30000']);
    await waitFor(() => foreign.output.includes('fixture-listening'), 'port 30000 listener');
    const launch = f.launch(12);
    await waitFor(() => launch.output.includes(readyMessage) || launch.exited, 'port 3000 readiness');
    assert.equal(foreign.exited, false);
    assert.equal(await getStatus(30000), 200);
    await f.succeed(launch);
  });

  await t.test('early server exit fails promptly with its exit code', async (t) => {
    const f = await fixture(t, { mode: 'exit' });
    const launch = f.launch(20);
    const started = Date.now();
    await f.fail(launch);
    assert.match(launch.output, /退出码 17/);
    assert.ok(Date.now() - started < 15000, launch.output);
  });

  await t.test('the actual BAT wrapper preserves failure after pause from another working directory', async (t) => {
    const f = await fixture(t, { mode: 'exit' });
    const launch = f.start(process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `""${path.join(f.root, '启动.bat')}""`],
      { windowsVerbatimArguments: true, stdio: ['pipe', 'pipe', 'pipe'] });
    launch.child.stdin.end('\r\n');
    await f.fail(launch);
    assert.match(launch.output, /退出码 17/);
    const calls = await f.calls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, f.root);
  });

  await t.test('HTTP 500 never counts as readiness', async (t) => {
    const f = await fixture(t, { mode: 'error' });
    const launch = f.launch(4);
    await f.fail(launch);
    assert.match(launch.output, /超时/);
    assert.equal(await getStatus(), 500, 'failure handling leaves the owned server for manual inspection');
  });

  await t.test('an HTTP server that never responds cannot hang readiness indefinitely', async (t) => {
    const f = await fixture(t, { mode: 'hang' });
    const started = Date.now();
    const launch = f.launch(4);
    await f.fail(launch);
    assert.match(launch.output, /超时/);
    assert.ok(Date.now() - started < 15000, launch.output);
  });

  await t.test('failed first installation exits; a partial node_modules directory is retried', async (t) => {
    const f = await fixture(t, { installed: false });
    await f.mark('fail-install');
    const failed = f.launch();
    await f.fail(failed);
    assert.match(failed.output, /依赖安装失败/);
    assert.equal(await f.exists('node_modules'), true);
    assert.deepEqual((await f.calls()).map((call) => call.args[0]), ['install']);
    await fs.unlink(path.join(f.root, 'fail-install'));
    await f.succeed(f.launch(12));
    assert.deepEqual((await f.calls()).map((call) => call.args[0]), ['install', 'install', 'run']);
  });

  await t.test('a foreign listener appearing during installation is preserved and rejected', async (t) => {
    const f = await fixture(t, { installed: false });
    await f.mark('gate-install');
    const launch = f.launch();
    await waitFor(() => f.exists('install-started'), 'installation gate');
    const foreign = f.start(process.execPath, [path.join(f.root, 'fixture.cjs'), 'foreign']);
    await waitFor(() => foreign.output.includes('fixture-listening'), 'racing foreign server');
    await f.mark('continue-install');
    await f.fail(launch);
    assert.match(launch.output, /3000.*已被占用/);
    assert.equal(foreign.exited, false);
    assert.equal(await getStatus(), 200);
    assert.deepEqual((await f.calls()).map((call) => call.args[0]), ['install', 'foreign']);
  });

  await t.test('a foreign HTTP 200 listener appearing after preflight is never accepted as this server', async (t) => {
    const f = await fixture(t, { mode: 'idle' });
    const launch = f.launch(5);
    await waitFor(() => f.exists('dev-started'), 'unbound dev process');
    const foreign = f.start(process.execPath, [path.join(f.root, 'fixture.cjs'), 'foreign']);
    await waitFor(() => foreign.output.includes('fixture-listening'), 'foreign HTTP 200 listener');
    await f.fail(launch);
    assert.match(launch.output, /超时/);
    assert.equal(foreign.exited, false);
    assert.equal(await getStatus(), 200);
  });
});
