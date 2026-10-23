# 桃园谷 (taoyuan.apk) 静态逆向与接口分析报告

---

## 一、 APK 基础信息与构建属性

| 属性项 | 详细信息 |
| :--- | :--- |
| **应用名称** | 桃园谷 |
| **应用包名** | `com.tyg.tygsmart` |
| **版本名称 (versionName)** | `V1.3.10` |
| **内部版本号 (versionCode)** | `20000` |
| **文件大小** | 55,447,598 字节（约 52.88 MB） |
| **文件 SHA-256** | `57e702cc16ab13c49f08cc0a7600c757c198f31733d103ba0449c18f60d969cd` |
| **Min SDK** | 24 (Android 7.0) |
| **Target SDK** | 31 (Android 12) |
| **Compile SDK** | 31 (Android 12) |
| **构建工具** | Android Gradle Plugin `7.1.0` |
| **Application 入口** | `com.tyg.tygsmart.MerchantApp` |
| **启动 Activity (Launcher)** | `com.tyg.tygsmart.ui.SynopsisActivity`（开屏/引导页） |
| **主 Activity** | `com.tyg.tygsmart.ui.MainActivity` |

---

## 二、 加固、混淆与数字签名

### 1. 加固检测
- **加固状态**：**未加固（原壳）**。
- 未检测到 360 加固、腾讯乐固、爱加密、梆梆、阿里聚安全、网易易盾等第三方加固壳特征，代码以 5 个标准 DEX 文件的形式组织存储。

### 2. 混淆情况
- **资源混淆**：应用启用了类似 AndResGuard 的资源扁平化压缩与混淆，资源文件名被重命名为 `res/-0.xml`、`res/05.xml` 等短路径。
- **代码混淆**：Java 核心业务类（`com.tyg.tygsmart.ui.*`、`com.tyg.tygsmart.network.*`、`com.tyg.vdoor.*`）保留了完整包名与可读的类名、方法名，未进行高强度 Proguard/R8 混淆。

### 3. 签名证书 (APK Signature Scheme)
- **签名方案**：采用 **APK Signature Scheme v2** 纯签名模式（无 v1 兼容签名文件）。
- **证书所有者 (Subject) / 颁发者 (Issuer)**：
  - `CN=taoyuangu`
  - `OU=www.lxj.taoyuangu.com`
  - `O=www.lxj.taoyuangu.com`
  - `L=GuangZhou`
  - `S=GuangDong`
  - `C=CN`
- **有效期**：2024-04-02 12:49 至 2124-03-09 12:49（100 年长效证书）
- **公钥算法**：RSA 1024 bits, sha1RSA
- **证书指纹**：
  - **SHA-256**：`ca94ba5e85f8f065c1afbe14265442d0ffffe6f4e8a0f2368097e6e2e6ea758f`
  - **SHA-1**：`99cb27c0244ab7cd231da69b38d792b8ea046b18`
  - **MD5**：`39fea8dfd46cc2f5ae6287b3f3d8b942`

---

## 三、 代码规模与 Native 共享库

### 1. DEX 规模指标
- **总类数**：34,323 个类
- **总方法数**：271,127 个方法
- **分包统计**：
  - `classes.dex`：8,034 类，65,529 方法，8,282,472 字节
  - `classes2.dex`：8,222 类，65,533 方法，7,937,744 字节
  - `classes3.dex`：8,362 类，65,535 方法，8,768,260 字节
  - `classes4.dex`：8,679 类，65,523 方法，8,768,956 字节
  - `classes5.dex`：1,026 类，9,007 方法，1,034,292 字节

### 2. Native 架构与支持 ABI
支持 ABI：`arm64-v8a`、`armeabi-v7a`。主要 Native 共享库说明：

| 库名称 | 功能定位 |
| :--- | :--- |
| `libjingle_peerconnection_so.so` | Google WebRTC 引擎，实现门禁双向音视频通话与实时监控传输 |
| `libhlsip.so`、`libmplayer.so`、`libttmplayer_lite.so`、`libavmdl_lite.so` | 流媒体播放、HLS 视频解码与多媒体下载缓存 |
| `libpanglearmor.so`、`libpangleflipped.so`、`libPglbizssdk_ml.so` | 穿山甲（Pangle）广告安全加固与机器学习算法模型 |
| `libwmAliAgainstId.so` | 阿里安全/汪麦联运防作弊设备指纹组件 |
| `liboctopus.so`、`libBZDevInfo.so` | Octopus 移动风控感知与设备软硬件环境信息采集 |
| `libtobEmbedEncrypt.so` | 字节跳动火山引擎客户端数据加密库 |
| `libtt_ugen_layout.so` | 字节跳动动态卡片模板排版渲染引擎 |

