"""
桃园谷 (taoyuan.apk) 门禁开门客户端与自动化开门脚本（纯 Python 零依赖实现）
严格对齐经过实机打通验证的真实协议链路（Node.js / WorkBuddy 项目成果）：

核心实测链路:
    1. POST https://uums.taoyuangu.com:8443/uums/servlet/userLoginServlet
       （加盐 MD5 头，body 需包含 deviceUniqueId 与 clientCode）➔ 换取 UUMSToken
    2. POST https://sso.taoyuangu.com/cpsApi/servlet/queryOpenHouseholdList/v2
       （header.token 直接传 UUMSToken）➔ 获取房产列表与房间级 householdToken
    3. WSS wss://sso.taoyuangu.com/htmlvdcs/wsserver/websocket?token=<householdToken>
       （必须是房间级 Token 才能握手成功 101 Switching Protocols）
    4. 发送 MobileDownloadConfig 报文 ➔ 获取门口机硬件序列号 Code / Number
    5. 发送 OpenDoor 报文 ➔ 门禁响应开门成功

用法:
    python open_door.py              # 读取 door_config.json 或 direct/config.json 一键开门
    python open_door.py --doors      # 列出名下房产与门禁锁
    python open_door.py --dry-run    # 演练模式（仅拉取设备列表，不发实际开门指令）
    python open_door.py -u 手机号 -p 密码 # 临时指定账号密码
"""

import sys
import os
import json
import time
import struct
import base64
import hashlib
import argparse
from datetime import datetime
from urllib.parse import urlparse
import urllib.request
import ssl

UUMS_URL = "https://uums.taoyuangu.com:8443/uums"
CPS_URL = "https://sso.taoyuangu.com/cpsApi"
WSS_URL = "wss://sso.taoyuangu.com/htmlvdcs/wsserver/websocket"
SALT = "EA3vWPmfxhWUit2s"


def stamp():
    return datetime.now().strftime("%Y%m%d%H%M%S")


def md5(text):
    return hashlib.md5(text.encode('utf-8')).hexdigest()


def http_post(url, header, body, timeout=12):
    payload = {"header": header, "body": body}
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'okhttp/3.14.9'
        }
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def login(phone, password, device_unique_id="a1b2c3d4e5f60718293a4b5c6d7e8f90", client_code="1"):
    ts = stamp()
    header = {"token": md5(SALT + ts), "time_stamp": ts}
    body = {
        "account": str(phone),
        "password": str(password),
        "deviceUniqueId": str(device_unique_id),
        "clientCode": str(client_code),
        "lastLoginOs": "android",
        "lastLoginDeviceToken": "",
        "changeDeviceValidate": "",
        "changeDeviceSmsCode": ""
    }
    res = http_post(f"{UUMS_URL}/servlet/userLoginServlet", header, body)
    if res.get("result") != "0" or not res.get("token"):
        raise RuntimeError(f"登录失败: {res.get('reason') or res}")
    return res.get("token"), res.get("userAccount")


def query_households(uums_token):
    ts = stamp()
    # 注意：根据实测成果，这里的 header.token 必须直接传 UUMSToken
    header = {"token": uums_token, "time_stamp": ts}
    body = {"type": "1", "openCode": ""}
    res = http_post(f"{CPS_URL}/servlet/queryOpenHouseholdList/v2", header, body)
    if res.get("code") != 0 and res.get("result") != "0":
        raise RuntimeError(f"查询房产失败: {res.get('message') or res}")

    rooms = []
    for area in res.get("data", {}).get("areaList", []):
        for item in area.get("list", []):
            if item.get("valid") == 0:
                continue
            rooms.append({
                "areaName": area.get("areaName"),
                "organizationSeq": area.get("organizationSeq"),
                "address": item.get("householdAddress"),
                "householdSerial": item.get("householdSerial"),
                "householdToken": item.get("token"),
                "mobile": item.get("mobile")
            })
    if not rooms:
        raise RuntimeError("该账号下没有有效的房产门禁权限")
    return rooms


