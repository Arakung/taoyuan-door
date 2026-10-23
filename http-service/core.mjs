/**
 * 桃园谷开门核心链路（零依赖，Node 22+）
 *
 * 实测通过的顺序：
 *   1. POST {UUMS}/servlet/userLoginServlet               加盐MD5头 → UUMSToken
 *   2. POST {CPS}/servlet/queryOpenHouseholdList/v2       header.token = UUMSToken → 房产 + householdToken
 *   3. WSS  {WSS}?token=<householdToken>                  房间级 token 才握手成功
 *   4. 发 MobileDownloadConfig                            → 门口机 Code / Number
 *   5. 发 OpenDoor                                        → {"code":"0","data":"开门成功"}
 *
 * 被 taoyuan.mjs（命令行）和 serve.mjs（HTTP 服务）共用。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));

export const UUMS = 'https://uums.taoyuangu.com:8443/uums';
export const CPS = 'https://sso.taoyuangu.com/cpsApi';
export const WSS = 'wss://sso.taoyuangu.com/htmlvdcs/wsserver/websocket';
const SALT = 'EA3vWPmfxhWUit2s';

export const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const pad = (n) => String(n).padStart(2, '0');
export const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

/* ---------------- 配置 ---------------- */

export function loadConfig(file = process.env.TYG_CONFIG || path.join(HERE, 'config.json')) {
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const cfg = {
    phone: process.env.TYG_PHONE ?? raw.phone ?? '',
    password: process.env.TYG_PASSWORD ?? raw.password ?? '',
    deviceUniqueId: raw.deviceUniqueId ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    clientCode: raw.clientCode ?? '1',
    // HTTP 服务
    port: Number(process.env.PORT ?? raw.port ?? 8787),
    host: process.env.HOST ?? raw.host ?? '0.0.0.0',
    accessKey: process.env.TYG_ACCESS_KEY ?? raw.accessKey ?? '',
    // 默认开哪把门：房间序号（1 起）/ 门序号或名称片段
    defaultRoom: Number(raw.defaultRoom ?? 1),
    defaultDoor: raw.defaultDoor ?? '1',
  };
  return cfg;
}

/* ---------------- 单步调用 ---------------- */

async function post(url, header, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ header, body }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, httpStatus: r.status };
  }
}

export async function login(cfg) {
  if (!cfg.phone) throw new Error('缺少手机号：在 direct/config.json 填 phone');
  if (!cfg.password) throw new Error('缺少密码：在 direct/config.json 填 password');
  const h = stamp();
  const res = await post(
    `${UUMS}/servlet/userLoginServlet`,
    { token: md5(SALT + h), time_stamp: h },
    {
      account: cfg.phone,
      password: cfg.password,
      deviceUniqueId: cfg.deviceUniqueId,
      clientCode: cfg.clientCode,
      lastLoginOs: 'android',
      lastLoginDeviceToken: '',
      changeDeviceValidate: '',
      changeDeviceSmsCode: '',
    },
  );
  if (!res.token) throw new Error(`登录失败：${res.reason || JSON.stringify(res).slice(0, 200)}`);
  return { token: res.token, userAccount: res.userAccount };
}

export async function households(uumsToken) {
  const res = await post(
    `${CPS}/servlet/queryOpenHouseholdList/v2`,
    { token: uumsToken, time_stamp: stamp() },
    { type: '1', openCode: '' },
  );
  if (res.code !== 0) throw new Error(`查询房产失败：${res.message}（code=${res.code}）`);
  const rooms = [];
  for (const area of res.data?.areaList ?? []) {
    for (const it of area.list ?? []) {
      if (it.valid === 0) continue;
      rooms.push({
        areaName: area.areaName,
        organizationSeq: area.organizationSeq,
        address: it.householdAddress,
        householdSerial: it.householdSerial,
        householdToken: it.token,
        mobile: it.mobile,
      });
    }
  }
  if (!rooms.length) throw new Error('该账号下没有有效的房产/门禁权限');
  return rooms;
}