---

## 四、 第三方集成组件与 SDK 清单

1. **广告变现矩阵**：
   - 字节跳动穿山甲 SDK (`com.bytedance.sdk.openadsdk`)
   - 腾讯优量汇 / 广点通 SDK (`assets/gdt_plugin/gdtadv2.jar`)
   - 汪麦广告 SDK (`com.wangmai.appsdkdex.*`)
   - ToBid 聚合广告平台 (`com.tyg.tygsmart.ad.tobid`)
   - 拓道 Windmill SDK (`com.windmill.sdk.*`)
2. **推送服务**：
   - 小米推送 MiPush (`com.xiaomi.mipush.*`)
   - 华为推送 HMS Push (`com.tyg.tygsmart.push.service.HwPushService`)
   - 荣耀推送 Honor Push (`com.tyg.tygsmart.push.service.HonorPushService`)
3. **免密一键登录认证**：
   - 中国移动一键认证（CMPassport，`https://msg.cmpassport.com`）
   - 中国联通免密登录认证（Unicom，`https://nisportal.10010.com`）
4. **即时通讯与流媒体协议**：
   - XMPP 协议栈：`org.jivesoftware.smack`，用于门禁呼叫信令分发
   - WebRTC 协议栈：`org.webrtc`，用于音视频门禁通话
   - WebSocket 协议栈：`org.java_websocket`，用于开门与长连接控制
5. **设备指纹与风控**：
   - 移动安全联盟（MSA）统一 OAID 适配库（覆盖主流 Android 厂商）

---

## 五、 Retrofit 接口深度分析

### 1. 业务接口类
整个客户端核心第一方业务接口唯一定义在：
- **接口类**：`com.tyg.tygsmart.network.RxjavaUUMSPost`
- **请求方式**：全部 86 个端点统一采用 `@POST` 注解，接收请求体对象后序列化为 JSON 提交。

### 2. 86 个接口路径分类清单

#### (1) 门禁控制与通行授权 (`/cpsApi/openDoor`)
- `/cpsApi/openDoor/applyOpenDoorList`：申请开门记录列表
- `/cpsApi/openDoor/applyOpenDoorOauth`：门禁权限申请
- `/cpsApi/openDoor/cancelApplyOpenDoor`：取消门禁申请
- `/cpsApi/openDoor/queryApplyOpenDoorStatus`：查询门禁申请审核状态
- `/cpsApi/openDoor/queryDoorBtnDataCache`：查询开门按钮列表及缓存
- `/cpsApi/openDoor/DoorBtnDataCache`：更新开门按钮缓存
- `/cpsApi/openDoor/getAuthcode`：获取开门临时凭证/授权码
- `/cpsApi/openDoor/noticeOpenDoorOauth`：门禁授权通知
- `/cpsApi/openDoor/addFamilyInfo`：新增家庭成员门禁权限
- `/cpsApi/openDoor/editFamilyInfo`：编辑家庭成员门禁权限
- `/cpsApi/openDoor/unBindFamily`：解绑家庭成员
- `/cpsApi/openDoor/queryAllFamily`：查询所有家庭成员
- `/cpsApi/openDoor/validFamilyAuth`：校验家庭授权合法性
- `/cpsApi/openDoor/validAddFamily`：校验是否允许添加家庭成员
- `/cpsApi/openDoor/validMonitorAuth`：校验实时视频监控查看权限
- `/cpsApi/openDoor/validNotDisturbAuth`：校验免打扰设置权限

#### (2) 人脸识别门禁管理 (`/cpsApi/faceInfo`)
- `/cpsApi/faceInfo/addFaceInfo`：录入上传人脸特征信息
- `/cpsApi/faceInfo/editFaceInfo`：修改人脸信息
- `/cpsApi/faceInfo/deleteFaceInfo`：删除人脸数据
- `/cpsApi/faceInfo/faceCheck`：人脸照片合法性检测
- `/cpsApi/faceInfo/faceDetail`：获取人脸详情
- `/cpsApi/faceInfo/faceInfoList`：人脸列表拉取
- `/cpsApi/faceInfo/setFaceValidStatus`：启用/停用人脸门禁状态
- `/cpsApi/faceInfo/validFaceAuth`：人脸录入权限核验

