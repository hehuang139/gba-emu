# 浏览器兼容性记录

Advance 的 mGBA 线程核心要求页面启用跨源隔离，并依赖 SharedArrayBuffer、WebAssembly、WebGL 和 IndexedDB。发布前请在目标浏览器打开应用，点击顶部「环境检查」，把结果和实际操作记录在下表；面板中的存储空间只表示浏览器当前估算值。

## 记录模板

| 日期 | 浏览器 / 版本 | 操作系统 / 设备 | HTTPS 或 localhost | COOP / COEP | 画面 | 音频 | 键盘 / 手柄 / 触控 | 导入与存档 | 结果 / 问题 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | 浏览器版本 | 系统与设备 | 是 / 否 | 通过 / 失败 | 通过 / 失败 | 通过 / 失败 | 通过 / 失败 | 通过 / 失败 | 说明复现步骤 |

## 验证步骤

1. 清理一个独立测试配置中的站点数据，打开应用并记录「环境检查」的六项结果。
2. 导入仓库内的 `public/demo/star-orbit.gba`，启动、暂停、恢复并运行至少两分钟。
3. 导出并重新导入 `.sav`，刷新页面后确认游戏和存档仍可读取。
4. 在移动设备上重复触控流程；横屏与竖屏各记录一次布局是否可操作。
5. 失败时保留浏览器版本、部署响应头、控制台错误和最小复现步骤，不上传商业 ROM 或个人存档。

## 当前结论

| 日期 | 浏览器 / 系统 | 环境与测试方式 | 验证结果 | 未验证范围 |
| --- | --- | --- | --- | --- |
| 2026-09-10 | Edge 141.0.3537.71 / Windows 10 Pro 10.0.19045 | Vite localhost，COOP / COEP；Playwright headless，1440×1024 与 390×844 视口，启用 SwiftShader | 环境检查六项、试玩启动、键盘、存取档、刷新恢复、ZIP 导入、倒带与 worker 释放通过 | SwiftShader 不能代表真实 GPU 性能；手机视口不能代表 Android / iOS；音频测试只验证程序状态，未人工试听 |
| 待验证 | Firefox | 待填写版本和设备 | 未验证 | 完整流程 |
| 待验证 | Safari / macOS | 待填写版本和设备 | 未验证 | 完整流程 |
| 待验证 | Chrome / Android | 需要真实手机 | 未验证 | 触控、多点输入、音频、性能 |
| 待验证 | Safari / iOS | 需要真实 iPhone / iPad | 未验证 | 触控、安全区、音频、性能 |

复现上述 Edge 记录：先运行 `pnpm dev`，另一个 PowerShell 终端设置 `$env:BROWSER_EXECUTABLE_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'`，再运行 `pnpm test:engine`、`pnpm test:ui`、`pnpm test:zip` 和 `pnpm test:saves`。UI 检查生成环境面板的桌面和手机尺寸截图。

未记录的环境不视为已支持。应用要求 HTTPS 或 localhost，以及 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`；普通 HTTP 局域网地址无法启动线程核心。不同浏览器、驱动和部署仍需独立实测。
