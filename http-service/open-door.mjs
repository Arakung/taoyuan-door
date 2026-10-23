#!/usr/bin/env node
/**
 * 桃园谷门禁 · 直连开门（零依赖单文件，Node 22+）
 *
 * 直接对准官方接口完成三步：取 authcode → WSS 握手 → 下发 OpenDoor 指令 → 收回执。
 * 不需要任何服务、broker、npm 依赖。
 *
 * 用法：
 *   node direct/open-door.mjs --alias main
 *   node direct/open-door.mjs --code DEV-001 --number 1 --household HH-1 --mobile 13800000000 --token <UUMSToken>
 *   node direct/open-door.mjs --alias main --wait 15000 --verbose   # 多听一会，用于摸清回执结构
 *   node direct/open-door.mjs --list                                # 列出已配置的门
 *
 * 参数来源优先级：命令行 > 环境变量(TYG_*) > direct/config.json
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(HERE, 'config.json');

// ---------- 基础工具 ----------
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const pad = (n) => String(n).padStart(2, '0');
const timestamp = (d = new Date()) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const eq = key.indexOf('=');
    if (eq !== -1) {
      args[key.slice(0, eq)] = key.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      flags.add(key);
    }
  }
  return { args, flags };
}

function loadConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// ---------- 组装配置 ----------
const { args, flags } = parseArgs(process.argv.slice(2));
const file = loadConfigFile();

if (flags.has('help') || flags.has('h')) {
  // eslint-disable-next-line no-console
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

const cfg = {
  baseUrl: (args['base-url'] ?? process.env.TYG_BASE_URL ?? file.baseUrl ?? 'http://lxj.taoyuangu.com').replace(/\/+$/, ''),
  // 相对 cpsApi_server（https://sso.taoyuangu.com/cpsApi/）的子路径，不要再带 cpsApi 前缀
  authcodePath: args['authcode-path'] ?? process.env.TYG_AUTHCODE_PATH ?? file.authcodePath ?? '/openDoor/getAuthcode',
  wssUrl: args['wss-url'] ?? process.env.TYG_WSS_URL ?? file.wssUrl ?? 'wss://lxj.taoyuangu.com/wsserver/websocket',
  salt: args.salt ?? process.env.TYG_SALT ?? file.salt ?? 'EA3vWPmfxhWUit2s',
  clientType: args['client-type'] ?? process.env.TYG_CLIENT_TYPE ?? file.clientType ?? '2',
  uumsHeaderField: process.env.TYG_UUMS_HEADER_FIELD ?? file.uumsHeaderField ?? 'uumsToken',
  // 服务端会把各模块的真实地址动态下发，启动时自动拉取，避免硬编码过期
  configUrl:
    args['config-url'] ??
    process.env.TYG_CONFIG_URL ??
    file.configUrl ??
    'http://lxj.taoyuangu.com/uums/servlet/getAllConfigsServlet',
  waitMs: Number(args.wait ?? process.env.OPEN_TIMEOUT_MS ?? file.waitMs ?? 8000),
  verbose: flags.has('verbose') || flags.has('v') || process.env.LOG_LEVEL === 'debug',
  dryRun: flags.has('dry-run'),
  wssTokenSource: args['wss-token'] ?? file.wssTokenSource ?? 'authcode',
  authBodyExtra: args['auth-body'] ? JSON.parse(args['auth-body']) : (file.authBody ?? {}),
};

const doors = file.doors ?? [];
const alias = args.alias ?? args.door ?? process.env.TYG_DOOR_ALIAS ?? (doors.length === 1 ? doors[0].alias : 'default');

if (flags.has('list')) {
  // eslint-disable-next-line no-console
  console.log(doors.length ? doors : '(direct/config.json 里没有配置 doors)');
  process.exit(0);
}

const preset = doors.find((d) => d.alias === alias) ?? (doors.length === 1 ? doors[0] : undefined);
const door = {
  alias,
  code: args.code ?? process.env.TYG_DOOR_CODE ?? preset?.code ?? '',
  number: args.number ?? process.env.TYG_DOOR_NUMBER ?? preset?.number ?? '',
  householdSerial: args.household ?? process.env.TYG_HOUSEHOLD_SERIAL ?? preset?.householdSerial ?? '',
  mobile: args.mobile ?? process.env.TYG_MOBILE ?? preset?.mobile ?? '',
};
const uumsToken = args.token ?? process.env.TYG_UUMS_TOKEN ?? file.uumsToken ?? '';
const presetAuthcode = args.authcode ?? '';

const say = (...m) => console.log(...m);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

// ---------- 第 0 步：拉取服务端下发的模块地址 ----------
const serverMap = flags.has('no-discover') ? {} : await loadServerMap(cfg, flags.has('refresh'));

if (flags.has('discover')) {
  say(JSON.stringify(serverMap, null, 2));
  process.exit(0);
}

const cpsApiBase = serverMap.cpsApi_server ?? `${cfg.baseUrl}/cpsApi/`;
const authcodeUrl =
  args['authcode-url'] ??
  (serverMap.cpsApi_server
    ? new URL(cfg.authcodePath.replace(/^\/+/, ''), serverMap.cpsApi_server).href
    : `${cfg.baseUrl}${cfg.authcodePath.startsWith('/') ? '' : '/'}${cfg.authcodePath}`);

if (serverMap.cpsApi_server) say(`• 模块地址（服务端下发）cpsApi → ${cpsApiBase}`);
if (serverMap.outerSecurityIp) {
  say(`• 门禁安全服务 ${serverMap.outerSecurityIp}:${serverMap.outerSecurityPort ?? '?'}`);
  if (!args['wss-url'] && !file.wssUrl) {
    say(`  若 WSS 连不上，可试 --wss-url ws://${serverMap.outerSecurityIp}:${serverMap.outerSecurityPort}/wsserver/websocket`);
  }
}

const missing = ['code', 'number', 'householdSerial', 'mobile'].filter((k) => !door[k]);
if (missing.length) {
  fail(`门禁参数不完整，缺少：${missing.join(', ')}\n  请用 --code/--number/--household/--mobile 指定，或在 direct/config.json 的 doors 里配置别名 "${alias}"`);
}
if (!uumsToken) fail('缺少 UUMSToken：用 --token 传入，或设置 TYG_UUMS_TOKEN / config.json 的 uumsToken');

// ---------- 第 1 步：取 authcode ----------
let authcode = presetAuthcode;

// dry-run 不发任何网络请求，用占位凭证把报文打出来
if (cfg.dryRun && !authcode) authcode = '<DRYRUN-AUTHCODE>';

if (!authcode) {
  const ts = timestamp();
  const header = { token: md5(`${cfg.salt}${ts}`), time_stamp: ts };
  header[cfg.uumsHeaderField] = uumsToken;
  const body = { householdSerial: door.householdSerial, code: door.code, ...cfg.authBodyExtra };
  const payload = { header, body };

  say(`→ POST ${authcodeUrl}`);
  if (cfg.verbose) say(`  请求体 ${JSON.stringify(payload)}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.waitMs);
  let raw;
  try {
    const res = await fetch(authcodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      raw = JSON.parse(text);
    } catch {
      raw = text;
    }
    if (!res.ok) fail(`HTTP ${res.status}：${text.slice(0, 500)}`);
  } catch (e) {
    fail(`请求失败：${e.name === 'AbortError' ? '超时' : e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (cfg.verbose) say(`  响应 ${JSON.stringify(raw).slice(0, 800)}`);
  authcode = extractAuthcode(raw);
  if (!authcode) fail(`未取到凭证，原始响应：${JSON.stringify(raw).slice(0, 500)}\n  可用 --auth-body '{"字段":"值"}' 调整请求体，或 --authcode 直接指定`);
  say(`✓ 取得动态凭证 ${authcode.slice(0, 4)}****（长度 ${authcode.length}）`);
} else {
  say(`• 使用指定凭证 ${authcode.slice(0, 4)}****`);
}

// ---------- 第 2 步：构造开门报文 ----------
const wsToken = cfg.wssTokenSource === 'uums' ? uumsToken : authcode;
const message = {
  header: { msgType: 'OpenDoor', token: wsToken, time_stamp: timestamp() },
  body: {
    code: door.code,
    mobile: door.mobile,
    clientType: cfg.clientType,
    householdSerial: door.householdSerial,
    number: door.number,
  },
};
const text = JSON.stringify(message);
say(`→ WSS ${cfg.wssUrl}?token=****`);
if (cfg.verbose) say(`  报文 ${text}`);

if (cfg.dryRun) {
  say('\n[--dry-run] 未发起任何网络请求，将要发送的报文如下：');
  say(JSON.stringify(message, null, 2));
  process.exit(0);
}

// ---------- 第 3 步：WSS 连接并下发 ----------
const target = new URL(cfg.wssUrl);
target.searchParams.set('token', wsToken);

const ws = new WebSocket(target.toString());

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WSS 握手超时')), cfg.waitMs);
  ws.addEventListener('open', () => {
    clearTimeout(timer);
    resolve();
  });
  ws.addEventListener('error', (e) => {
    clearTimeout(timer);
    reject(new Error(e.message ?? 'WSS 连接错误'));
  });
}).catch((e) => fail(`WSS 连接失败：${e.message}`));

say('✓ WSS 已连接，下发开门指令…');

let gotAck = false;
ws.addEventListener('message', (ev) => {
  gotAck = true;
  say(`← 收到回执 ${typeof ev.data === 'string' ? ev.data : '(binary)'}`);
});

ws.addEventListener('close', (ev) => {
  say(`• 连接关闭 code=${ev.code}`);
});
ws.addEventListener('error', (ev) => {
  say(`• 连接错误 ${ev.message ?? ''}`);
});

ws.send(text);

await new Promise((r) => setTimeout(r, cfg.waitMs));

try {
  ws.close();
} catch {
  /* ignore */
}

