# WordNov iOS 版 · APK → IPA（GitHub Actions 云编译 + 去广告）

把 `WordNov-2.1.0.apk` 重建成可在 iPhone 安装的 IPA，编译全程在 GitHub 的 macOS 云机器上完成，本机不需要 Mac、不需要 Xcode。

---

## 0. 先说结论（技术事实）

拆包核验结果：

| 项目 | 结果 |
| --- | --- |
| 应用类型 | **Capacitor 混合应用**（原生壳 + WebView） |
| Web 资源 | `assets/public/` 共 **8768 个文件 / 85 MB**，完整的前端构建产物（uni-app + Vue 编译结果） |
| 原生代码 | `classes*.dex` 共 9 个，只有 Capacitor 壳 + 3 个官方插件 |
| 原生库 | **无任何 `.so`**（没有 Flutter/Unity/RN 引擎，也没有广告 SDK 的 native so） |
| 插件 | `@capacitor/app`、`@capacitor/filesystem`、`@capacitor/local-notifications` |
| 包名 / 应用名 | `com.hangci.app` / `WordNov` |
| 后端 API | `https://wordnov-api.cctools.icu`（CORS 回显任意 Origin，实测 `capacitor://localhost` 与 `https://localhost` 均 200，无需改服务端） |

**所以 APK 不能"格式转换"成 IPA**（Android 是 DEX + ART，iOS 是 ARM64 Mach-O + UIKit，指令集和运行时都不同）。但这个 App 的业务逻辑 100% 在 Web 层，正确做法是：

> 复用同一份 Web 资源 → 套一个 iOS 原生壳（Capacitor iOS）→ 在 macOS 上 `xcodebuild` 出 IPA。

效果与原版一致（同样的界面、同样的接口、同样的本地词库），差别仅在系统级能力（Android 专属的"应用内更新"逻辑在 iOS 上不适用）。

---

## 1. 目录结构

```
WordNov-iOS/
├─ .github/workflows/build-ipa.yml   # 云编译工作流（核心）
├─ www/                              # 从 APK 提取的 Web 资源（原样复用）
│  ├─ index.html                     # 已注入 noadblock.js
│  ├─ noadblock.js                   # ★ 去广告运行时补丁
│  ├─ assets/  static/               # 前端 bundle / 词库 / 发音音频 / 封面
├─ capacitor.config.json             # iOS 壳配置（appId、webDir、导航白名单）
├─ package.json                      # Capacitor 6 依赖
├─ ios-overlay/AppIcon/              # iOS 图标（从 APK 图标生成的全尺寸 + Contents.json）
├─ ios-overlay/Splash/               # 启动图 2732×2732
├─ scripts/apply-adblock.mjs         # 补丁注入 + 去广告核验报告
├─ scripts/build-ios.sh              # 本地 macOS 等价脚本（调试用）
└─ tools/一键上传GitHub.ps1           # 一键建仓库 + 推送 + 打印下一步
```

---

## 2. 上传到 GitHub（二选一）

### 方式 A：一键脚本（推荐）

```powershell
cd D:\消防员\WordNov-iOS

# 已登录 gh CLI 的情况下，自动建私有仓库并推送
.\tools\一键上传GitHub.ps1 -Repo "你的用户名/wordnov-ios" -Create
```

没有 gh 登录就用 PAT（GitHub → Settings → Developer settings → Personal access tokens，勾 `repo`）：

```powershell
$env:GH_TOKEN = "ghp_xxxxxxxx"
.\tools\一键上传GitHub.ps1 -Repo "你的用户名/wordnov-ios" -Create
```

### 方式 B：网页建空仓库 + 手动推

```bash
cd D:\消防员\WordNov-iOS
git init -b main
git add -A
git commit -m "WordNov iOS wrapper + adblock + CI"
git remote add origin https://github.com/你的用户名/wordnov-ios.git
git push -u origin main
```

> 工程约 90 MB（主要是 85 MB 静态资源），首次 push 需要几分钟，属正常。

---

## 3. 触发云编译

1. 打开 `https://github.com/你的用户名/wordnov-ios/actions`
2. 左侧选 **Build iOS IPA** → 右侧 **Run workflow**
3. 可填参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `bundle_id` | `com.hangci.app` | iOS 包名。用自己证书签名时**必须与描述文件一致** |
| `display_name` | `WordNov` | 桌面图标下的名字 |
| `version` | `2.1.0` | `CFBundleShortVersionString`，build 号自动用运行序号 |
| `export_method` | `ad-hoc` | 有证书时的导出方式；`unsigned` 表示强制出未签名包 |

