#!/usr/bin/env node
/**
 * 桃园谷 · 一键开门（命令行，零依赖单文件入口，Node 22+）
 *
 * 用法：
 *   node direct/taoyuan.mjs doors            列出房产与门口机
 *   node direct/taoyuan.mjs open             开默认门
 *   node direct/taoyuan.mjs open --door 2    开第 2 个门口机
 *   node direct/taoyuan.mjs open --dry-run   只拉到设备列表，不发开门指令
 *   node direct/taoyuan.mjs token            只登录并打印 UUMSToken
 *
 * 凭据：direct/config.json（{ "phone": "...", "password": "..." }），或环境变量 TYG_PHONE / TYG_PASSWORD
 * 想更省事：node direct/serve.mjs  然后用手机快捷指令调 HTTP 端点
 */
import { loadConfig, Taoyuan, login } from './core.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'open';
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const die = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

const cfg = loadConfig();
if (!cfg.phone) die('缺少手机号：在 direct/config.json 填 phone，或设 TYG_PHONE');

const svc = new Taoyuan(cfg, (m) => console.log(`  ${m}`));

try {
  if (cmd === 'token') {
    const { token, userAccount } = await login(cfg);
    console.log(`✓ userAccount=${userAccount}\n  UUMSToken=${token}`);
    process.exit(0);
  }

  if (cmd === 'doors') {
    const rooms = await svc.rooms(true);
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      console.log(`\n【${i + 1}】${r.areaName} · ${r.address}`);
      console.log(`    householdSerial=${r.householdSerial}`);
      const { doors } = await svc.listDoors(i + 1);
      doors.forEach((d) => console.log(`    ${d.index}. ${d.name}  number=${d.number}`));
    }
    svc.closeAll();
    process.exit(0);
  }

  if (cmd !== 'open') die(`未知命令：${cmd}（可用：doors / open / token）`);

  const r = await svc.open({
    door: opt('door', cfg.defaultDoor),
    room: Number(opt('room', cfg.defaultRoom)),
    dryRun: flag('dry-run'),
  });
  if (r.dryRun) {
    console.log(`\n[--dry-run] 将发送 OpenDoor → ${r.door}  code=${r.code} number=${r.number}`);
  } else {
    console.log(
      r.deduped
        ? `• 刚刚已开过（3 秒内重复触发已忽略）：${r.door}`
        : r.ok
          ? `✓ 开门成功：${r.door}（${r.ms}ms）`
          : `✗ 开门失败：${r.data}（code=${r.code ?? '?'}）`
    );
  }
  svc.closeAll();
  process.exit(r.ok ? 0 : 1);
} catch (err) {
  svc.closeAll();
  die(err.message);
}
