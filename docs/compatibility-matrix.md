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

仓库自动化检查目前以 Chromium 为主，Firefox、Safari、Android 和 iOS 的结论必须由真实设备记录后再填写。未记录的环境不视为已支持。应用要求 HTTPS 或 localhost，以及 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`；普通 HTTP 局域网地址无法启动线程核心。