4. 跑到 **绿色对勾**（一般 8–15 分钟，首次装 Pods 会久一点）
5. 页面底部 **Artifacts** → 下载 `WordNov-IPA-<运行号>.zip`
6. 解压得到 `WordNov-2.1.0-unsigned.ipa`（或 `-signed.ipa`）

工作流做了什么（可对照 `.github/workflows/build-ipa.yml`）：

```
checkout → node20 → npm install
→ npx cap add ios（首次生成 Xcode 工程）
→ node scripts/apply-adblock.mjs（注入补丁 + 出核验报告）
→ npx cap sync ios（Web 资源同步进 App bundle）
→ 替换图标/启动图 → 写 Info.plist（Bundle ID/名称/版本/权限）
→ xcodebuild -sdk iphoneos CODE_SIGNING_ALLOWED=NO
→ Payload/ 打包成 .ipa → 上传 Artifact
（若配置了证书 Secrets，额外走 archive + exportArchive 出已签名 IPA）
```

---

## 4. 安装到 iPhone

| 方式 | 需要什么 | 有效期 | 说明 |
| --- | --- | --- | --- |
| **TrollStore** | 系统在支持范围（如 14.0–16.6.1 部分版本） | 永久 | 直接把未签名 IPA 分享给 TrollStore 安装，最省事 |
| **Sideloadly / AltStore** | 电脑 + 自己的 Apple ID | 免费 7 天，付费开发者 1 年 | 用你的 Apple ID 重签安装 |
| **ESign / 爱思助手 / 牛蛙助手** | 一个企业证书 | 看证书 | 手机上直接自签，适合没有电脑时 |
| **本工作流签名** | 开发者 p12 + 描述文件 | 1 年 | 见下节，出来的就是可直接装的 IPA |

> 装完首次打开如提示"未受信任的开发者"，去 **设置 → 通用 → VPN 与设备管理** 里信任对应证书。

---

## 5. 让云编译直接出「已签名 IPA」

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

| Secret | 内容 | 获取方式 |
| --- | --- | --- |
| `BUILD_CERTIFICATE_BASE64` | `.p12` 证书的 base64（**单行**） | macOS：`base64 -i cert.p12 \| pbcopy`；Windows：`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.p12"))` |
| `P12_PASSWORD` | 导出 p12 时设的密码 | — |
| `PROVISIONING_PROFILE_BASE64` | `.mobileprovision` 的 base64 | 同上 |
| `APPLE_TEAM_ID` | 10 位 Team ID | 开发者后台 Membership 页 |

再在 Run workflow 时把 `bundle_id` 改成描述文件里的 App ID，`export_method` 选：

- `ad-hoc`：注册过 UDID 的设备可直接装（个人/公司账号常用）
- `development`：开发调试
- `app-store-connect`：准备上架（Xcode 15.3+ 用这个名字，老版本用 `app-store`）
- `enterprise`：企业证书内部分发

---

## 6. 去广告（重点）

### 6.1 拆包核验：原 APK 里其实没有广告 SDK

我离线扫了全部 `classes*.dex`、`lib/`、`assets/`：

- 没有 AdMob / 穿山甲(pangle) / 优量汇(gdt) / 快手 / Sigmob / Mintegral / AppLovin / UnityAds 任何一个 SDK 的类名或域名；
- Web 包里搜到的 `广告 / banner / reward / sponsor` 绝大多数是**词库数据本身**（`advertisement`、`banner`、`sponsor` 这些单词的释义），不是广告位；
- 唯一相关的是三个模块里残留的**广告解锁面板钩子** `onPanelAd`（`systemReadAccess`、`localBookReadAccess`、`import` 里），当前版本已被置空（`needsUnlock` 恒为 `false`）；
- `packageBiz-member-member.js` 里的「全程无广告」是**会员页的营销文案**，不是广告。

也就是说：广告要么来自服务端下发的内容，要么该版本还没接广告。**为了让 iOS 版绝对干净，本工程加了一层运行时去广告层**，把"将来接的广告"和"服务端下发的广告"一起掐掉。

### 6.2 四层拦截（`www/noadblock.js`，在业务 bundle 之前执行）

| 层 | 做法 |
| --- | --- |
| **network** | 劫持 `fetch` / `XMLHttpRequest` / `sendBeacon` / `window.open` / `HTMLScriptElement.src`，命中广告域名或广告路径直接返回 204 空响应，业务代码不会报错卡住 |
| **dom** | `MutationObserver` + 2.5s 兜底轮询，清掉 `ins.adsbygoogle`、`#ad_*`、`.ad-slot`、`.interstitial-*`、`[data-ad-slot]` 及指向广告域名的 `iframe` |
| **gates** | 识别「看广告解锁 / 激励视频」文案，若面板里有「跳过 / 关闭」自动点掉，不再强制看广告 |
| **promo** | 可选：隐藏「开通会员 / 首月 X 折」推广横幅（**默认关闭**，因为那属于业务 UI 而非广告） |

