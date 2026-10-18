# SPT 模组管理器

SPT 4.x（离线塔科夫）的本地网页管理器：装模组、开服务端、起客户端、配 Fika 联机，都在一个页面里。

Node.js 18+，无需安装依赖。

## 功能

- **模组管理** —— 服务端模组 / BepInEx 插件 / patcher 一览，启用、停用、删除
- **导入模组** —— 拖入 `.zip` / `.7z` / `.rar`，自动识别单模组、合集包、SPT 整包，装前备份
- **打包导出** —— 把已装模组打成 ZIP / 7z 发给别人，附带清单
- **模组市场** —— 搜索 sp-mod.com 并一键安装
- **游戏客户端** —— 直接启动游戏本体（免启动器、自动登录选中存档），客户端模式 / 无头主机模式一键切换，启动器 GamePath 检测与修复
- **服务器** —— 启动、停止 SPT 服务端，查看日志
- **Fika 联机** —— `fika.jsonc` 与 `com.fika.core.cfg` 可视化编辑（保留注释），无头主机配置与启动
- **存档管理** —— 新建 / 删除存档（版本列表同启动器）、备份与还原
- **战局 AI / 物资刷新** —— 调 bot 与物资倍率，改动前自动备份

所有写操作都会先备份到 `data/backups/`。

## 快速开始

1. 安装 [Node.js](https://nodejs.org/) 18 或更高版本
2. 双击 `启动器.bat`
3. 打开 <http://127.0.0.1:7317>

首次启动会自动探测 SPT 目录，也可以在「设置」里手动指定。端口用环境变量 `SPT_MANAGER_PORT` 修改。

## 测试

```bat
node tests\archive-test.js
node tests\mods-test.js
node tests\dllmeta-test.js
node tests\install-test.js
node tests\fika-test.js
node tests\pack-test.js
node tests\profile-test.js
node tests\launch-test.js
node tests\headless-mode-test.js
```

## 许可

MIT