#### (3) 实体 IC 卡门禁 (`/cpsApi/card`)
- `/cpsApi/card/applyCard`：申领门禁卡
- `/cpsApi/card/queryApplyCardRecordList`：申领记录查询
- `/cpsApi/card/queryTygHouseholdList`：门禁卡房产列表查询
- `/cpsApi/card/validApplyCardAuth`：制卡权限校验
- `/cpsApi/vdcs/servlet/issueCardRecordList`：发卡记录列表

#### (4) 用户中心与统一认证 (`/uums/servlet`)
- `/uums/servlet/userLoginServlet`：账号密码登录
- `/uums/servlet/smsUserLogin`：手机号验证码快捷登录
- `/uums/servlet/userLogout`：账号退出登录
- `/uums/servlet/searchUserInfoServlet`：搜索用户信息
- `/uums/servlet/updateUserInfoServlet`：更新个人资料
- `/uums/servlet/closeUserAccountServlet`：账号注销
- `/uums/servlet/getAuthcodeServlet`：获取认证码
- `/uums/servlet/getPicRandomServlet`：获取图形验证码
- `/uums/servlet/getAuthPicRandomServlet`：获取认证图形码
- `/uums/servlet/checkRandomCodeServlet`：校验验证码
- `/uums/servlet/getRandomCodeForSmsLogin`：获取短信登录验证码
- `/uums/servlet/getRandomCodeForChangePhoneServlet`：获取更换手机号验证码
- `/uums/servlet/changeUserPhoneServlet`：更换绑定手机号
- `/uums/servlet/getRandomCodeForChangePwd`：获取修改密码验证码
- `/uums/servlet/checkRandomCodeForChangePwd`：修改密码验证码校验
- `/uums/servlet/setNewPwdForChangePwd`：提交新密码（修改密码）
- `/uums/servlet/checkRandomCodeForFindPwd`：找回密码验证码校验
- `/uums/servlet/setNewPwdForFindPwd`：提交新密码（找回密码）
- `/uums/servlet/getAllConfigsServlet`：拉取全局系统配置

#### (5) 门禁呼叫、免打扰与访客 (`/vdcs_hori`, `/cpsApi/vdcs`, `/cpsApi/user`)
- `/vdcs_hori/servlet/getOpenPassword`：获取门禁临时开门密码
- `/vdcs_hori/servlet/getRandomCode`：获取随机校验码
- `/vdcs_hori/servlet/queryLocalNotDisturb`：查询本地免打扰时间段
- `/vdcs_hori/servlet/setLocalNotDisturb`：设置本地免打扰
- `/vdcs_hori/servlet/delSubAccount`：删除门禁子账号
- `/cpsApi/vdcs/servlet/queryAllPstnList`：查询固话呼叫转接列表
- `/cpsApi/vdcs/servlet/addPstnAllowCall`：新增允许呼叫固话
- `/cpsApi/vdcs/servlet/delPstnAllowCall`：删除允许呼叫固话
- `/cpsApi/vdcs/servlet/setPstnAllowCall`：配置允许呼叫固话
- `/cpsApi/vdcs/servlet/setPstnAliasName`：修改固话别名
- `/cpsApi/vdcs/servlet/queryTygRegion`：查询大区/小区列表
- `/cpsApi/vdcs/servlet/queryTygBuilding`：查询楼栋列表
- `/cpsApi/vdcs/servlet/queryTygUnit`：查询单元列表
- `/cpsApi/vdcs/servlet/queryTygRoom`：查询房号列表
- `/cpsApi/vdcs/servlet/queryTygIdentity`：查询业主身份
- `/cpsApi/user/inviteOpenDoor`：生成访客邀请通行二维码
- `/cpsApi/user/myInfo`：用户个人中心信息