广告域名表覆盖：doubleclick、googlesyndication、applovin、unityads、ironsource、mintegral、pangle/穿山甲、gdt/优量汇、快手、sigmob、vungle、chartboost、adcolony、tapjoy、inmobi、admaster、秒针、好耶、品友、tanx、alimama 等 40+。

### 6.3 不想重新打包就切换开关（运行期）

App 内打开 Safari 调试（或在 Mac 上用 Safari → 开发 → 你的 iPhone）：

```js
// 连会员推广一起清掉
localStorage.setItem('nov.ad.cfg', JSON.stringify({promo:true}));
location.reload();

// 看拦截统计
window.__NOV_ADBLOCK_REPORT();
```

其它可调项：`network`、`dom`、`gates`、`promo`、`analytics`（顺带拦友盟/cnzz 等统计）、`verbose`（打印拦截日志）。

### 6.4 每次编译都会出核验报告

工作流里的 `node scripts/apply-adblock.mjs` 会打印：

```
===== 去广告核验报告 =====
扫描文件      : N
补丁版本      : noadblock.js (x KB)
广告域名命中  : 0（干净）
广告解锁钩子  : ...
原生广告 SDK  : 无
拦截策略      : 网络层 + DOM 清扫 + 面板自动跳过
==========================
```

报告同时写进 Actions 运行页的 Job Summary，并作为产物上传，可回溯。

---

## 7. 已做的 iOS 适配

| 项 | 处理 |
| --- | --- |
| Web 资源路径 | 原样搬到 `www/`，相对路径 `./assets/*` 不变 |
| 接口跨域 | 实测服务端回显任意 Origin，`capacitor://localhost` 直接可用，无需改后端 |
| 存储 / 词库 | 原 `localStorage` + 本地静态资源，WKWebView 原生支持 |
| 文件系统插件 | 保留 `@capacitor/filesystem`（导入词库、导出用） |
| 本地通知 | 保留 `@capacitor/local-notifications`（学习提醒、打卡） |
| 图标 / 启动图 | 从 APK `ic_launcher` 生成 iOS 全尺寸（20→1024）+ 2732×2732 启动图 |
| 权限文案 | 已写 `NSPhotoLibraryUsageDescription` 等中文说明，避免上架被拒 |
| 版本号 | `CFBundleShortVersionString=2.1.0`，`CFBundleVersion` 用运行序号自增 |

---

## 8. 常见问题

**Q：白屏 / 只显示标题？**
看 Actions 日志里 `npx cap sync ios` 是否成功、`www/index.html` 是否被正确复制。本地可用 Safari 连真机看 Console 报错。

**Q：登录成功但请求 401 / CORS 报错？**
服务端回显 Origin，正常不会出问题；若你换了后端，把新域名加进 `capacitor.config.json` 的 `server.allowNavigation`，并让后端把 `capacitor://localhost` 加进允许列表。

**Q：通知不弹？**
首次进入提醒设置时系统会弹权限，拒绝过就到 **设置 → WordNov → 通知** 手动开。

**Q：能上架 App Store 吗？**
技术上能出 `app-store-connect` 包，但这类"内容聚合 + 会员"应用要过审需自行处理资质与内容合规；本工程只解决构建与去广告。

**Q：APK 更新了怎么办？**
只需替换 `www/`：解压新 APK，把 `assets/public/*` 覆盖到 `www/`，再跑一次 `node scripts/apply-adblock.mjs`（会重新注入），push 后重新 Run workflow。

**Q：想换图标 / 名字？**
图标放 `ios-overlay/AppIcon/`（同时改 `Contents.json`），名字改 workflow 的 `display_name` 输入。

---

## 9. 一键复现（命令速查）

```powershell
# 1) 推送
cd D:\消防员\WordNov-iOS
.\tools\一键上传GitHub.ps1 -Repo "用户名/wordnov-ios" -Create

# 2) 浏览器执行 Run workflow，等绿勾，下 Artifact

# 3) 有 Mac 想本地出包
BUNDLE_ID=com.hangci.app DISPLAY_NAME=WordNov bash scripts/build-ios.sh unsigned
```

---

## 10. 本工程已验证 / 未验证

- ✅ 已核验：APK 结构、插件清单、Web 资源完整性（8768 文件）、无原生广告 SDK、API CORS 策略、图标与启动图已生成、补丁注入幂等
- ⏳ 需云机器完成：`xcodebuild` 编译（Windows 无法编译 iOS 二进制）、真机安装（需要你的设备与签名）
- ⚠️ 注：本机是 Windows，所以"出 IPA"这一步必须在 GitHub 的 macOS runner 上跑——这正是本方案的设计