if (!gotAck) {
  say(`\n⚠ ${cfg.waitMs}ms 内未收到任何回执 —— 指令可能已送达但服务端不回包。`);
  say('  建议加大 --wait 再试，或用 --verbose 观察；若确认服务端不回包，开门是否成功需以现场为准。');
} else {
  say('\n✓ 已收到回执，请查看上面内容判断开门结果。');
}
process.exit(0);

// ---------- 服务端模块地址（带 24h 本地缓存） ----------
async function loadServerMap(cfg, refresh) {
  const cacheFile = path.join(HERE, 'server-config.json');
  if (!refresh) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Date.now() - cached.fetchedAt < 24 * 3600 * 1000) {
        if (cfg.verbose) say(`• 使用缓存的模块地址（${new Date(cached.fetchedAt).toLocaleString()}）`);
        return cached.map ?? {};
      }
    } catch {
      /* 无缓存则拉取 */
    }
  }

  const ts = timestamp();
  const header = { token: md5(`${cfg.salt}${ts}`), time_stamp: ts };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.waitMs);
    const res = await fetch(cfg.configUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ header, body: {} }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    const map = {};
    for (const item of json?.serverConfigs ?? []) {
      if (item?.key) map[item.key] = item.value;
    }
    fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now(), map }, null, 2));
    return map;
  } catch (e) {
    say(`• 拉取模块地址失败（${e.message}），回退到硬编码地址`);
    return {};
  }
}

// ---------- 从响应中提取凭证 ----------
function extractAuthcode(raw) {
  if (typeof raw === 'string' && raw.trim() !== '' && !raw.trim().startsWith('{')) return raw.trim();
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw;
  // 注意：不取 code —— 很多接口用 code 表示返回码（如 "0"），会误当凭证
  const cands = [
    o.authcode, o.authCode, o.token, o.accessToken,
    o.data?.authcode, o.data?.authCode, o.data?.token,
    o.body?.authcode, o.body?.authCode, o.body?.token,
    o.result?.authcode, o.result?.authCode,
  ];
  for (const c of cands) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
    if (typeof c === 'number') return String(c);
  }
  return undefined;
}