class WebSocketSession:
    def __init__(self, token):
        self.url = f"{WSS_URL}?token={token}"
        parsed = urlparse(self.url)
        self.host = parsed.hostname
        self.port = parsed.port or 443
        self.path = parsed.path + ('?' + parsed.query if parsed.query else '')
        self.sock = None

    def connect(self, timeout=8):
        import socket
        raw_sock = socket.create_connection((self.host, self.port), timeout=timeout)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        self.sock = ctx.wrap_socket(raw_sock, server_hostname=self.host)

        sec_key = base64.b64encode(os.urandom(16)).decode('ascii')
        headers = [
            f"GET {self.path} HTTP/1.1",
            f"Host: {self.host}",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {sec_key}",
            "Sec-WebSocket-Version: 13",
            "User-Agent: okhttp/3.14.9",
            "\r\n"
        ]
        self.sock.sendall("\r\n".join(headers).encode('utf-8'))

        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WSS 握手失败: 服务端关闭连接")
            resp += chunk

        first_line = resp.split(b"\r\n")[0].decode('latin-1', 'replace')
        if " 101 " not in first_line:
            raise ConnectionError(f"WSS 握手被拒: {first_line}")

    def send_text(self, text):
        payload = text.encode('utf-8')
        length = len(payload)
        mask = os.urandom(4)

        if length <= 125:
            header = bytes([0x81, 0x80 | length])
        elif length <= 65535:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, length)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, length)

        masked = bytearray(length)
        for i in range(length):
            masked[i] = payload[i] ^ mask[i % 4]
        self.sock.sendall(header + mask + bytes(masked))

    def recv_msg(self, timeout=6):
        self.sock.settimeout(timeout)
        head = self.sock.recv(2)
        if len(head) < 2:
            return None
        b1, b2 = head[0], head[1]
        length = b2 & 0x7f
        if length == 126:
            length = struct.unpack("!H", self.sock.recv(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.sock.recv(8))[0]

        has_mask = (b2 & 0x80) != 0
        mask = self.sock.recv(4) if has_mask else None
        data = bytearray()
        while len(data) < length:
            chunk = self.sock.recv(length - len(data))
            if not chunk:
                break
            data.extend(chunk)

        if has_mask:
            for i in range(len(data)):
                data[i] ^= mask[i % 4]

        try:
            return json.loads(data.decode('utf-8', 'replace'))
        except Exception:
            return None

    def ask(self, msg_type, payload, timeout=6):
        self.send_text(json.dumps(payload, ensure_ascii=False))
        start = time.time()
        while time.time() - start < timeout:
            msg = self.recv_msg(timeout=timeout)
            if msg and msg.get("msgType") == msg_type:
                return msg
        raise TimeoutError(f"等待 {msg_type} 回执超时")

    def close(self):
        if self.sock:
            try:
                self.sock.sendall(b'\x88\x80\x00\x00\x00\x00')
                self.sock.close()
            except Exception:
                pass


def fetch_doors(ws, room, mobile):
    payload = {
        "header": {"msgType": "MobileDownloadConfig", "time_stamp": stamp(), "token": room["householdToken"]},
        "body": {"mobile": room.get("mobile") or mobile, "organizationSeq": room["organizationSeq"]}
    }
    res = ws.ask("MobileDownloadConfig", payload)
    dc = res.get("data", {}).get("DOOR_CONTROL", {})
    raw_list = []
    for g in dc.get("DOOR_GROUP_LIST", []):
        for d in g.get("LockList", []):
            raw_list.append(d)
    for d in dc.get("NO_GROUP_LIST", []):
        raw_list.append(d)

    doors = []
    for d in raw_list:
        lock = d.get("Lock") or {}
        doors.append({
            "code": d.get("Code"),
            "number": lock.get("Number", "0"),
            "name": lock.get("Name", "门禁")
        })
    return doors


def send_open_door(ws, room, door, mobile):
    payload = {
        "header": {"msgType": "OpenDoor", "time_stamp": stamp(), "token": room["householdToken"]},
        "body": {
            "clientType": "2",
            "code": door["code"],
            "householdSerial": room["householdSerial"],
            "mobile": room.get("mobile") or mobile,
            "number": door["number"]
        }
    }
    res = ws.ask("OpenDoor", payload)
    msg = str(res.get("data", ""))
    code = str(res.get("code", ""))
    ok = (code == "0") and (msg == "" or "成功" in msg)
    return ok, msg or ("开门成功" if ok else "未知结果"), res


def load_config():
    # 统一使用与脚本同级的 door_config.json 作为唯一主配置文件
    if os.path.exists('door_config.json'):
        with open('door_config.json', 'r', encoding='utf-8') as f:
            return json.load(f), 'door_config.json'
    for fallback in ['http-service/config.json', 'direct/config.json']:
        if os.path.exists(fallback):
            with open(fallback, 'r', encoding='utf-8') as f:
                return json.load(f), fallback
    return {}, None


def main():
    parser = argparse.ArgumentParser(description="桃园谷一键开门客户端")
    parser.add_argument("--phone", "-u", help="手机号")
    parser.add_argument("--password", "-p", help="登录密码")
    parser.add_argument("--doors", action="store_true", help="列出名下房产与门口机")
    parser.add_argument("--dry-run", action="store_true", help="演练模式，不发送实际开锁指令")
    parser.add_argument("--door", default="1", help="开第几个门口机 (默认 1)")
    args = parser.parse_args()

    cfg, cfg_file = load_config()
    phone = args.phone or cfg.get("phone") or cfg.get("target", {}).get("mobile")
    password = args.password or cfg.get("password") or cfg.get("auth", {}).get("password")

    if not phone or not password:
        print("错误: 缺少账号或密码！请直接在 door_config.json 中配置，或通过 -u/-p 指定。")
        sys.exit(1)

    print(f"[*] 登录账号 {phone}...")
    token, user_account = login(phone, password)
    print(f"[+] 登录成功 userAccount={user_account}")

    rooms = query_households(token)
    room = rooms[0]
    print(f"[+] 发现房产: {room['areaName']} · {room['address']} (户号: {room['householdSerial']})")

    print("[*] 正在建立 WSS 长连接...")
    ws = WebSocketSession(room["householdToken"])
    ws.connect()
    print("[+] WSS 握手成功 (101 Switching Protocols)")

    try:
        doors = fetch_doors(ws, room, phone)
        if not doors:
            print("[-] 未发现可用的门口机设备")
            return

        if args.doors:
            print("\n【门口机设备列表】")
            for idx, d in enumerate(doors):
                print(f"  [{idx + 1}] {d['name']} (Code: {d['code']}, Number: {d['number']})")
            return

        # 选择门禁
        door_idx = 0
        if str(args.door).isdigit() and 1 <= int(args.door) <= len(doors):
            door_idx = int(args.door) - 1
        target_door = doors[door_idx]

        if args.dry_run:
            print(f"\n[--dry-run 演练模式] 将向门口机下发指令: {target_door['name']} (Code: {target_door['code']}, Number: {target_door['number']})")
            return

        print(f"\n[*] 正在下发 OpenDoor 指令 ➔ {target_door['name']}...")
        ok, msg, raw = send_open_door(ws, room, target_door, phone)
        if ok:
            print(f"[✓] 开门成功: {target_door['name']} ({msg})")
        else:
            print(f"[✗] 开门失败: {msg} (返回码: {raw.get('code')})")

    finally:
        ws.close()


if __name__ == '__main__':
    main()
