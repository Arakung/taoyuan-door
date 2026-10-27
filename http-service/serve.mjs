#!/usr/bin/env node
/**
 * 桃园谷 · 一键开门 HTTP 服务（零依赖，Node 22+）
 *
 * 给 iOS 快捷指令 / Android HTTP Shortcuts / 浏览器书签 / Home Assistant 调用的极简端点。
 *
 *   node direct/serve.mjs                    # 默认 0.0.0.0:8787
 *   PORT=9000 node direct/serve.mjs
 *
 * 端点：
 *   GET /                 手机浏览器打开的一个大按钮页面（可「添加到主屏幕」当 App 图标）
 *   GET /open             开默认门
 *   GET /open/2           开第 2 个门口机（也支持名称片段：/open/2号）
 *   GET /doors            列出房产与门口机
 *   GET /health           健康检查
 *
 * 访问口令：config.json 里的 accessKey（或环境变量 TYG_ACCESS_KEY）
 *   GET /open?k=<accessKey>
 * 未配置口令时不校验（仅建议在完全可信的局域网内这么用）。
 */
import http from 'node:http';
import { loadConfig, Taoyuan } from './core.mjs';

const cfg = loadConfig();
const svc = new Taoyuan(cfg, (m) => console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${m}`));

function send(res, status, data, type = 'application/json;charset=UTF-8', headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

function getProvidedKey(req, url) {
  const auth = req.headers['authorization'];
  const bearer = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return (
    req.headers['x-access-key'] ??
    req.headers['x-access-token'] ??
    (bearer || undefined) ??
    url.searchParams.get('k') ??
    url.searchParams.get('access_key') ??
    getCookie(req, 'tyg_key') ??
    ''
  );
}

function authorized(req, url) {
  if (!cfg.accessKey) return true;
  return getProvidedKey(req, url) === cfg.accessKey;
}

function authCookieHeader(req, url) {
  if (!cfg.accessKey) return {};
  const paramKey = url.searchParams.get('k') ?? url.searchParams.get('access_key');
  if (paramKey && paramKey === cfg.accessKey) {
    return {
      'Set-Cookie': `tyg_key=${encodeURIComponent(cfg.accessKey)}; Path=/; SameSite=Lax; Max-Age=31536000; HttpOnly`,
    };
  }
  return {};
}

function authPage() {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#111418">
<link rel="icon" href="/icon.png">
<title>桃园谷 · 门禁验证</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center;
         justify-content:center; background:#111418; color:#e8eaed;
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; padding:32px 24px; }
  .card { width:min(90vw,360px); background:#181c22; border:1px solid #282f3a; border-radius:20px;
          padding:32px 24px; display:flex; flex-direction:column; gap:20px; box-shadow:0 20px 40px rgba(0,0,0,.5); }
  h1 { font-size:18px; font-weight:600; margin:0; text-align:center; color:#fff; }
  p { font-size:13px; color:#8b939e; margin:0; text-align:center; }
  input { width:100%; padding:14px 16px; background:#111418; border:1px solid #30363d; border-radius:12px;
          color:#fff; font-size:15px; outline:none; transition:border-color .15s; }
  input:focus { border-color:#2a6df4; }
  button { width:100%; padding:13px; background:#2a6df4; color:#fff; border:none; border-radius:12px;
           font-size:15px; font-weight:600; cursor:pointer; transition:opacity .15s; }
  button:active { opacity:.85; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  #err { font-size:13px; color:#f85149; text-align:center; min-height:18px; }
</style>
</head><body>
<div class="card">
  <h1>桃园谷 · 门禁验证</h1>
  <p>服务已启用访问保护，请输入口令进入</p>
  <form id="f" onsubmit="submitKey(event)">
    <div style="display:flex;flex-direction:column;gap:12px;">
      <input type="password" id="pw" placeholder="访问口令 (accessKey)" autocomplete="current-password" autofocus required>
      <button type="submit" id="btn">确认进入</button>
    </div>
  </form>
  <div id="err"></div>
</div>
<script>
async function submitKey(e) {
  if (e) e.preventDefault();
  const pw = document.getElementById('pw').value.trim();
  if (!pw) return;
  const btn = document.getElementById('btn'), err = document.getElementById('err');
  btn.disabled = true; btn.textContent = '验证中…'; err.textContent = '';
  try {
    const res = await fetch('/doors?k=' + encodeURIComponent(pw));
    if (res.ok) {
      location.href = '/?k=' + encodeURIComponent(pw);
    } else {
      const d = await res.json().catch(() => ({}));
      err.textContent = d.message || '访问口令不正确';
      btn.disabled = false; btn.textContent = '确认进入';
    }
  } catch (ex) {
    err.textContent = '网络错误：' + ex.message;
    btn.disabled = false; btn.textContent = '确认进入';
  }
}
</script>
</body></html>`;
}

