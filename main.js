const { app, BrowserWindow, ipcMain } = require('electron');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const WG_EXE = 'C:\\Program Files\\WireGuard\\wireguard.exe';
const WG_INSTALLER_URL = 'https://download.wireguard.com/windows-client/wireguard-installer.exe';
const TUNNEL_NAME = 'wg-mo2';
const EMBEDDED_CONF = path.join(__dirname, 'wg-mo2.conf');

const BUNDLED_CONFIG = path.join(__dirname, 'paths.json');

function loadConfig() {
  // Priority: paths.json next to the exe (user override, no rebuild needed)
  // → bundled paths.private.json (private builds with a relay)
  // → bundled paths.json (public default).
  const external = path.join(path.dirname(process.execPath), 'paths.json');
  const bundledPrivate = path.join(__dirname, 'paths.private.json');
  for (const p of [external, bundledPrivate, BUNDLED_CONFIG]) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* try next */ }
  }
  throw new Error('paths.json not found');
}

function historyFile() {
  return path.join(app.getPath('userData'), 'history.json');
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(historyFile(), 'utf8'));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  fs.writeFileSync(historyFile(), JSON.stringify(history.slice(-50)));
}

function tunnelActive() {
  return Object.keys(os.networkInterfaces()).some(n => /^wg/i.test(n));
}

const wgInstalled = () => fs.existsSync(WG_EXE);
const hasEmbeddedConf = () => fs.existsSync(EMBEDDED_CONF);

function tunnelStatus() {
  return { wgInstalled: wgInstalled(), hasConf: hasEmbeddedConf(), active: tunnelActive() };
}

// Runs wireguard.exe elevated (UAC prompt) and waits for it to finish.
function wgElevated(args) {
  const argList = args.map(a => `'"${a}"'`).join(',');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-Command',
      `Start-Process -FilePath '${WG_EXE}' -ArgumentList ${argList} -Verb RunAs -Wait`,
    ], err => (err ? reject(err) : resolve()));
  });
}

async function tunnelToggle(on) {
  if (on) {
    // wireguard.exe can't read from inside the asar — extract to a real file.
    // The file name defines the tunnel/interface name.
    const confPath = path.join(app.getPath('userData'), `${TUNNEL_NAME}.conf`);
    fs.writeFileSync(confPath, fs.readFileSync(EMBEDDED_CONF));
    await wgElevated(['/installtunnelservice', confPath]);
  } else {
    await wgElevated(['/uninstalltunnelservice', TUNNEL_NAME]);
  }
  await sleep(2500);
  return tunnelStatus();
}