#### (6) 物业服务、缴费与微信支付 (`/tsms`, `/cpsApi/tsms`, `/cpsApi/wxmms`)
- `/tsms/servlet/queryBindAddress`：查询用户绑定的房产地址
- `/cpsApi/servlet/queryOpenHouseholdList/v2`：查询可开门房产列表（V2 版）
- `/cpsApi/tsms/servlet/myPropertyPoneList`：获取物业管家联系电话
- `/cpsApi/tsms/servlet/queryShareVisitorHouseholdList`：查询访客共享房产列表
- `/cpsApi/tsms/servlet/validShareOpenAuthStatus`：校验访客共享开门权限
- `/cpsApi/tsms/servlet/openDoorPackage/payInfo`：查询门禁套餐资费与待缴账单
- `/cpsApi/tsms/servlet/openDoorPackage/payInfo/getFamilyList`：缴费家庭成员清单
- `/cpsApi/tsms/servlet/openDoorPackage/payRecordList`：物业缴费流水记录
- `/cpsApi/tsms/servlet/openDoorPackage/confirmOrder`：确认物业缴费订单
- `/cpsApi/mini/pay/tsms/getPrepayRequest`：获取微信预支付交易单
- `/cpsApi/wxmms/servlet/getWxPayOrderStatus`：查询微信支付结果状态

#### (7) 商业广告与免广告权益 (`/adms`, `/cpsApi/vdcs/servlet/receiveAdFree`)
- `/adms/servlet/getAppPalyList`：获取开屏/弹窗广告播放物料
- `/adms/servlet/getThirdAppAdConfig`：获取第三方广告 SDK 投放开关与权重
- `/adms/servlet/reportThirdAppAdEventLog`：广告事件（展示/点击/关闭）上报
- `/cpsApi/vdcs/servlet/appAdOpenStatus`：查询社区广告开启状态
- `/cpsApi/vdcs/servlet/receiveAdFree/getUserStatus`：查询用户免广告特权状态
- `/cpsApi/vdcs/servlet/receiveAdFree/receive`：领取免广告权益

#### (8) 其它辅助接口
- `/cpsApi/cms/servlet/findTaoygAreaInfos`：查询社区/区域信息
- `/ctmsApi/feedback/saveFeedback`：用户意见与故障反馈提交
- `/tygBigData/api/appUserDataReport/appUserBaseDataReport`：用户端大数据信息上报
- `/chims/servlet/csGetLatestSoftwareVersionServlet`：应用版本升级检测

---

## 六、 BaseUrl 拼接与域名来源

### 1. 域名物理位置
在 `com.tyg.tygsmart.network.RxjavaRetrofitNetworkUtils` 的 `getServerBaseUrl(String serverModule)` 方法中。

### 2. 拼接逻辑
```java
public String getServerBaseUrl(String serverModule) {
    // 1. 尝试从动态下发缓存读取（key 格式为模块名去掉斜杠加 _server，例如 cpsApi_server）
    String key = serverModule.substring(1) + "_server";
    String cachedUrl = ServerConfigDAO.getCachedConfig(key);
    
    // 2. 若未缓存或配置失效，回退到本地默认配置
    if (TextUtils.isEmpty(cachedUrl)) {
        String host = PrefUtils.getString(
            MerchantApp.getInstance(),
            "pref_server_address",
            "http://lxj.taoyuangu.com"  // 默认生产主域名
        );
        int port = PrefUtils.getInt(MerchantApp.getInstance(), "pref_server_port");
        
        // 拼接协议与主机
        if (port != 0 && port != 80) {
            this.mBaseURL = host + ":" + port + "/";
        } else {
            this.mBaseURL = host + "/";
        }
    } else {
        this.mBaseURL = cachedUrl;
    }
    
    // 3. 最终 BaseUrl 拼接上对应的模块路径
    return this.mBaseURL + serverModule + "/";
}
```

### 3. Retrofit 动态切换机制
在 `simplePost(String url)` 中：
```java
String targetUrl = toRetrofit2Url();
if (!targetUrl.equals(this.mRetrofitBase)) {
    this.mRetrofitBase = targetUrl;
    this.mRetrofit = new Retrofit.Builder()
        .baseUrl(targetUrl)
        .client(this.mClient)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .addCallAdapterFactory(RxJava2CallAdapterFactory.create())
        .build();
}
return this.mRetrofit.create(RxjavaUUMSPost.class);
```

---

## 七、 签名 (Sign) 与 Token 生成机制

