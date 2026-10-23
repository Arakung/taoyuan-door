#!/usr/bin/env node
/**
 * 桃园谷 · 获取 UUMSToken（零依赖单文件，Node 22+）
 *
 * 直接调用官方登录接口换取 UUMSToken，后续开门脚本用它做鉴权。
 * 不抓包、不需要 root，只要你的手机号 + 密码 或 短信验证码。
 *
 * 方式一（密码）：
 *   node direct/login.mjs --phone 138... --password '你的密码' --save
 *
 * 方式二（短信验证码，推荐，不用把密码写在命令行）：
 *   node direct/login.mjs --phone 138... --sms --save
 *
 * 只想看看接口怎么回的：
 *   node direct/login.mjs --phone 138... --password x --verbose --dry-run
 *   node direct/login.mjs --probe --body '{"mobile":"138...","password":"x"}'
 *
 * 常用参数：
 *   --phone / --password / --sms / --code <验证码>
 *   --save        把 token 写入 direct/token.json（已在 .gitignore 中）
 *   --verbose     打印完整请求与响应
 *   --dry-run     只打印将要发送的请求，不联网
 *   --body '{}'   完全自定义登录请求体（适配真实协议用）
 *   --path        覆盖登录路径，默认 /servlet/userLoginServlet
 *   --base        覆盖 uums 基址，默认 https://uums.taoyuangu.com:8443/uums
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(HERE, 'token.json');

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const pad = (n) => String(n).padStart(2, '0');
const timestamp = (d = new Date()) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

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

const { args, flags } = parseArgs(process.argv.slice(2));
const say = (...m) => console.log(...m);
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

const cfg = {
  base: (args.base ?? process.env.TYG_UUMS_BASE ?? 'https://uums.taoyuangu.com:8443/uums').replace(/\/+$/, ''),
  salt: args.salt ?? process.env.TYG_SALT ?? 'EA3vWPmfxhWUit2s',
  clientType: args['client-type'] ?? '2',
  verbose: flags.has('verbose') || flags.has('v'),
  dryRun: flags.has('dry-run'),
  waitMs: Number(args.wait ?? 15000),
};

const phone = args.phone ?? process.env.TYG_PHONE ?? '';
if (!phone && !flags.has('probe')) fail('缺少手机号：--phone 138...（或设置 TYG_PHONE）');

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

const post = async (url, body) => {
  const ts = timestamp();
  const header = { token: md5(`${cfg.salt}${ts}`), time_stamp: ts };
  const payload = { header, body };
  say(`→ POST ${url}`);
  if (cfg.verbose) say(`  请求体 ${JSON.stringify(payload)}`);
  if (cfg.dryRun) {
    say('\n[--dry-run] 未发起任何网络请求，将要发送：');
    say(JSON.stringify(payload, null, 2));
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.waitMs);
  let raw;
  try {
    const res = await fetch(url, {
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
  if (cfg.verbose) say(`  响应 ${JSON.stringify(raw).slice(0, 1500)}`);
  return raw;
};

// ---------- 通用探测模式 ----------
if (flags.has('probe')) {
  const body = args.body ? JSON.parse(args.body) : {};
  const url = `${cfg.base}${args.path ?? '/servlet/userLoginServlet'}`;
  const raw = await post(url, body);
  if (raw) {
    say('\n--- 原始响应 ---');
    say(JSON.stringify(raw, null, 2));
    const t = extractToken(raw);
    say(t ? `\n✓ 提取到 token：${t}` : '\n未识别到 token 字段，请从上面的响应里找，然后用 --body 调整请求体');
  }
  process.exit(0);
}

// ---------- 短信验证码登录 ----------
let loginPath = args.path ?? '/servlet/userLoginServlet';
let loginBody;

if (flags.has('sms')) {
  loginPath = args.path ?? '/servlet/smsUserLogin';
  const codeBody = args['code-body'] ? JSON.parse(args['code-body']) : { mobile: phone, clientType: cfg.clientType };
  const codeUrl = `${cfg.base}/servlet/getRandomCodeForSmsLogin`;

  if (!args.code) {
    const raw = await post(codeUrl, codeBody);
    if (raw === null) process.exit(0); // dry-run
    const ok = String(raw?.code ?? raw?.result ?? '') === '0' || raw?.success === true;
    say(ok ? '✓ 验证码已发送，请查收短信' : `• 短信下发响应：${JSON.stringify(raw).slice(0, 300)}`);
  }
  const code = args.code ?? (cfg.dryRun ? '123456' : await ask('请输入短信验证码：'));
  loginBody = args.body ? JSON.parse(args.body) : { mobile: phone, randomCode: code, clientType: cfg.clientType };
} else {
  // ---------- 密码登录 ----------
  let password = args.password ?? process.env.TYG_PASSWORD ?? '';
  if (!password && !cfg.dryRun) password = await ask('请输入密码（会明文回显，注意身后有人）：');
  if (!password && !cfg.dryRun) fail('缺少密码：--password 或设置 TYG_PASSWORD');
  // 有些端上传的是 MD5 后的密码，加 --md5-password 试另一种
  if (flags.has('md5-password')) {
    password = md5(password);
    say('• 密码已按 MD5 处理后再提交');
  }
  loginBody = args.body
    ? JSON.parse(args.body)
    : { mobile: phone, password, clientType: cfg.clientType };
  // userAccount 是响应 DTO 里的字段名，一并带上，提高一次命中的概率
  if (!args.body) loginBody.userAccount = phone;
}

// ---------- 登录取 token ----------
const url = `${cfg.base}${loginPath.startsWith('/') ? '' : '/'}${loginPath}`;
const raw = await post(url, loginBody);
if (raw === null) process.exit(0);

const token = extractToken(raw);
if (!token) {
  say('\n--- 原始响应（未识别到 token）---');
  say(JSON.stringify(raw, null, 2));
  fail('未能从响应中提取 UUMSToken。请用 --verbose 查看，确认字段名后用 --body 自定义请求体重试。');
}

say(`\n✓ 登录成功，UUMSToken：${token.slice(0, 6)}****（长度 ${token.length}）`);

if (flags.has('save')) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ phone, uumsToken: token, obtainedAt: Date.now() }, null, 2));
  say(`✓ 已保存到 ${TOKEN_FILE}`);
}

say('\n接下来可以这样用：');
say(`  export TYG_UUMS_TOKEN='${token}'`);
say('  node direct/open-door.mjs --code <设备号> --number <门号> --household <户号> --mobile ' + phone + ' --verbose');
say('\n或写进 direct/config.json 的 uumsToken 字段，之后只用 --alias 即可。');

// ---------- 从响应里提取 token ----------
function extractToken(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw;
  const keys = [
    o.uumsToken, o.UUMSToken, o.uumstoken, o.token,
    o.data?.uumsToken, o.data?.UUMSToken, o.data?.token, o.data?.uums_token,
    o.body?.uumsToken, o.body?.token,
    o.result?.uumsToken, o.result?.token,
    o.userInfo?.uumsToken, o.userInfo?.token,
  ];
  for (const v of keys) {
    if (typeof v === 'string' && v.trim() !== '' && v.trim().length >= 8) return v.trim();
  }
  // 兜底：data 下任何 key 含 token 的字符串（排除明显是状态码的短值）
  for (const [k, v] of Object.entries(o.data ?? {})) {
    if (/token/i.test(k) && typeof v === 'string' && v.trim().length >= 8) return v.trim();
  }
  return undefined;
}
