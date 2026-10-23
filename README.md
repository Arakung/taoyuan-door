# 桃园谷 (taoyuan) 门禁开门协议逆向与实现

本项目针对**“桃园谷” Android 客户端（包名：`com.tyg.tygsmart`）**进行了完整的静态逆向与网络协议分析，提取了其门禁开门鉴权签名算法，并基于纯 Python 实现了自动化的开门客户端与配套轻量级 DEX 逆向分析工具链。

---

## 🚪 开门核心机制与协议流程

通过对客户端核心业务包（`com.tyg.vdoor.*`）的逆向分析，确认该系统的开门指令并非通过短连接 HTTP 请求，而是通过 **WebSocket (WSS) 实时长连接**向网关推送加密锁控指令。

### 1. 通信时序流程
```text
[ 客户端 ]                                            [ 桃园谷网关 ]
    |                                                      |
    |---- 1. 生成鉴权 Token: MD5(Salt + yyyyMMddHHmmss) ----->|
    |                                                      |
    |---- 2. 发起 WSS 连接: /wsserver/websocket?token=... --->|
    |                                                      |
    |---- 3. 下发 OpenDoor JSON 指令报文 ------------------>|
    |                                                      |
    |<--- 4. 返回开锁执行状态响应 --------------------------|
```

### 2. 鉴权 Token 签名算法
位于客户端类 `com.tyg.tygsmart.network.body.ReqBody$InnerBody$Header`：
- **固定加盐密钥 (Salt)**：`EA3vWPmfxhWUit2s`
- **签名算法**：
  $$\text{Token} = \text{MD5}(\text{Salt} + \text{yyyyMMddHHmmss})$$

### 3. 开门请求报文结构 (`OpenDoorBean`)
```json
{
  "header": {
    "msgType": "OpenDoor",
    "token": "<生成的MD5签名Token>",
    "time_stamp": "yyyyMMddHHmmss"
  },
  "body": {
    "code": "<目标门禁设备硬件序列号>",
    "mobile": "<业主注册手机号>",
    "clientType": "2",
    "householdSerial": "<业主房产/户号唯一编码>",
    "number": "<门控锁编号，如大门为1>"
  }
}
```

---

## ⚡ 快速使用：开门客户端 (`open_door.py`)

脚本基于 Python 标准库编写，**零第三方依赖**（内置原生 HTTP/REST 调用与 WebSocket RFC 6455 协议实现）。

### 1. 配置账号密码
复制示例配置文件并填入自己的手机号与密码：
```bash
cp door_config.example.json door_config.json
```
编辑 `door_config.json`：
```json
{
  "phone": "你的手机号",
  "password": "你的登录密码"
}
```

### 2. 日常一键开门
直接运行脚本，会自动登录、获取房产与门口机并发送开门指令：
```bash
python open_door.py
```

### 3. 查看名下房产与门口机
```bash
python open_door.py --doors
```

### 4. 演练模式（仅拉取设备，不发开门指令）
```bash
python open_door.py --dry-run
```

### 5. 命令行临时指定参数
```bash
# 临时指定账号密码
python open_door.py -u 13800138000 -p 你的密码

# 指定开第 2 个门口机
python open_door.py --door 2
```


---

## 🌐 进阶：HTTP 常驻服务与智能家居 / 快捷指令接入 (`http-service/`)

除了单文件 Python 脚本外，本项目还在 `http-service/` 目录下提供了基于 **Node.js (Node 22+)** 的轻量级微服务，适合部署在 NAS、服务器或软路由上常驻运行。

### 1. 功能特性
- **📱 手机桌面一键开门 Web App**：直接访问 `http://<IP>:8787`，提供原生质感的大按钮交互页面，可「添加到主屏幕」当独立 App 图标使用。
- **🔌 极简 HTTP API**：供 **iOS 快捷指令 (Shortcuts)**、**Home Assistant**、**Android HTTP Shortcuts** 或 **Siri** 调用。
  - `GET /open`：一键开启默认门口机
  - `GET /open/2`：开启指定的第 2 个门口机
  - `GET /doors`：列出名下所有房产与门口机
  - `GET /health`：服务健康检查
- **🔒 访问控制**：支持 `accessKey` 口令认证（如 `GET /open?k=你的口令`）。
- **🐳 全套部署支持**：内置 `Dockerfile`、`docker-compose.yml`、威联通 QNAP 容器配置以及 Linux `systemd` 系统守护进程脚本。

### 2. 快速启动
```bash
# 进入 http-service 目录
cd http-service

# 复制配置文件模板并填入账号密码
cp config.example.json config.json

# 启动 HTTP 服务（默认端口 8787）
node serve.mjs
```

---

## 📂 项目结构说明

```text
├── open_door.py                  # 核心：基于逆向协议实现的 Python 开门客户端（零依赖）
├── door_config.example.json      # Python 客户端账号配置模板
├── cfg.example.json              # 逆向还原出的系统服务端配置示例（脱敏）
├── taoyuan_apk_analysis_report.md# 完整逆向分析报告（86个API接口/签名机制/架构）
│
├── http-service/                 # 进阶：Node.js HTTP 服务与常驻部署套件
│   ├── serve.mjs                 # 核心 HTTP API 服务与手机端一键开门 Web App
│   ├── core.mjs                  # Node.js 协议核心底层实现
│   ├── open-door.mjs             # Node.js 版命令行开门脚本
│   ├── config.example.json       # Node.js 服务配置模板
│   └── deploy/                   # 容器与常驻部署方案 (Docker, systemd, QNAP)
│
├── cls.py                        # 辅助工具：多 DEX 快速检索类结构
├── callers.py                    # 辅助工具：方法调用链与交叉引用搜索
├── dexclass.py                   # 辅助工具：轻量级 DEX 解析器
├── dexdis.py                     # 辅助工具：Dalvik 字节码反汇编器
├── dexfind.py                    # 辅助工具：方法名快速检索
├── dexscan.py                    # 辅助工具：字符串引用扫描
├── dexstrings.py                 # 辅助工具：DEX 字符串批量提取
├── dumpall.py                    # 辅助工具：全局唯一字符串提取
└── strfind.py                    # 辅助工具：跨 DEX 字符串正则检索
```

---

## 🔍 配套 DEX 逆向分析工具链

项目内附带了在逆向过程中用于定位门禁类的 Python 工具集，无需安装大型逆向套件即可快速分析：

```bash
# 跨所有 DEX 快速定位门禁长连接类
python cls.py TygWebSocketManager --deep

# 检索哪些业务逻辑调用了 openDoor 方法
python callers.py dex/classes4.dex openDoor

# 反汇编特定类的开门处理指令
python dexdis.py dex/classes4.dex TygWebSocketManager sendMessage
```

---

## 📑 详细分析报告
完整的 APK 架构与接口清单请查阅：  
👉 [桃园谷静态逆向与接口分析报告](taoyuan_apk_analysis_report.md)

- 包含 86 个第一方 Retrofit 接口路径（人脸录入、门禁授权、账单缴费等）
- WebRTC 双向视频对讲架构与 SIP 端口说明
- 签名证书与安全加固检测详情

---

## ⚠️ 免责声明 (Disclaimer)
本项目仅供安全研究、协议分析与个人智能家居自动化接入（如 Home Assistant 集成）学习交流使用。请勿用于未授权的未成年人/非本人房产的门禁系统渗透测试或非法用途。使用者需自行承担因违规使用造成的相关责任。
