/* MO2 Ping Lab renderer */
const $ = id => document.getElementById(id);

let config = null;
let progress = {};

const fmt = v => (v === null || v === undefined ? '—' : v.toFixed(v < 10 ? 1 : 0));

function sparkline(samples, width = 260, height = 46) {
  const ok = samples.filter(s => s !== null);
  if (!ok.length) return '<svg class="spark"></svg>';
  const min = Math.min(...ok), max = Math.max(...ok);
  const span = Math.max(max - min, 1);
  const pad = 3;
  const step = (width - pad * 2) / Math.max(samples.length - 1, 1);
  const y = v => pad + (height - pad * 2) * (1 - (v - min) / span);
  let d = '', lastWasNull = true;
  samples.forEach((s, i) => {
    if (s === null) { lastWasNull = true; return; }
    const x = pad + i * step;
    d += `${lastWasNull ? 'M' : 'L'}${x.toFixed(1)},${y(s).toFixed(1)}`;
    lastWasNull = false;
  });
  const losses = samples.map((s, i) => s === null
    ? `<line x1="${(pad + i * step).toFixed(1)}" y1="${pad}" x2="${(pad + i * step).toFixed(1)}" y2="${height - pad}" stroke="var(--critical)" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`
    : '').join('');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="график сэмплов">
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${losses}
  </svg>`;
}

function pathCard(p, result, bestId) {
  const r = result || {};
  const measured = r.median !== null && r.median !== undefined;
  const lossCls = !measured ? '' : r.lossPct > 2 ? 'bad' : 'ok';
  return `<article class="card fade-in ${bestId === p.id ? 'best' : ''}" id="card-${p.id}">
    <div>
      <h3>${p.name}</h3>
      <div class="hint">${p.hint}</div>
    </div>
    <div class="big-ms">
      ${measured
        ? `<span class="val">${fmt(r.median)}</span><span class="unit">мс&nbsp;· медиана</span>`
        : `<span class="pending" id="pend-${p.id}">${result ? 'нет ответа' : 'ждёт замера'}</span>`}
    </div>
    ${measured ? sparkline(r.samples) : '<svg class="spark"></svg>'}
    <div class="mini-stats">
      <div class="mini"><div class="k">потери</div><div class="v ${lossCls}">${measured || result ? fmt(r.lossPct) + '%' : '—'}</div></div>
      <div class="mini"><div class="k">джиттер</div><div class="v">${measured ? '±' + fmt(r.jitter) + ' мс' : '—'}</div></div>
      <div class="mini"><div class="k">p95</div><div class="v">${measured ? fmt(r.p95) + ' мс' : '—'}</div></div>
    </div>
    <div class="range">${measured ? `диапазон ${fmt(r.min)}–${fmt(r.max)} мс · ${r.samples.length} сэмплов` : '&nbsp;'}</div>
  </article>`;
}

function renderCards(run) {
  const bestId = run?.verdict?.best ?? null;
  const byId = {};
  (run?.results || []).forEach(r => { byId[r.id] = r; });
  $('cards').innerHTML = config.paths.map(p => pathCard(p, byId[p.id], bestId)).join('');
}

function renderVerdict(run) {
  const v = run?.verdict;
  const el = $('verdict');
  if (!v || !v.best) { el.hidden = true; return; }
  el.hidden = false;
  const relayBest = v.best === 'relay';
  el.classList.toggle('good-side', true);
  $('verdict-icon').textContent = relayBest ? '🛡' : '⚡';
  $('verdict-title').textContent = relayBest
    ? 'Включи туннель — через релей быстрее и ровнее'
    : 'Играй напрямую — твой маршрут и так лучший';
  const hasRelay = config.paths.some(p => p.role === 'relay');
  $('verdict-sub').textContent = relayBest
    ? 'Маршрут через релей выигрывает по медиане и стабильности (p95).'
    : hasRelay
      ? 'Релей не даст выигрыша: прямой путь не хуже. Держи его как страховку.'
      : 'Твой маршрут до сервера измерен. Добавь свой релей в paths.json, чтобы сравнить пути.';
  $('verdict-delta').innerHTML = v.delta !== null
    ? `<b>Δ ${fmt(v.delta)} мс</b>разница медиан`
    : '';
}

function renderCompare(history) {
  const el = $('compare');
  const runs = history.filter(h => h.results?.some(r => r.median !== null));
  if (runs.length < 2) { el.hidden = true; return; }

  // Prefer the tunnel-off vs tunnel-on pair; fall back to last two runs.
  const lastOn = [...runs].reverse().find(r => r.tunnel);
  const lastOff = [...runs].reverse().find(r => !r.tunnel);
  let a, b, label;
  if (lastOn && lastOff) {
    [a, b] = lastOff.at < lastOn.at ? [lastOff, lastOn] : [lastOn, lastOff];
    label = `сравнение прогонов: туннель ${a.tunnel ? 'вкл' : 'выкл'} → туннель ${b.tunnel ? 'вкл' : 'выкл'}`;
  } else {
    [a, b] = runs.slice(-2);
    label = 'сравнение двух последних прогонов';
  }

  const t = iso => new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  $('compare-sub').textContent = `${label} · ${t(a.at)} → ${t(b.at)}`;

  $('compare-grid').innerHTML = config.paths.map(p => {
    const ra = a.results.find(r => r.id === p.id);
    const rb = b.results.find(r => r.id === p.id);
    if (!ra || !rb || ra.median === null || rb.median === null) return '';
    const d = rb.median - ra.median;
    const cls = Math.abs(d) < 1 ? 'same' : d < 0 ? 'better' : 'worse';
    const sign = d < 0 ? '▼' : d > 0 ? '▲' : '•';
    const dLoss = rb.lossPct - ra.lossPct;
    return `<div class="cmp fade-in">
      <div class="name">${p.name}</div>
      <div class="row">
        <span class="then">${fmt(ra.median)}</span>
        <span class="now">${fmt(rb.median)} мс</span>
        <span class="d ${cls}">${sign} ${fmt(Math.abs(d))}</span>
      </div>
      <div class="sub2">потери ${fmt(ra.lossPct)}% → ${fmt(rb.lossPct)}% · джиттер ±${fmt(ra.jitter)} → ±${fmt(rb.jitter)} мс${Math.abs(dLoss) > 0.1 ? '' : ''}</div>
    </div>`;
  }).join('');
  el.hidden = false;
}

let tunnelCtl = null;

function renderTunnel(on, ctl) {
  if (ctl) tunnelCtl = ctl;
  const pill = $('tunnel-pill');
  const c = tunnelCtl || {};
  pill.classList.toggle('on', on);
  const clickable = !!c.hasConf;
  pill.classList.toggle('clickable', clickable);
  let label;
  if (!c.hasConf) {
    label = on ? 'туннель активен' : 'туннель не найден';
  } else if (!c.wgInstalled) {
    label = 'установить WireGuard';
  } else {
    label = on ? 'туннель вкл — выключить' : 'туннель выкл — включить';
  }
  $('tunnel-label').textContent = label;
}

async function tunnelClick() {
  const pill = $('tunnel-pill');
  const c = tunnelCtl || {};
  if (!c.hasConf) return;
  pill.classList.add('busy');
  try {
    if (!c.wgInstalled) {
      $('tunnel-label').textContent = 'ставим WireGuard…';
      setStatus('Скачиваем WireGuard с официального сайта… в окне Windows нажми «Да»');
      const st = await window.pinglab.installWireGuard();
      renderTunnel(st.active, st);
      setStatus(st.wgInstalled
        ? 'WireGuard установлен ✓ Окно WireGuard можно закрыть — им управляет это приложение. Теперь нажми «включить».'
        : 'Не получилось установить WireGuard. Разреши запуск в окне Windows и попробуй ещё раз.',
        st.wgInstalled ? 'ok' : 'err');
    } else {
      $('tunnel-label').textContent = c.active ? 'выключаем…' : 'включаем… (окно Windows — жми Да)';
      const st = await window.pinglab.tunnelToggle(!c.active);
      renderTunnel(st.active, st);
      if (st.active) {
        setStatus('Туннель включён, проверяем маршрут до игрового сервера…');
        const probe = await window.pinglab.quickProbe();
        setStatus(probe !== null
          ? `Туннель работает ✓ Игровой сервер отвечает через релей за ${probe.toFixed(0)} мс. Нажми «Замерить» для полного сравнения.`
          : 'Туннель поднят, но игровой сервер не ответил — проверь интернет или выключи другие VPN.',
          probe !== null ? 'ok' : 'err');
      } else {
        setStatus('Туннель выключен — играешь напрямую.', '');
      }
    }
  } catch {
    const st = await window.pinglab.tunnelStatus();
    renderTunnel(st.active, st);
    setStatus('Действие отменено или не удалось. Если было окно Windows — нужно нажать «Да».', 'err');
  } finally {
    pill.classList.remove('busy');
  }
}

function renderFoot(run) {
  const game = config.paths.find(p => p.role === 'current');
  const relay = config.paths.find(p => p.role === 'relay');
  const when = run ? new Date(run.at).toLocaleString('ru') : 'ещё не было';
  const left = `сервер ${game ? game.host : '?'}${relay ? ` · релей ${relay.host}` : ''}`;
  $('foot').innerHTML = `<span>${left}</span><span>последний замер: ${when}</span>`;
}

function renderAll(run, history, tunnel, ctl) {
  renderTunnel(tunnel, ctl);
  renderVerdict(run);
  renderCards(run);
  renderCompare(history);
  renderFoot(run);
}

function setStatus(text, cls) {
  const el = $('status-line');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `status-line ${cls || ''}`;
  el.textContent = text;
}

/* ---------- live stability monitor ---------- */
const MON_WINDOW = 240; // ~3 min at 700ms per probe
let monRunning = false;
let monSamples = [];

function monStats() {
  const ok = monSamples.filter(s => s.ms !== null).map(s => s.ms);
  const lost = monSamples.length - ok.length;
  if (!ok.length) return { now: null, med: null, p95: null, loss: 100 };
  const sorted = [...ok].sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const lastOk = [...monSamples].reverse().find(s => s.ms !== null);
  return { now: lastOk ? lastOk.ms : null, med: q(0.5), p95: q(0.95),
           loss: (lost / monSamples.length) * 100 };
}

function drawMonitor() {
  const svg = $('mon-chart');
  const W = 960, H = 140, pad = 6;
  if (!monSamples.length) { svg.innerHTML = ''; return; }
  const ok = monSamples.filter(s => s.ms !== null).map(s => s.ms);
  if (!ok.length) { svg.innerHTML = ''; return; }
  const sorted = [...ok].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const lo = Math.min(...ok), hi = Math.max(...ok, med * 1.6);
  const span = Math.max(hi - lo, 10);
  const step = (W - pad * 2) / (MON_WINDOW - 1);
  const y = v => pad + (H - pad * 2) * (1 - (v - lo) / span);
  const x = i => pad + i * step;
  const offset = MON_WINDOW - monSamples.length;

  let d = '', lastNull = true;
  const spikes = [], losses = [];
  monSamples.forEach((s, i) => {
    const xi = x(offset + i);
    if (s.ms === null) {
      losses.push(`<line x1="${xi.toFixed(1)}" y1="${pad}" x2="${xi.toFixed(1)}" y2="${H - pad}" stroke="var(--critical)" stroke-width="2" opacity="0.8"/>`);
      lastNull = true;
      return;
    }
    d += `${lastNull ? 'M' : 'L'}${xi.toFixed(1)},${y(s.ms).toFixed(1)}`;
    lastNull = false;
    if (s.ms > med * 1.5) {
      spikes.push(`<circle cx="${xi.toFixed(1)}" cy="${y(s.ms).toFixed(1)}" r="3.5" fill="var(--critical)"/>`);
    }
  });
  const medY = y(med).toFixed(1);
  svg.innerHTML =
    `<line x1="0" y1="${medY}" x2="${W}" y2="${medY}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4 5" opacity="0.5"/>` +
    `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>` +
    spikes.join('') + losses.join('');
}

function monitorTick(sample) {
  if (!monRunning) return;
  monSamples.push(sample);
  if (monSamples.length > MON_WINDOW) monSamples.shift();
  const s = monStats();
  $('mon-now').textContent = s.now === null ? '—' : `${fmt(s.now)} мс`;
  $('mon-med').textContent = s.med === null ? '—' : `${fmt(s.med)} мс`;
  $('mon-p95').textContent = s.p95 === null ? '—' : `${fmt(s.p95)} мс`;
  $('mon-loss').textContent = `${fmt(s.loss)}%`;
  drawMonitor();
}

async function monitorToggle() {
  const btn = $('mon-btn');
  if (monRunning) {
    monRunning = false;
    await window.pinglab.monitorStop();
    btn.textContent = 'Старт';
    btn.classList.remove('running');
  } else {
    monRunning = true;
    monSamples = [];
    $('mon-live').hidden = false;
    $('mon-chart').hidden = false;
    btn.textContent = 'Стоп';
    btn.classList.add('running');
    await window.pinglab.monitorStart();
  }
}

async function init() {
  const state = await window.pinglab.getState();
  config = state.config;
  $('game-name').textContent = config.gameName;
  const last = state.history.at(-1) || null;
  renderAll(last, state.history, state.tunnel, state.tunnelCtl);
  $('tunnel-pill').addEventListener('click', tunnelClick);
  $('mon-btn').addEventListener('click', monitorToggle);
  window.pinglab.onMonitorSample(monitorTick);

  window.pinglab.onProgress(({ id, frac }) => {
    progress[id] = frac;
    const vals = Object.values(progress);
    const total = vals.reduce((s, v) => s + v, 0) / config.paths.length;
    $('progress-fill').style.width = `${(total * 100).toFixed(0)}%`;
    const pend = $(`pend-${id}`);
    if (pend) pend.textContent = `${Math.round(frac * 100)}%`;
  });

  $('run-btn').addEventListener('click', async () => {
    const btn = $('run-btn');
    btn.disabled = true;
    btn.textContent = 'Меряем…';
    progress = {};
    $('progress-rail').hidden = false;
    $('progress-fill').style.width = '0%';
    renderCards(null);
    $('verdict').hidden = true;
    try {
      const { run, history } = await window.pinglab.runTest();
      renderAll(run, history, run.tunnel);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Замерить';
      $('progress-rail').hidden = true;
    }
  });
}

init();