/* ---------------- 开门记录 ---------------- */
/* 环形缓冲，最多 100 条，只存内存（容器重启清空）。挂载目录是 :ro，落不了盘。 */
const HISTORY_MAX = 100;
const history = [];
function pushHistory(e) {
  history.push({ t: Date.now(), ...e });
  if (history.length > HISTORY_MAX) history.shift();
}

/* PWA 图标：180x180 PNG，base64 内嵌（免多传文件）。改图标：重新生成后替换即可 */
const ICON = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAV/UlEQVR42u3dz5Nc1XUHcP0NsRAgtQ2OQKrKLt5klqkIISSM' +
  'QUItCCbBAozkqmxm4UVcrlRllZ9NTCpZJMtUpZLqCvr9E4mZkWbU0ggJBML6yc8nhAWCBeRHpSqLl3vf69fv/jjn3HNf98zr' +
  'mXdO1SmXsRB2z8dH33vu6+4VK6SkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSk' +
  'pKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKRqrdbT5yZUt/vdHfS2s701286mdveKTlR312wt+syk6rZueUWlFhHvvMI7r+DO' +
  'a7Q91Sm7t+lGgG8t+kzRyZqtcwr63OTqp+YEudRIEfcBz6deb3f6aapDwE3cZ8p+ai5dnXdv9VOzCvhsS34qUnGIt89PKoS9' +
  'Eu35ETQBHMKNwp7VnajuCG4pAvH5CYWu6wL+btZv2d0OtPvrg8BN3BTswbTOYT+p+3RP9aT8BKUKyJOqeyBgC+qFig1Bd3BD' +
  'k5sFe7YP+7TuZPWTpzqqZWo3GHJSQnYRQzgvpt/dwex20QRyDzcF28/YAGrVp1KB3VDIg2kMIoahfm/H2+yGoQO4+/9nYsM2' +
  'p7UVQUrU9/8o6879P5oR2Ms3I+fRwp7GOGIP6TO632E2AzkytVHY6vBoxxAqghSoZxLVkrGXEeSW6i4OmQKMYb0UaB5yO55w' +
  'YFPTmkTdhz09ISKWNua2jhd2tCAggxPYgPqs2+8C7fwaFHpoagOwrWkNRxAa9XR6/xPTHZGx1KdyEDIA2ED7wJBtQYdwg1Pb' +
  'ztgw6nNVUSeqZVovoawMT+UQ5D46H+V76QN/WLH13+sBN3H7sNEoMoBtR5CKqFVPSbZeAhEDnco0ZArw5SEbBw5O7ahpbaI+' +
  'y0A9k3cOWndX5IwnZjhimFPZysgAZArxc+9n/SCzHxg0D3dwYg+mdUXU1krPRn3fE1OJalnvjX1eBqcyBTkE+Nd+/7jfz2Ht' +
  'IIdwU7CxaU2iRrYfHurpEvUP30xUS64eA8yJj/kiiRmF/NxlB7GD9sdXItvFjuG2YX8PgQ1HkCqo3Tw9VaDWLY+rjhVmMGK4' +
  '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', 'base64');