function download(url, dest, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function installWireGuard() {
  const dest = path.join(os.tmpdir(), 'wireguard-installer.exe');
  await download(WG_INSTALLER_URL, dest);
  // Launching an installer that needs elevation via CreateProcess fails silently
  // from a non-elevated app (ERROR_ELEVATION_REQUIRED) — go through the shell
  // so Windows shows the UAC prompt.
  await new Promise((resolve, reject) =>
    execFile('powershell.exe', [
      '-NoProfile', '-Command',
      `Start-Process -FilePath '"${dest}"' -Verb RunAs -Wait`,
    ], err => (err ? reject(err) : resolve())));
  return tunnelStatus();
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    const sock = new net.Socket();
    let settled = false;
    const finish = ms => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ms);
    };
    sock.setTimeout(timeoutMs, () => finish(null));
    sock.once('error', () => finish(null));
    sock.connect(port, host, () => {
      finish(Number(process.hrtime.bigint() - started) / 1e6);
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function stats(samples, extraMs) {
  const ok = samples.filter(s => s !== null).map(s => s + extraMs);
  const lost = samples.length - ok.length;
  if (!ok.length) {
    return { median: null, avg: null, min: null, max: null, p95: null,
             jitter: null, lossPct: 100, samples: [] };
  }
  const sorted = [...ok].sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
  const jitter = Math.sqrt(ok.reduce((a, b) => a + (b - avg) ** 2, 0) / ok.length);
  return {
    median: q(0.5),
    avg,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: q(0.95),
    jitter,
    lossPct: (lost / samples.length) * 100,
    samples: samples.map(s => (s === null ? null : s + extraMs)),
  };
}

async function measurePath(p, cfg, onProgress) {
  // Warm-up probe: the first connect on Windows routinely costs hundreds of ms
  // (route/ARP warm-up) and would wreck jitter/range stats — measure, discard.
  await tcpProbe(p.host, p.port, cfg.timeoutMs);
  await sleep(p.intervalMs);
  const raw = [];
  for (let i = 0; i < cfg.samples; i++) {
    raw.push(await tcpProbe(p.host, p.port, cfg.timeoutMs));
    onProgress(p.id, (i + 1) / cfg.samples);
    if (i < cfg.samples - 1) await sleep(p.intervalMs);
  }
  return { ...p, ...stats(raw, p.extraMs) };
}

function verdict(results) {
  const direct = results.find(r => r.role === 'direct');
  const relay = results.find(r => r.role === 'relay');
  if (!direct || !relay || direct.median === null || relay.median === null) {
    const alive = results.filter(r => r.median !== null);
    if (!alive.length) return { best: null, delta: null };
    const best = alive.reduce((a, b) => (a.median <= b.median ? a : b));
    return { best: best.id, delta: null };
  }
  // Steadiness matters as much as the median for melee timing: compare p95.
  const directScore = direct.median + (direct.p95 - direct.median) * 0.5;
  const relayScore = relay.median + (relay.p95 - relay.median) * 0.5;
  return {
    best: relayScore < directScore ? 'relay' : 'direct',
    delta: Math.abs(direct.median - relay.median),
    directScore,
    relayScore,
  };
}

async function runTest(win) {
  const cfg = loadConfig();
  const onProgress = (id, frac) => win.webContents.send('progress', { id, frac });
  const results = await Promise.all(cfg.paths.map(p => measurePath(p, cfg, onProgress)));
  const run = {
    at: new Date().toISOString(),
    tunnel: tunnelActive(),
    results,
    verdict: verdict(results),
  };
  const history = loadHistory();
  history.push(run);
  saveHistory(history);
  return { run, history };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1060,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: '#111110',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

let monitorTimer = null;

function startMonitor(win) {
  if (monitorTimer) return;
  const cfg = loadConfig();
  const target = cfg.paths.find(x => x.role === 'current');
  monitorTimer = setInterval(async () => {
    const ms = await tcpProbe(target.host, target.port, cfg.timeoutMs);
    if (!win.isDestroyed()) win.webContents.send('monitor-sample', { at: Date.now(), ms });
  }, 700);
}

function stopMonitor() {
  clearInterval(monitorTimer);
  monitorTimer = null;
}

app.whenReady().then(() => {
  const win = createWindow();
  if (process.env.PINGLAB_AUTOTEST) {
    win.webContents.once('did-finish-load', async () => {
      await win.webContents.executeJavaScript(
        "document.getElementById('run-btn').click(); document.getElementById('mon-btn').click()");
      const poll = setInterval(async () => {
        const busy = await win.webContents.executeJavaScript(
          "document.getElementById('run-btn').disabled");
        if (!busy) {
          clearInterval(poll);
          win.show();
          win.focus();
          let img;
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 700));
            img = await win.webContents.capturePage();
            if (!img.isEmpty()) break;
          }
          fs.writeFileSync(process.env.PINGLAB_AUTOTEST, img.toPNG());
          console.log('AUTOTEST_DONE', process.env.PINGLAB_AUTOTEST, img.isEmpty() ? 'EMPTY' : 'OK');
          app.quit();
        }
      }, 1000);
    });
  }
  ipcMain.handle('run-test', () => runTest(win));
  ipcMain.handle('get-state', () => ({
    config: loadConfig(),
    history: loadHistory(),
    tunnel: tunnelActive(),
    tunnelCtl: tunnelStatus(),
    lang: process.env.PINGLAB_LANG || app.getLocale(),
  }));
  ipcMain.handle('tunnel-status', () => tunnelStatus());
  ipcMain.handle('tunnel-toggle', (_e, on) => tunnelToggle(on));
  ipcMain.handle('install-wireguard', () => installWireGuard());
  ipcMain.handle('monitor-start', () => { startMonitor(win); return true; });
  ipcMain.handle('monitor-stop', () => { stopMonitor(); return true; });
  // One quick probe of the game path — used to confirm the tunnel really works
  // right after it is enabled.
  ipcMain.handle('quick-probe', async () => {
    const cfg = loadConfig();
    const t = cfg.paths.find(x => x.role === 'current');
    return tcpProbe(t.host, t.port, cfg.timeoutMs);
  });
  ipcMain.handle('capture', async (_e, file) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(file, img.toPNG());
    return file;
  });
});

app.on('window-all-closed', () => app.quit());
