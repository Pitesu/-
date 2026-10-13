# 极光音乐 · Aurora Music

一个极简的本地优先音乐 App。四个页签，砍掉社交、歌词、推荐算法等所有非必需模块，只保留「听歌」本身。

## 快速开始

```bash
python -m http.server 8848
```

浏览器打开 `http://127.0.0.1:8848`。

> 录音功能需要 `https` 或 `localhost` 环境，直接双击 `index.html`（`file://`）录音会被浏览器拒绝。

## 安装到手机

支持 PWA 安装，装到桌面后全屏运行、断网可用。

1. 把项目传到任意 HTTPS 静态托管（Netlify Drop / Vercel / GitHub Pages），或本地双击 `启动-局域网.bat` 让手机同 WiFi 访问
2. 手机浏览器打开 → Android「⋮ → 添加到主屏幕」/ iPhone Safari「分享 → 添加到主屏幕」

详细步骤与 APK 打包方式见 [安装到手机.md](安装到手机.md)。

## 模块

| 模块 | 说明 |
|---|---|
| 发现 | 首页 Hero、快捷入口、最近添加 |
| 下载 | 联网检索**自由许可**音频，双源降级 |
| 录音 | 手机标准格式，录完自动配图入库 |
| 曲库 | 全部音频本地列表，支持搜索与文件导入 |
| 我的 | 音量、播放模式、重算时长、清空数据 |

播放器为全屏覆盖层，含旋转唱片、实时频谱、进度拖拽、三种播放模式、锁屏与耳机按键控制。

## 版权策略

这是本项目的核心设计约束，分两条路走：

**可下载的内容** —— 下载区只接入公有领域与 CC 自由许可音频库（Wikimedia Commons、Internet Archive）。检索时会主动过滤掉带限制条款的条目：

- 拒绝：Non-Commercial、NC、ND、Fair use、All rights reserved、Copyright、`©`、`(c)`
- 许可不明的结果一律跳过，宁可漏掉也不误传

每个条目都会显示许可证类型与作者署名。

**不可下载的内容** —— 受版权保护的歌曲不提供在线来源，也不内置任何商业曲目。要听这类内容，只能：

1. 用「录音」模块现场录制（设备播放的声音）
2. 用「导入文件」添加自己持有的音频文件

这两条路径的曲目都会标记为「自有内容 · 版权自负」。

**内置示范曲**由 Web Audio 在本机实时合成（正弦波叠加 + 包络 + 卷积混响），不含任何第三方素材，可自由使用。

## 录音格式

按主流手机录音的顺序探测：

1. `audio/mp4;codecs=mp4a.40.2` → `.m4a`（iOS 与多数安卓手机录音的默认格式）
2. `audio/mp4` → `.m4a`
3. `audio/aac` → `.aac`
4. `audio/webm;codecs=opus` → `.webm`（桌面 Chrome 回退）
5. `audio/ogg;codecs=opus` → `.ogg`

当前实际使用的格式会显示在录音页底部。停止录音后自动计算时长、提取波形峰值、生成封面并写入曲库。

## 封面处理

- **程序生成**：用波形峰值画成放射状声纹，配色由曲目 id 哈希决定
- **提取内嵌封面**：M4A 走 `moov/udta/meta/ilst/covr`，MP3 走 ID3v2 `APIC`
- **手动上传**：自动居中裁剪为正方形

## 数据存储

全部音频与封面存在浏览器 IndexedDB，不上传任何服务器。清空曲库即彻底删除。

| Store | 内容 |
|---|---|
| `tracks` | 曲目元数据（标题、艺术家、时长、许可、波形峰值） |
| `blobs` | 音频 Blob 与封面 Blob |
| `meta` | 主题、音量等偏好 |

## 文件结构

```
index.html              应用骨架
manifest.webmanifest    PWA 清单（名称/图标/启动方式/快捷方式）
sw.js                   Service Worker（离线缓存）
启动-局域网.bat          Windows 局域网启动脚本，自动显示本机 IP
assets/css/app.css      视觉系统
assets/js/db.js         IndexedDB 封装
assets/js/cover.js      封面生成与提取
assets/js/demo.js       内置示范曲合成
assets/js/player.js     播放引擎
assets/js/recorder.js   录音模块
assets/js/online.js     在线音源检索下载
assets/js/ui.js         UI 装配
assets/icons/           应用图标（含安卓 maskable 与 iOS 触摸图标）
tools/make-icons.js     图标生成脚本（纯 Node，无需依赖）
test/verify.js          核心逻辑单元验证
test/verify-pwa.js      PWA 安装配置验证
```

## 测试

```bash
node test/verify.js        # 核心逻辑，53 项
node test/verify-pwa.js    # PWA 配置，22 项
node tools/make-icons.js   # 重新生成图标
```

覆盖 WAV 编码器正确性、版权过滤严格性、Archive 查询参数、HTML 与 JS 的 id 交叉引用。

## 已知限制

- 在线检索需要网络；无网时下载区会提示改用导入或录音
- 部分音源不允许浏览器跨域直连下载，会提示跳转原始页面手动保存
- iOS 首次播放需要用户手势解锁音频上下文，应用已处理
- 应用形态为 Web App；如需上架应用商店，后续可用 Capacitor 打包为原生应用