该客户端未采用标准的 HTTP URL Query 字典序 `&sign=`，而是**在请求体 Header 节点中嵌入加盐 MD5 计算出的鉴权 Token**。

### 1. 通用业务接口签名 Token
位于 `com.tyg.tygsmart.network.body.ReqBody$InnerBody$Header` 及 `ReqBody5$InnerBody$Header`：
- **固定加盐密钥 (Salt/Passwd)**：`"EA3vWPmfxhWUit2s"`
- **计算逻辑**：
  ```java
  // 1. 获取格式化时间戳
  SimpleDateFormat sdf = new SimpleDateFormat("yyyyMMddHHmmss");
  this.time_stamp = sdf.format(new Date());

  // 2. 加盐计算 MD5 摘要作为 Token
  this.token = StringUtils.MD5Encode("EA3vWPmfxhWUit2s" + this.time_stamp);
  ```
- **部分接口变体**：使用毫秒时间戳生成：
  ```java
  this.token = StringUtils.MD5Encode("EA3vWPmfxhWUit2s" + System.currentTimeMillis());
  ```

### 2. 门禁底层 TR 认证签名 (VDoor Authenticate)
位于 `com.tyg.vdoortr.core.process.AuthenticateProcess.java` 中的 `getAuthentication()`：
```java
// 密码双重 MD5 认证体系
String md5Password = MD5Util.MD5Encode(user.password);
String authSignature = MD5Util.MD5Encode(user.account + ":" + authCode + ":" + md5Password);
```

### 3. 用户登录后 Token 复用
登录接口 `/uums/servlet/userLoginServlet` 执行成功后，服务端下发 `UUMSToken`，应用保存在本地 `SharedPreferences`。已认证业务请求（如 `ReqBody2`、`ReqBody3`）直接从本地读取该 Token 放入报文 Header，不再重新本地计算。

---

## 八、 开门接口的请求参数结构

实际开门并非通过简单的 HTTP GET/POST 短连接完成，而是采用 **WebSocket (WSS) 实时长连接**向网关推送 JSON 格式的锁控指令。

### 1. 通信流程
1. **获取动态凭证**：客户端首先调用 HTTP 接口 `/cpsApi/openDoor/getAuthcode`，取得当前小区和房产的动态令牌。
2. **建立长连接**：
   - 目标地址：`wss://lxj.taoyuangu.com/wsserver/websocket?token={Token}`
   - 由 `com.tyg.vdoor.manager.TygWebSocketManager` 维护长连接会话。
3. **下发开门报文**：通过 `TygWebSocketManager.sendMessage()` 发送指令 JSON 字符串。

### 2. 开门请求报文结构 (`com.tyg.vdoor.wssbean.OpenDoorBean`)
```json
{
  "header": {
    "msgType": "OpenDoor",
    "token": "String",       // 必填：当前登录或房产动态令牌 Token
    "time_stamp": "String"   // 必填：yyyyMMddHHmmss 格式时间戳（如 20261019103520）
  },
  "body": {
    "code": "String",            // 必填：目标门禁设备硬件序列号/设备编号
    "mobile": "String",          // 必填：当前触发开门操作的业主手机号码
    "clientType": "2",           // 必填：客户端终端类型（固定值 "2"，代表 Android 移动端）
    "householdSerial": "String", // 必填：绑定的业主房产/户号唯一编码
    "number": "String"           // 必填：目标门控锁编号/按键门号（例如单元门、大门对应的编号）
  }
}
```

### 3. 辅助门禁授权申请接口参数结构 (`ApplyOpenDoorOauthBody`)
在业主申请门禁通行或远程授权时，HTTP 接口 `/cpsApi/openDoor/applyOpenDoorOauth` 提交的数据结构如下：
```json
{
  "buildingName": "String",     // 楼栋名称
  "buildingSerial": "String",   // 楼栋编号
  "buildingType": "String",     // 楼栋类型
  "regionName": "String",       // 小区/分区名称
  "regionSerial": "String",     // 小区唯一编码
  "unitName": "String",         // 单元名称
  "unitSerial": "String",       // 单元编码
  "roomName": "String",         // 房号名称
  "householdSerial": "String",  // 房产户号唯一编号
  "organizationSeq": "String",  // 物业/社区机构组织序号
  "name": "String",             // 申请人真实姓名
  "userType": "String"          // 用户身份类型（如业主、租户、家属）
}
```
