# 第三方开源组件

本工具使用了以下开源组件，许可证原文见各项目仓库。

| 组件 | 用途 | 许可证 |
|---|---|---|
| [Tauri](https://github.com/tauri-apps/tauri) 及官方插件 | 桌面应用框架 | MIT / Apache-2.0 |
| [React](https://github.com/facebook/react) | 界面 | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | 图标 | ISC |
| [Vite](https://github.com/vitejs/vite) | 构建 | MIT |
| [ExcelJS](https://github.com/exceljs/exceljs) | 导出 Excel 上架数据包 | MIT |

仅用于开发和测试（不随安装包分发）：

| 组件 | 用途 | 许可证 |
|---|---|---|
| [Vitest](https://github.com/vitest-dev/vitest) | 单元测试 | MIT |
| [jsdom](https://github.com/jsdom/jsdom) | 在测试里加载浏览器插件的页面脚本 | MIT |

浏览器插件（`extension/`）和拼多多窗口的注入脚本（`src-tauri/src/inject.js`）是本工具自己的代码，没有使用第三方库。