/* ---------------- 脱敏（默认关闭） ---------------- */
/* 默认原样输出真实地址/户号/设备号。需要截图或给别人看时再加 TYG_MASK=1 启动：
   TYG_MASK=1     地址留小区名，门牌房号折叠；门口机名统一成「门口机 N」
   TYG_MASK=full  连小区名一起隐藏，只留 ＊＊＊
   运行时数据本身不改，只在出网关前折叠。 */
const MASK_LEVEL = String(process.env.TYG_MASK ?? '0').toLowerCase();
const MASK_ON = MASK_LEVEL !== '0' && MASK_LEVEL !== 'off' && MASK_LEVEL !== 'false';
const MASK_FULL = MASK_LEVEL === 'full';
const MASK = '＊＊＊';

/** 地址：只留小区/园区名（第一个数字之前），门牌与房号整体折叠 */
function maskAddress(addr) {
  if (!MASK_ON || !addr) return addr ?? '';
  if (MASK_FULL) return MASK;
  const head = String(addr).split(/[\d０-９]/)[0].replace(/[-—–\s]+$/, '').trim();
  return head.length >= 2 ? `${head} ${MASK}` : MASK;
}

/** 门口机名：统一成「门口机 N」，只保留「自带/内置」这种不含位置的信息 */
function maskDoorName(name, index) {
  if (!MASK_ON) return name ?? '';
  const tag = /自带|内置/.test(String(name ?? '')) ? ' · 自带' : '';
  return `门口机${index != null ? ' ' + index : ''}${tag}`;
}

/** 长编号：留头几位便于分辨是哪一户，其余折叠 */
function maskId(v, keep = 4) {
  if (!MASK_ON || !v) return v ?? '';
  const s = String(v);
  if (s.length <= keep) return MASK;
  return s.slice(0, keep) + MASK;
}

/** /doors 出口统一过一遍 */
function sanitizeDoors(d) {
  if (!MASK_ON || !d) return d;
  return {
    ...d,
    room: d.room
      ? { ...d.room, address: maskAddress(d.room.address), householdSerial: maskId(d.room.householdSerial) }
      : d.room,
    doors: (d.doors ?? []).map((x) => ({
      ...x,
      name: maskDoorName(x.name, x.index),
      code: maskId(x.code),
    })),
  };
}