export function connectWss(token, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSS}?token=${token}`);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('WSS 连接超时'));
    }, timeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WSS 握手失败（凭证可能已失效）'));
    };
  });
}

/** 发一条消息并按 msgType 等回执 */
export function ask(ws, msgType, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (data.msgType !== msgType) return; // 心跳/其它消息直接忽略
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      resolve(data);
    };
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error(`${msgType} 等待回执超时`));
    }, timeoutMs);
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify(payload()));
  });
}

export async function fetchDoors(ws, room, mobile) {
  const res = await ask(ws, 'MobileDownloadConfig', () => ({
    header: { msgType: 'MobileDownloadConfig', time_stamp: stamp(), token: room.householdToken },
    body: { mobile: room.mobile ?? mobile, organizationSeq: room.organizationSeq },
  }));
  const dc = res.data?.DOOR_CONTROL ?? {};
  const out = [];
  for (const g of dc.DOOR_GROUP_LIST ?? []) for (const d of g.LockList ?? []) out.push(d);
  for (const d of dc.NO_GROUP_LIST ?? []) out.push(d);
  return out.map((d) => ({
    code: d.Code,
    number: d.Lock?.Number ?? '0',
    name: d.Lock?.Name ?? '',
    areaSerial: d.AreaSerial,
  }));
}

export async function sendOpenDoor(ws, room, door, mobile) {
  const res = await ask(ws, 'OpenDoor', () => ({
    header: { msgType: 'OpenDoor', time_stamp: stamp(), token: room.householdToken },
    body: {
      clientType: '2',
      code: door.code,
      householdSerial: room.householdSerial,
      mobile: room.mobile ?? mobile,
      number: door.number,
    },
  }));
  // 注意：服务端限流时依然回 code:"0"，真正的结果在 data 文本里
  //   {"code":"0","data":"操作太频繁啦，请耐心等待3秒后再操作"}
  const msg = String(res.data ?? '');
  const ok = String(res.code) === '0' && (msg === '' || msg.includes('成功'));
  return { ok, data: msg || (ok ? '开门成功' : '未知结果'), code: res.code, raw: res };
}

/* ---------------- 带缓存与串行化的会话 ---------------- */

const UUMS_TTL = 10 * 60_000;    // UUMSToken 复用 10 分钟
const ROOMS_TTL = 10 * 60_000;   // 房产列表（含房间级 token）与 UUMSToken 同寿，不能比它活得久
const LOGIN_COOLDOWN = 5 * 60_000; // 密码错误后冷却，避免连续失败触发账号风控
const SESS_IDLE = 3 * 60_000;    // WSS 空闲 3 分钟自动断开。
                                 // 实测服务端也是约 3 分钟空闲就自己断，调大本地值并不会多活——
                                 // 别再试了，断线由 ws close 事件回收，开门时自动重连

export class Taoyuan {
  constructor(cfg, log = () => {}) {
    this.cfg = cfg;
    this.log = log;
    this._uums = null;
    this._uumsAt = 0;
    this._loginFailAt = 0;
    this._rooms = null;
    this._roomsAt = 0;
    this._sessions = new Map(); // roomIndex -> { ws, room, doors, idleAt }
    this._lastOpen = new Map(); // "room:code" -> 时间戳，用于吃掉 3 秒内的重复触发
    this._chain = Promise.resolve();
  }

  /** 串行执行：同一时刻只跑一个请求，避免多条指令在同一 WSS 上抢消息 */
  run(fn) {
    const p = this._chain.then(fn, fn);
    this._chain = p.then(() => {}, () => {});
    return p;
  }

  async uumsToken(force = false) {
    if (!force && this._uums && Date.now() - this._uumsAt < UUMS_TTL) return this._uums;

    // 密码/账号类失败后冷却，避免「密码改了但没更新配置」导致每次开门都去试一次、把账号试锁
    if (this._loginFailAt && Date.now() - this._loginFailAt < LOGIN_COOLDOWN) {
      const left = Math.ceil((LOGIN_COOLDOWN - (Date.now() - this._loginFailAt)) / 1000);
      throw new Error(
        `登录已被服务端拒绝，冷却中（还剩 ${left}s）。请检查 config.json 里的 phone/password 是否已变更`
      );
    }

    let res;
    try {
      res = await login(this.cfg);
    } catch (err) {
      // 只有「服务端明确拒绝」才计冷却；断网/超时不惩罚，否则网络一抖就锁死 5 分钟
      if (String(err.message).startsWith('登录失败')) this._loginFailAt = Date.now();
      throw err;
    }
    this._loginFailAt = 0;
    this._uums = res.token;
    this._uumsAt = Date.now();
    // 房间级 token 是随登录会话下发的：换了 UUMSToken，旧房产里的 householdToken 必然失效。
    // 不清掉的话，接下来会拿死 token 去握 WSS → 握手失败 → 整条链路重来一遍，
    // 单次开门从 700ms 翻倍到 1500ms（实测过的坑）。
    this._rooms = null;
    this._roomsAt = 0;
    this.log(`登录成功 userAccount=${res.userAccount}`);
    return res.token;
  }

  async rooms(force = false) {
    const stale = !this._rooms || Date.now() - this._roomsAt > ROOMS_TTL;
    if (!force && !stale) return this._rooms;

    // 「强制刷新房产」不等于「强制重新登录」：token 还新鲜时重登纯属浪费 300ms，
    // 真过期了下面对 households 的 catch 会强制重登兜底。
    const token = await this.uumsToken(false);
    try {
      this._rooms = await households(token);
    } catch (err) {
      // token 可能过期，强制刷新后重试一次
      const fresh = await this.uumsToken(true);
      this._rooms = await households(fresh);
    }
    this._roomsAt = Date.now();
    return this._rooms;
  }

  pickRoom(rooms, idx) {
    const i = Number(idx ?? this.cfg.defaultRoom) - 1;
    return rooms[i] ?? rooms[0];
  }

  async session(roomIdx) {
    const key = String(roomIdx ?? this.cfg.defaultRoom);
    const cached = this._sessions.get(key);
    if (cached && cached.ws.readyState === 1 && Date.now() < cached.idleAt) {
      cached.idleAt = Date.now() + SESS_IDLE;
      return cached;
    }
    if (cached) this.closeSession(key);

    const rooms = await this.rooms();
    let room = this.pickRoom(rooms, roomIdx);
    let ws;
    try {
      ws = await connectWss(room.householdToken);
    } catch (err) {
      // 房间级 token 是随登录会话下发的，放久了/换会话后会失效（表现为握手 200 而非 101）。
      // 这里强制重新登录 + 重查房产，再握一次；不这样做就只能重启进程，属于必须人工维护的坑。
      this.log(`WSS 握手失败（${err.message}），刷新会话后重试`);
      const fresh = await this.rooms(true);
      room = this.pickRoom(fresh, roomIdx);
      ws = await connectWss(room.householdToken);
    }
    const sess = { ws, room, doors: [], idleAt: Date.now() + SESS_IDLE };
    ws.addEventListener('close', () => {
      if (this._sessions.get(key) === sess) this._sessions.delete(key);
    });
    this._sessions.set(key, sess);
    sess.doors = await fetchDoors(ws, room, this.cfg.phone);
    this.log(`WSS 就绪 room=${room.address} doors=${sess.doors.length}`);
    return sess;
  }

  closeSession(key) {
    const s = this._sessions.get(key);
    if (!s) return;
    this._sessions.delete(key);
    try { s.ws.close(); } catch {}
  }

  closeAll() {
    for (const k of [...this._sessions.keys()]) this.closeSession(k);
  }

  async listDoors(roomIdx) {
    return this.run(async () => {
      const rooms = await this.rooms();
      const room = this.pickRoom(rooms, roomIdx);
      const sess = await this.session(roomIdx);
      return {
        room: { address: room.address, householdSerial: room.householdSerial },
        doors: sess.doors.map((d, i) => ({ index: i + 1, name: d.name, number: d.number, code: d.code })),
      };
    });
  }

  /**
   * 开门。
   * @param {{door?: string, room?: number, dryRun?: boolean}} opts
   *   door 支持序号（"1"）或名称片段（"2号"）
   */
  async open(opts = {}) {
    return this.run(async () => {
      const t0 = Date.now();
      const roomIdx = opts.room ?? this.cfg.defaultRoom;
      const sel = String(opts.door ?? this.cfg.defaultDoor);
      let sess = await this.session(roomIdx);

      let doors = sess.doors;
      let door = /^\d+$/.test(sel)
        ? doors[Number(sel) - 1]
        : doors.find((d) => d.name.includes(sel));
      if (!door) {
        throw new Error(`找不到门「${sel}」，可用：${doors.map((d, i) => `${i + 1}.${d.name}`).join(' / ')}`);
      }

      if (opts.dryRun) {
        return { ok: true, dryRun: true, door: door.name, code: door.code, number: door.number, ms: Date.now() - t0 };
      }

      // 服务端 3 秒内重复开门会回「操作太频繁」，本地先吃掉，避免手抖连点
      const guardKey = `${roomIdx}:${door.code}`;
      const lastAt = this._lastOpen.get(guardKey) ?? 0;
      if (Date.now() - lastAt < 3000) {
        return {
          ok: true,
          door: door.name,
          code: door.code,
          number: door.number,
          data: '刚刚已开（3 秒内重复触发已忽略）',
          deduped: true,
          ms: Date.now() - t0,
        };
      }

      // 连接可能已被服务端掐断，重连一次
      if (sess.ws.readyState !== 1) {
        this.closeSession(String(roomIdx));
        sess = await this.session(roomIdx);
        doors = sess.doors;
        door = /^\d+$/.test(sel) ? doors[Number(sel) - 1] : doors.find((d) => d.name.includes(sel));
      }

      let r;
      try {
        r = await sendOpenDoor(sess.ws, sess.room, door, this.cfg.phone);
      } catch (err) {
        this.closeSession(String(roomIdx));
        sess = await this.session(roomIdx);
        const d2 = /^\d+$/.test(sel) ? sess.doors[Number(sel) - 1] : sess.doors.find((d) => d.name.includes(sel));
        if (!d2) throw err;
        r = await sendOpenDoor(sess.ws, sess.room, d2, this.cfg.phone);
        door = d2;
      }

      sess.idleAt = Date.now() + SESS_IDLE;
      if (r.ok) this._lastOpen.set(guardKey, Date.now());
      return { ok: r.ok, door: door.name, code: door.code, number: door.number, data: r.data, ms: Date.now() - t0 };
    });
  }
}