function page(userKey = '') {
  const k = userKey ? `?k=${encodeURIComponent(userKey)}` : '';
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="开门">
<meta name="theme-color" content="#111418">
<link rel="icon" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">
<link rel="manifest" href="/manifest.json${k}">
<title>开门</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center;
         justify-content:center; gap:26px; background:#111418; color:#e8eaed;
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; padding:32px 24px calc(32px + env(safe-area-inset-bottom)); }
  .door { width:min(78vw,320px); aspect-ratio:1; border-radius:50%; border:none; cursor:pointer;
          background:radial-gradient(circle at 35% 30%,#2a6df4,#1240a8); color:#fff;
          font-size:26px; font-weight:600; letter-spacing:.04em; display:flex; flex-direction:column;
          align-items:center; justify-content:center; gap:6px;
          box-shadow:0 18px 48px rgba(42,109,244,.35), inset 0 1px 0 rgba(255,255,255,.25);
          transition:transform .12s ease, box-shadow .12s ease; }
  .door:active { transform:scale(.965); box-shadow:0 8px 24px rgba(42,109,244,.3); }
  .door small { font-size:12px; font-weight:400; opacity:.75; letter-spacing:.1em; }
  .door.busy { background:radial-gradient(circle at 35% 30%,#3a3f47,#22262b); box-shadow:none; }
  .door.ok { background:radial-gradient(circle at 35% 30%,#2ecc71,#149a52); box-shadow:0 18px 48px rgba(46,204,113,.3); }
  .door.fail { background:radial-gradient(circle at 35% 30%,#e74c3c,#a32b20); box-shadow:0 18px 48px rgba(231,76,60,.3); }
  #log { font-size:13px; color:#8b939e; min-height:1.5em; text-align:center; max-width:320px; }
  .doors { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
  .doors a { color:#9fb4d8; text-decoration:none; font-size:13px; border:1px solid #2a3038;
             border-radius:999px; padding:7px 14px; transition:border-color .15s, background .15s; }
  .doors a:active { background:rgba(42,109,244,.15); border-color:#2a6df4; }
  #hist { width:min(78vw,320px); font-size:12px; color:#5d6570; text-align:left; }
  #hist .h { display:flex; justify-content:space-between; gap:10px; padding:5px 2px;
             border-top:1px solid #1c2127; }
  #hist .h:first-child { border-top:none; }
  #hist .ok { color:#7fae93; } #hist .no { color:#b0766e; }
  #hist .t { flex:none; font-variant-numeric:tabular-nums; }
</style>
</head><body>
<button class="door" id="btn">开门<small id="sub">轻触</small></button>
<div id="log"></div>
<div class="doors" id="doors"></div>
<div id="hist"></div>
<script>
const K = ${JSON.stringify(k)};
const btn = document.getElementById('btn'), log = document.getElementById('log'), sub = document.getElementById('sub');
let timer;
const two = n => String(n).padStart(2, '0');
function loadHist(){
  fetch('/history' + K).then(r => {
    if (r.status === 401) { location.reload(); return; }
    return r.json();
  }).then(d => {
    if (!d || !d.items || !d.items.length) return;
    document.getElementById('hist').innerHTML = d.items.slice(0, 4).map(x => {
      const dt = new Date(x.t);
      const tm = two(dt.getHours()) + ':' + two(dt.getMinutes());
      const txt = x.deduped ? '刚开过' : (x.ok ? '已开' : (x.err || '失败'));
      return '<div class="h"><span class="t">' + tm + '</span><span class="' +
             (x.ok ? 'ok' : 'no') + '">' + (x.door || '') + ' · ' + txt + '</span></div>';
    }).join('');
  }).catch(() => {});
}
async function load(){
  try {
    const r = await fetch('/doors' + K);
    if (r.status === 401) { location.reload(); return; }
    const d = await r.json();
    if (!d.room) throw new Error(d.message || '读取失败');
    document.getElementById('doors').innerHTML =
      d.doors.map(x => '<a href="/open/' + encodeURIComponent(x.index) + K + '" onclick="return clickDoor(event, \\'' + x.index + '\\')">' + x.name + '</a>').join('');
  } catch (e) { log.textContent = e.message; }
}
function clickDoor(e, idx) {
  if (e) e.preventDefault();
  open(idx);
  return false;
}
async function open(door){
  btn.className = 'door busy'; sub.textContent = '连接中'; log.textContent = '';
  try {
    const ep = door ? ('/open/' + encodeURIComponent(door) + K) : ('/open' + K);
    const r = await fetch(ep, { cache: 'no-store' });
    if (r.status === 401) {
      btn.className = 'door fail'; sub.textContent = '口令失效'; log.textContent = '口令已失效，请重新验证';
      setTimeout(() => location.reload(), 1500);
      return;
    }
    const d = await r.json();
    if (d.ok) {
      btn.className = 'door ok'; sub.textContent = d.deduped ? '刚开过' : '已开';
      log.textContent = (d.door || '门口机') + ' · ' + (d.ms || 0) + 'ms';
      if (navigator.vibrate) navigator.vibrate(35);
    } else {
      btn.className = 'door fail'; sub.textContent = '失败';
      log.textContent = d.message || '未知原因';
    }
  } catch (e) {
    btn.className = 'door fail'; sub.textContent = '网络'; log.textContent = e.message;
  }
  clearTimeout(timer);
  timer = setTimeout(() => { btn.className = 'door'; sub.textContent = '轻触'; }, 5000);
  loadHist();  // 开完刷新最近记录
}
btn.addEventListener('click', () => open());
load();
loadHist();
</script>
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const p = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (p === '/health') {
      return send(res, 200, { ok: true, service: 'taoyuan-quick-open', auth: !!cfg.accessKey });
    }
    /* 图标与 manifest 不含敏感信息，放鉴权之前，浏览器缓存得住 */
    if (p === '/icon.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(ICON);
    }
    if (p === '/manifest.json') {
      const isAuth = authorized(req, url);
      const manifestKey = isAuth && cfg.accessKey ? `?k=${encodeURIComponent(cfg.accessKey)}` : '';
      return send(res, 200, {
        name: '开门', short_name: '开门', start_url: `/${manifestKey}`,
        display: 'standalone', background_color: '#111418', theme_color: '#111418',
        icons: [{ src: '/icon.png', sizes: '180x180', type: 'image/png' }],
      }, 'application/manifest+json');
    }
    if (p === '/' || p === '/index.html') {
      if (!authorized(req, url)) {
        return send(res, 401, authPage(), 'text/html;charset=UTF-8');
      }
      const providedKey = url.searchParams.get('k') ?? url.searchParams.get('access_key') ?? '';
      return send(res, 200, page(providedKey), 'text/html;charset=UTF-8', authCookieHeader(req, url));
    }
    if (!authorized(req, url)) {
      return send(res, 401, { ok: false, message: '访问口令不正确' });
    }
    if (p === '/doors') {
      const d = await svc.listDoors(url.searchParams.get('room'));
      return send(res, 200, sanitizeDoors(d));
    }
    if (p === '/history') {
      return send(res, 200, { ok: true, count: history.length, items: history.slice().reverse() });
    }
    if (p === '/open' || p.startsWith('/open/')) {
      const sel = p.startsWith('/open/') ? decodeURIComponent(p.slice(6)) : undefined;
      const r = await svc.open({
        door: sel || url.searchParams.get('door') || undefined,
        room: url.searchParams.get('room') ? Number(url.searchParams.get('room')) : undefined,
        dryRun: url.searchParams.get('dry') === '1',
      });
      const status = r.ok ? 200 : 502;
      const out = MASK_ON
        ? { ...r, door: maskDoorName(r.door), code: r.code ? maskId(r.code) : r.code }
        : r;
      if (!r.dryRun) {
        pushHistory({
          door: out.door, ok: !!r.ok, deduped: !!r.deduped, ms: r.ms ?? 0,
          ip: (req.socket.remoteAddress || '').replace('::ffff:', ''),
        });
      }
      console.log(
        r.deduped
          ? `开门 已忽略 ${out.door ?? ''}（3 秒内重复触发）`
          : `开门 ${r.ok ? '成功' : '失败'} ${out.door ?? ''} ${r.ms ?? ''}ms`
      );
      return send(res, status, out);
    }
    return send(res, 404, { ok: false, message: '未知路径，可用：/、/open、/doors、/history、/health' });
  } catch (err) {
    console.log(`请求失败 ${p}: ${err.message}`);
    if (p === '/open' || p.startsWith('/open/')) {
      pushHistory({ door: p, ok: false, ms: 0, ip: (req.socket.remoteAddress || '').replace('::ffff:', ''), err: err.message });
    }
    return send(res, 500, { ok: false, message: err.message });
  }
});

server.listen(cfg.port, cfg.host, () => {
  const lines = [
    `桃园谷开门服务已启动  http://${cfg.host}:${cfg.port}`,
    `  手机浏览器打开：http://<本机局域网IP>:${cfg.port}/${cfg.accessKey ? `?k=${cfg.accessKey}` : ''}`,
    cfg.accessKey ? `  访问口令已启用（?k=… 或 X-Access-Key 头）` : `  ⚠ 未设置 accessKey，局域网内任何人都能触发开门`,
  ];
  console.log(lines.join('\n'));
});
