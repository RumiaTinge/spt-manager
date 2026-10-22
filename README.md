# SPT 模组管理器

SPT 4.x 的本地网页管理器：装模组、开服务端、起客户端、配 Fika 联机，全在一个页面里。无需安装，Node.js 18+ 直接跑。

```bat
启动器.bat
```

然后打开 <http://127.0.0.1:47823>。默认端口 47823，可用环境变量 `SPT_MANAGER_PORT` 改。

默认会挂在 `E:\game\EFT\Client.0.16.9.0.40087`，别的路径在「设置 → SPT 根目录」里改（会记住，改前备份配置）。

## 功能一览

| 页面 | 干什么 |
| --- | --- |
| **概览** | 服务端版本 / 已装模组数 / 当前存档 / 快捷入口 / 未安装的前置提醒 |
| **游戏客户端** | 直接启动游戏本体（不走启动器，自动登录到选中存档）、也可改用启动器；客户端模式 / 无头主机模式一键切换；启动器 GamePath 检测与一键修复 |
| **模组管理** | 列出服务端模组、BepInEx 插件、patcher（版本 / 作者 / 大小 / 状态），启用 / 停用 / 删除 |
| **导入模组** | 拖入 `.zip` / `.7z` / `.rar`，自动识别单模组 / 合集包 / SPT 整包，勾选后安装（有备份） |
| **打包导出** | 把已装的模组重新打成 ZIP / 7z 发给别人，包内附带 `spt-manager-pack.json` 清单 |
| **模组市场** | 连 sp-mod.com 搜索并一键安装 |
| **服务器** | 启动 / 停止 SPT 服务端，看日志、看端口 |
| **实时窗口** | 服务端 / 每个无头主机 / NoAIBots 各占一张实时日志卡，互不覆盖；附「快速编辑」开关，避免误点控制台把进程冻住 |
| **战局实测** | 把服务端 NoAIBots 的决策（命中的规则、改过的地图参数、算出的同屏上限、生成批次）和客户端日志里真正刷出来的 AI（上限、刷新系统、每个进场的 bot）摆在一起对照，5 秒自动刷新 |
| **Fika 联机** | 服务端 `fika.jsonc` 可视化（保留注释）、客户端 `com.fika.core.cfg` 分组表单、无头主机配置与启动 |
| **战局 AI** | 调 bot 数量 / 难度 / 刷新率等（写服务端数据库，有备份）；页面下方是 **NoAIBots 规则引擎**（无AI 档位真正生效、规则热重载、开战预演、每条规则的刷新时间轴） |
| **AI 参数** | NoAIBots 参数总览：全局开关、按「旧系统 / 新系统 / 首领·PMC / 上限」分组的参数说明与默认值、当前被哪条规则使用、各地图原版刷新参数对照 |
| **物资刷新** | 按地图调整 loose loot / static loot 倍率（有备份） |
| **物品效果** | 改任意医疗 / 兴奋剂 / 食物 / 饮料的数值（治疗量、使用时间、能量水分、状态效果时长）和兴奋剂 Buff 组，写服务端数据库，改前自动备份 |
| **存档管理** | 新建 / 删除存档、立即备份、查看备份列表与还原 |
| **设置** | SPT 根目录、端口等 |
| **关于** | 版本信息；**内置基础模组一键安装**（Fika 客户端插件 / Fika 服务端 mod / Fika 无头主机，打包进 exe、离线可用） |

## 游戏客户端

### 存储的档案 / 账号

存档列表来自 `SPT\user\profiles\*.json`，页面上的「账号」就是存档的昵称（`username`），**密码留空**——SPT 离线版只认用户名，不校验密码。

### 启动方式

- **直接启动（默认）**：跳过 `SPT.Launcher.exe`，拿选中存档的 profileId 当 `-token`，把服务端地址塞进 `-config`，直接拉起 `EscapeFromTarkov.exe`。服务端没开会先自动拉起（最多等 90 秒）。
- **用启动器**：还是走官方 `SPT.Launcher.exe`（自动登录到选中存档）。

> 手动双击 `EscapeFromTarkov.exe` 会弹 `[SPT] Startup Error: Please start SPT using SPT.Launcher.exe. Exiting.`——那是因为缺 `-token` / `-config` 参数，不是文件坏了。

### 客户端模式 / 无头主机模式

同一份客户端就能切换，不用复制第二份：

- **客户端模式（玩单机）**：停掉无头进程 → 把 `Fika.Headless.dll` 改名成 `.dll.disabled`（BepInEx 不加载它）→ 直接启动客户端。
- **无头主机模式（同一份客户端）**：停掉正在玩的客户端（同一份只能跑一个）→ 启用 `Fika.Headless.dll` → 把服务端生成的 `HeadlessConfig.json` 复制到客户端根目录 → 拉起 `FikaHeadlessManager.exe`，等它连上服务端。

页面上会显示无头当前状态（已连接服务端 / 启动中 / 上次异常退出 / 未运行），切换过程有进度条和步骤提示。

### 启动器 GamePath

SPT 启动器的 `config.json` 里 `GamePath` 必须是游戏根目录（`EscapeFromTarkov.exe` 所在的那层）。指到 `SPT\` 子目录时，启动器找 `BepInEx\plugins\spt\spt-core.dll` 会抛异常，表现就是点「开始游戏」没反应、`launcher.log` 里一行 `Core dll mismatch :: FAILED`。页面检测到不对会弹黄色警告卡，点「一键修复」即可（改前备份）。

### 在线玩家

「在线玩家」卡显示**当前连在这台服务端上的玩家**，数据来自 Fika 服务端的 `GET /fika/presence/get`：

- 人数 + 每个玩家的昵称、等级（有就给）、状态（对局中 / 大厅 / 匹配中 / 藏身处）、对局代码；
- 每 5 秒自动刷新（只在停在「游戏客户端」页时刷新），也可以手动点「刷新」；
- 连远程服务器时查的是对方那台；切换目标后这里跟着变。

注意两点：① 只统计**装了 Fika** 的玩家，纯单机 SPT 玩家不会出现在 presence 里；② 对方服务端没装 fika-server 时没有这个接口，页面会提示查询失败。接口是 `GET /api/servers/presence[?url=https://ip:6969]`。

### 远程服务端地址（自动补全 + 地址簿）

「服务端地址 Server.Url」可以随便填，保存时会统一成 `https://主机:端口`：

| 你填的 | 实际保存 |
| --- | --- |
| `172.19.163.2` | `https://172.19.163.2:6969` |
| `172.19.163.2:7000` | `https://172.19.163.2:7000` |
| `https://1.2.3.4:6969/` | `https://1.2.3.4:6969` |
| `http://host` | `http://host:6969` |
| `[::1]:6969` | `https://[::1]:6969` |

输入框下面会实时显示「将保存为 …」。每次保存都会把地址记进**地址簿**（`data\settings.json → serverHistory`，最多 15 条），下拉选一条就能「用这个」直接填回或「删除」，方便在本机 / 远程 / 多个朋友服务器之间切换。对应接口：`GET /api/servers`、`POST /api/servers/forget`。

## 内置基础模组（关于页）

exe 里已经带了四样东西，换电脑、重装、带朋友入门都不用再去找压缩包：

| 模组 | 版本 | 落到哪 |
| --- | --- | --- |
| Fika 联机 · 客户端插件 | 2.2.3 | `BepInEx\plugins\Fika` |
| Fika 联机 · 服务端 mod | 2.0.9 | `SPT\user\mods\fika-server` |
| Fika 无头主机 | 1.4.12 | `BepInEx\plugins\Fika\Fika.Headless.dll` + `FikaHeadlessManager.exe` |
| 战局实测 · 客户端插件 | 0.3.0 | `BepInEx\plugins\RaidProbe\RaidProbeClient.dll` |

「关于」页每项都能一键安装 / 重新安装，覆盖前把旧文件备份到 `data\backups\bundled\<时间戳>_<模组>`；已经被改成 `.disabled` 的同名插件会顺手恢复。

安装顺序：Fika 客户端插件 → Fika 服务端 mod → 无头主机（可选），装完重启服务端和游戏。「战局实测」页顶部还有一张同名卡片，显示「文件版本 / 运行中版本」，能直接一键装或更新（BepInEx 只在游戏启动时加载插件，装完要重启游戏）。

源码运行时资源在 `assets\bundled\`（`manifest.json` 描述每个模组落到哪），打包时 `build\build-exe.mjs` 会把它们 base64 内联进 exe。
## 模组管理

- **服务端模组**：`SPT\user\mods\<模组>\`，读模组里的 `package.json` / `*.dll`。
- **客户端插件**：`BepInEx\plugins\`，版本优先读 DLL 元数据（读不到再退回 `BepInEx\LogOutput.log` 里的加载行）。
- **patcher**：`BepInEx\patchers\`。
- `*.disabled` 的目录 / 文件算「已停用」，启用就是去掉后缀。

「检查更新」会去拉 GitHub Releases 比对版本（有缓存，不联网时不影响页面）。

## 导入模组

支持三种包：

1. **单模组**：包内直接是 `BepInEx\plugins\xxx\xxx.dll` 或 `SPT\user\mods\xxx\`。
2. **合集包**：包里同时有多个模组（例如 SAIN + 服务端模组、WTT-ContentBackport 这种 3.3GB 的合集），会列出每个模组让你勾选。
3. **SPT 整包**：包含 `BepInEx\core` / `SPT\SPT_Data` 之类的完整安装包，会被识别为「不是模组包」拒绝导入。

安装前会把将被覆盖的旧文件备份到 `data\backups\replaced\<时间戳>_<模组名>\`。同名模组默认拒绝覆盖，勾「覆盖同名模组」才替换（旧目录也会先备份）。

大文件不用上传：填本机路径（`.zip` / `.7z` / `.rar`）点「分析本机文件」即可，只读压缩包目录清单。

### 解包器兼容性

现在会自动挑系统里**语法匹配**的解包器，不再把 Bandizip 当 7-Zip 用（以前只装了 Bandizip 的机器会报 `Parameter Paring Error`）：

| 系统里有什么 | 行为 |
| --- | --- |
| 7-Zip | 优先用，清单一次读全（路径 + 大小） |
| 只有 Windows 自带 `tar.exe` | `.zip` / `.tar` / `.gz` 等都直接用它解，清单靠解包后遍历（大小显示 0，不影响安装） |
| 只有 Bandizip 或 WinRAR | 用它们解包（`bz x -o:` / `WinRAR x`），清单同样靠遍历 |

排查时可以强制指定解包器：`set SPT_MANAGER_EXTRACTOR=C:\Windows\System32\tar.exe` 再启动 exe。

## 打包导出

把已装的模组重新打成安装包发给别人，对方用「导入模组」就能装。

- 勾选要打包的模组（服务端模组 / 客户端插件 / patcher 可混选），可设置包名、格式（ZIP / 7z）、压缩级别（快速 / 标准 / 小体积）。
- 包内保留正确布局（`SPT\user\mods\...`、`BepInEx\plugins\...`、`BepInEx\patchers\...`），并在包根写一份 `spt-manager-pack.json`（工具名、模组名、版本、作者、安装路径）。
- 输出在 `data\exports\`，页面上可以直接「下载」「打开目录」「删除」。

## 存档管理

- **新建存档**：走服务端 `/launcher/v2/register`（和 SPT 启动器的「注册」是同一套），版本（Standard / Edge Of Darkness 等）从服务端 `/launcher/v2/types` 拉，和启动器一致。需要服务端在跑。
- **删除存档**：走 `/launcher/v2/remove`，同样需要服务端在跑。
- **立即备份**：把存档 JSON 复制到 `data\backups\profiles\`，可随时还原。

## Fika 联机

两处配置：

- **服务端**：`SPT\user\mods\fika-server\assets\configs\fika.jsonc`。页面按 `client` / `server` / `natPunchServer` / `headless` / `background` 分组，改完点「保存服务端配置」。写入时保留原注释和 CRLF 换行，改前备份到 `data\backups\config\`。
- **客户端**：`BepInEx\config\com.fika.core.cfg`，按分组折叠显示，改完点「保存客户端配置」。

改完要**重启服务端**（客户端配置还要重启游戏）才生效。

> **新客户端第一次用，这两个文件都还不存在**（`fika.jsonc` 要跑过一次服务端才生成，`com.fika.core.cfg` 要启动过一次游戏才生成）。所以页面显示「还没有 fika.jsonc / 配置读不出」不是坏了，先去「关于」页把内置的 Fika 装上，再启动一次服务端 / 客户端即可。

### 无头主机（Headless Host）

无头客户端 = 不带画面的那份游戏，Fika 用它当主机让 AI / 玩家进来打。官方 wiki：<https://wiki.project-fika.com/advanced-features/headless-client>。

本机实测可用：SPT 4.0.13 + Fika 2.2.3 + Fika.Headless 1.4.12。

#### 方式一：同一份客户端切换（推荐，不用复制 63GB）

1. **装无头组件**到客户端目录：`BepInEx\plugins\Fika\Fika.Headless.dll`（来自 `Fika.Headless.1.4.12.zip`）+ `FikaHeadlessManager.exe`（来自 `Fika.Headless.Manager.1.4.0.zip`，放客户端根目录）。
2. **让服务端生成无头存档**：Fika 页 → 无头主机卡片 `无头存档数量 amount` 设成 1（或更多）→ 保存 → **重启服务端**。Fika 会自动建 `headless_<uid>` 存档，并把配置写到 `SPT\user\mods\fika-server\assets\scripts\<uid>\HeadlessConfig.json`。
3. **切换**：游戏客户端页 → 启动方式 → **无头主机模式（同一份客户端）** → 点按钮。管理器依次：停掉正在玩的客户端（同一份只能跑一个）→ 启用 `Fika.Headless.dll` → 把 `HeadlessConfig.json` 复制到客户端根目录（没有才复制）→ 拉起 `FikaHeadlessManager.exe` → 等它显示 **已连接服务端**。
4. **拉人 / 开房**：主菜单 `Host Raid` → `Use Headless Host`。这一份客户端此时是无头主机，别人（或你另一台机器上的客户端）加进来。
5. **切回单机**：选 **客户端模式（玩单机）** → 停掉无头进程 → 把 `Fika.Headless.dll` 改名成 `.dll.disabled`（BepInEx 就不加载它）→ 直接启动客户端。

实测踩过的坑：

- 管理器启动 `FikaHeadlessManager.exe` 时会**开一个隐藏的控制台窗口**：它必须有控制台，否则卡在 `Press 'g' to start with graphics or wait 3 seconds...` 不动（无控制台时 `Console.ReadKey` 直接抛异常）。
- 客户端模式下插件是停用状态；**手动**启动游戏前也确认它是停用的，不然会被当成无头跑。
- 无头存档 `headless_<uid>` 在「存档管理」里能看到，别删。
- 别给它加 `-batchmode -nographics`：实测那个组合在巡逻队初始化阶段 native crash。

#### 方式二：单独复制一份客户端

1. **复制客户端**（约 63GB）：`robocopy "E:\game\EFT\Client.0.16.9.0.40087" "E:\game\EFT\Headless" /E /MT:32 /NFL /NDL /NJH /NJS`
2. **装无头组件**到副本目录（同上）。
3. **清掉副本里的客户端 mod**：副本别带 WTT 这类带 patcher 的模组，实测 `BepInEx\patchers\WTT-ContentBackportPatcher` 会让巡逻队初始化 native crash；把 `BepInEx\plugins`、`BepInEx\patchers` 下除 `spt`、`Fika` 外的都挪走。
4. **复制 `HeadlessConfig.json`** 到副本根目录（和 `EscapeFromTarkov.exe` 同层）。
5. **Fika 页 → 添加无头目录**（选副本根目录）→ 启动；目录旁会显示 **已连接服务端**。
6. 主菜单 `Host Raid` → `Use Headless Host`。

管理器这边的对应功能：

- **启动方式卡片（游戏客户端页）**：`客户端模式（玩单机）` / `无头主机模式（同一份客户端）` 一键切换；有单独副本时按钮变成「无头房主（无头 + 客户端）」，会依次确认服务端 → 起无头 → 起客户端。
- **无头主机卡片（Fika 页）**：直接改 `fika.jsonc → headless`（`profiles.amount`、`aliases`、`scripts.generate`、`scripts.forceIp`、`setLevelToAverageOfLobby`、`restartAfterAmountOfRaids`），保存后重启服务端生效。
- **添加无头目录**：登记单独的无头副本，检查 `FikaHeadlessManager.exe`、Headless 插件、SPT 本体、游戏本体，显示「已连接服务端 / 启动中 / 上次异常退出 / 未运行」，可一键启动。
- 相关仓库：[project-fika/Fika-Headless](https://github.com/project-fika/Fika-Headless)（插件）、[Fika-Headless-Manager](https://github.com/project-fika/Fika-Headless-Manager)（启动器）。

## 战局 AI / 物资刷新

- **战局 AI**：改 bot 数量、难度、刷新间隔等，写的是服务端数据库 / 配置，改前备份到 `data\backups\`。
- **物资刷新**：按地图调整 `looseLoot` / `staticLoot` 的物品数量倍率；文本级替换，备份在 `data\backups\loot\<时间戳>\<地图>\`。改完重启服务端，下一场生效。

### AI 规则引擎（NoAIBots）

页面下半部分的「AI 规则引擎」读写服务端 mod `user\mods\NoAIBots\config.json`，用来补上原版没接上的逻辑：**选「无AI」档位时真的不刷 AI**（服务端 4.0 只看难度，不看档位，还会每局无条件注入 PMC 波次）。

- **规则 = 条件 + 动作**：条件是 `地图` / `战局档位` / `客户端关闭首领` 的任意组合（留空=全部），动作 14 个（清空 scav 波、清空刷新点、只清 PMC、只清首领、倍率缩放、上限、延迟刷新、同屏 AI 上限倍率等）。
- **高级：地图刷新参数**（规则卡里展开）：刷新检查间隔、每轮持续/停歇时间、数量步进、开局起止时间、单区域同屏上限、非波次补刷上限、激活/休眠距离、新旧刷新系统开关、Scav 波人数绝对覆盖。留空=保持该地图原版；同一张图多条规则同时命中时，后面的覆盖前面的。
- **输入框灰字直接显示该地图当前原版值**（读 `SPT_Data\database\locations\<图>\base.json`）：勾了几个地图就按那几个图算，只勾一张就显示它自己的数值（比如海关 刷新检查 15s / 激活 265m、灯塔 330m / 单区域 8）；勾多张且数值不同显示「各图不同」。三态开关的第一项也写成「保持原版（开/关）」。灰字只是参考，留空保存时不会写进配置。
- **每条规则下方是一条刷新时间轴**：按「这张地图原版数据 + 本规则」画出 0~30 分钟的 AI 投放节奏——
  - 旧系统轨（蓝）：`waves` 波次。SPT 4.0 的波次时间几乎都是 `-1`，所以显示为「开局整波 ×N」；有具体时间的会画成一段。
  - 新系统轨（绿）：按规则的「检查间隔 / 刷新持续 / 停歇」模拟出一串刷怪窗口，标注每窗口大概补多少只、单区域上限、同屏上限（同屏上限会乘上规则的「上限倍率」，×0 时整条轨变淡）。
  - 首领/PMC 轨：把 `BossLocationSpawn` 的档位画成竖线，下面用图例列出「时间 · PMC 概率」和「首领 概率」；规则里的概率倍率、时间延迟、清空动作都会反映到这条轨上。
- **详细选项默认折叠**：规则卡只显示名称、摘要标签、说明和时间轴，点「详细选项」才展开地图/档位/动作/数值/高级参数；展开状态在同一条规则的编辑过程中保持。
- **内置安装包（不用另外下载 NoAIBots）**：规则引擎卡顶部有一行「内置安装包」——NoAIBots.dll + README 打包进管理器 exe（`assets/bundled/noaibots/`，清单 `assets/bundled/manifest.json` 的 `noaibots` 项），显示内置版本/是否已装/是否旧版，点「安装内置 vX / 更新到 vX / 重新安装内置版本」即可；只替换 dll 和 README，**不会覆盖 `config.json` 里的规则**，覆盖前把旧文件备份到 `data\backups\bundled\<时间戳>_noaibots\`。服务端在运行时按钮会先问「要停服安装吗」，确认后自动 停服 → 安装 → 起服。同一个包也出现在「关于」→ 内置基础模组（分组「AI」）。
- **每条规则单独保存**：规则卡右上角的「保存这条」只写这一条（POST /api/ai/rules/rule），不会把其他卡片里没保存的编辑一起写进配置；顶部「保存规则」仍然是整体保存。
- **设置实时反映到时间轴**：改数值、切开关、加减 PMC 档位时，摘要标签和时间轴会立刻重算（不用等保存）。
- **自定义刷新时间表（PMC / 首领）**（规则卡详细选项内）：每行先选类型——PMC 行填「时间(秒) / 概率(%) / 每队人数」，替换这张图原有的 pmc.json PMC 档位（BossZone 按原区域轮换）；首领行再填首领类型（bossBully / sectantPriest 等，用下拉候选）与可选区域，替换该首领原本的刷新点。mod 侧一律拿本图 base.json 里原有条目整条克隆当模板（BossDifficulty、BossEscortType、SpawnMode、TriggerId 等字段不丢），只覆盖时间/概率/人数/区域；原版没有的首领会被跳过。留空=保持原版。
- **PMC 档案（全局）**（规则列表上方的卡片）：不用写规则就能整局调整 PMC——USEC 占比、等级模式（跟随玩家等级 ±浮动 / 固定区间）、难度（easy~impossible / AsOnline）、血量倍率、18 项常用技能等级、每张地图的等级与 USEC 覆盖。字段旁显示原版值（`pmc.json` / `bots\types\pmcUSEC.json`），保存走 `POST /api/ai/rules/pmc`，**整体替换** `config.json → pmcProfile`（不合并旧值）；保存后下一局生效，不用重启服务端。
- **AI 参数页**（左侧导航）：把 mod 能改的 30 多个参数按「系统开关 / 旧系统 / 新系统 / 首领·PMC / 上限」分组列成表格，逐项给出中文名、默认值、作用说明和「当前被哪条规则使用」；另有 mod 全局开关（总开关 / 生效模式 / 禁止 Bot 生成 / 修复校验陷阱 / 删除日志）和各张地图的原版刷新参数对照表（可直接切图查看）。
- **工具栏有现成模板**：`+ 无AI` / `+ 只清PMC` / `+ 只清首领` / `+ 轻松模式` / `+ 开局静默10分钟`，点一下加规则，再点「保存规则」。
- **预演**：不写文件，按当前配置 + 选定的地图/档位算出「这局还剩几波 AI」，命中哪条规则、同屏上限变成多少，用来验证配置再进游戏。
- **热重载**：保存后不用重启服务端，mod 按文件时间自己重载，下一局开战生效。
- **备份/还原**：每次保存前自动备份到 `data\backups\configs\`，页面底部可下拉选择还原。
- **前提**：mod 必须装在**跑服务端的那台机器**上（远程联机时是你朋友那台）。没装时页面会提示并给出 dll 路径。
- 规则字段、配方和日志排查见 `E:\game\EFT\mods-dev\NoAIBots\README.md`。

## 物品效果

「物品效果」页直接改服务端数据库里的物品模板，想改什么药、什么吃的都行，改前自动备份、改完重启服务端生效（客户端也要重开才会拿到新模板）。

- **找物品**：左侧列表只收「能改数值的物品」（有 `medUseTime` / `foodUseTime` 的，本机 89 个），按中文名 / 英文名 / 模板 ID 搜索。
- **能改什么**（医疗 / 兴奋剂）：总治疗量 `MaxHpResource`、治疗速度 `hpResourceRate`、使用时间 `medUseTime`、生效时机 `medEffectType`（`duringUse` / `afterUse`）、状态效果 `effects_damage.<状态>.{cost,duration,delay,fadeOut}`、Buff 组 `StimulatorBuffs`。
- **食物 / 饮料**：一次消耗量 `MaxResource`、使用时间 `foodUseTime`、能量 / 水分 `effects_health.{Energy,Hydration}.value`、Buff 组。
- **Buff 组编辑器**：读 `globals.json → config.Health.Effects.Stimulator.Buffs`（本机 51 组），每一组显示 7 列（BuffType / 触发概率 / 延迟 / 持续 / 数值 / 技能 / 是否绝对值），可改数值、加删条目后「保存这一组」。`BuffsPropital` 这类组被多个物品共用，改一处所有用它的物品一起变。
- **写的是什么**：`SPT\SPT_Data\database\templates\items.json`（19 MB，只改目标物品那一小段，其余字节不动，保留原文件的 CRLF 换行）和 `globals.json`（1 MB，整份重写、保留 LF + 结尾换行）。
- **备份 / 还原**：每次保存前把原文件复制到 `data\backups\database\`（每类保留最近 6 个），页面底部可下拉还原；还原前会先把备份 JSON 解析一遍，坏了不覆盖。
- **不生效的部分**：动画、手部动作、UI 上的数值说明这类硬编码在 `Assembly-CSharp.dll` 里的东西，改数据库改不动；改 Buff 组要在下一针（或下一次吃东西）才生效。

命令行 / 接口：`GET /api/items?q=&limit=`、`GET /api/items/:id`、`POST /api/items/:id {"patch":{...}}`、`GET /api/buffs`、`POST /api/buffs/:id {"entries":[...]}`、`GET /api/items/backups`、`POST /api/items/restore {"name":...}`。

## 实时窗口

「实时窗口」页把三个窗口分开显示，不用再在任务栏里翻：

- **服务端窗口**：当前服务端状态（运行中 / 未运行 + pid）和它最近 220 行日志。
- **无头主机**：每个无头目录一张卡（只列 `Fika.Headless.dll` 处于启用状态的目录，以及你在 Fika 页手动添加过的目录），显示 `已连接 / 启动中 / 已退出 / 未运行`，卡上直接「启动 / 停止」。
- **NoAIBots 窗口**：从服务端日志里只挑 AI 相关行（`NoAIBots`、`AI 同时存活上限`、`maxCap`、`校验陷阱`、`Validation failed`、`botAmount` 等），不用翻几万行。

页面每 2 秒自动刷新一次，切换页面就停。

**日志框的滚动行为**（避免自动刷新把滚动条顶回去）：

- 正常情况跟着最新一行走，自动滚到底部。
- 鼠标往上滚、拖滚动条或者按住划选文字时，这个框就**暂停刷新**（内容冻结，拖滚动条不会被 2 秒一次的重绘打断）；有新日志时框底出现「↓ 已暂停自动滚动 · 点这里回到最新」。
- 自己把滚动条拖回底部，或者点那个按钮，就恢复跟随并跳到最新。
- 每个框独立判断，服务端窗口暂停不影响无头主机和 NoAIBots 窗口。
- 「服务器」页的「刷新日志」按钮属于手动操作，点了总是拉回最新。

每个日志框都用一样的处理（`makeLogBox()` + `fillLog()`，见 `public/app.js`），滚动条也换成了细的深色样式，更方便拖。

- 「关于」页新增 **NoAIBots（AI 规则引擎）** 卡片：显示版本（从 dll 元数据读取）、安装状态/大小/更新时间、规则条数与启用数、PMC 档案开关、配置文件路径，并提供跳转到「战局 AI」「AI 参数」「战局实测」的按钮。

- 「保存这条」对**新增的规则也生效**：磁盘上还没有这条规则时按「追加」写入；写入前会校验页面与磁盘的规则条数，条数对不上就提示先点「保存规则」整体保存，避免把规则写到错的位置。

## 战局实测

「战局实测」页回答一个问题：**这一局服务端插件到底改了什么，客户端实际刷了多少 AI，两边对得上吗？**

数据直接读两个追加写的日志文件（游戏 / 服务端运行时也能读）：

| 数据 | 来源 | 内容 |
| --- | --- | --- |
| 服务端决策 | `SPT\user\logs\spt\sptYYYYMMDD.log` | 收到战局配置（地图 / 档位 / 首领开关）、命中的规则与动作、地图参数已调整、`AI 生成请求/完成`、`AI 同时存活上限`、校验陷阱修复 |
| 客户端实际 | `<客户端>\BepInEx\LogOutput.log` | `Set max bot cap`（上限改成多少）、`Running old/new spawn system`、每个真正进场的 `Updated <类型> bot <名字> to use: <类型> brain` |

页面分三块：

- **一句话结论**：服务端这局是「原版节奏（无改动）」还是「按规则改过刷新表」，以及地图 / 档位 / 同屏上限 / 进场总数。
- **左右对照**：左边是服务端（命中与动作、地图参数、同屏上限、生成档案池、校验陷阱修复次数）；右边是客户端（Raid Code、上限请求、刷新系统、进场总数、构成：普通 Scav / 玩家 Scav / PMC / 首领 / 随从）。
- **判读提示**：自动列出矛盾点，例如「服务端算出的上限 13，客户端实际拿到 26」「服务端生成了档案池但客户端还没有 bot 进场」。

口径说明：服务端 `AI 生成完成 #N：300 只` 是给客户端**一次性预生成的档案池**，不是同屏数量；同屏上限由 `maxBotCap` 控制，客户端日志里的 brain 行才是一个个真正进场的 bot。

接口：`GET /api/raid/compare`（读 `<SPT>\user\logs\spt` 下最新日志和客户端 `BepInEx\LogOutput.log`，按最后一条「Raid has been started」切最近一局）。

### 客户端插件 RaidProbeClient（此刻存活）

客户端日志只记录「bot 进场那一刻」，统计不到首领、也分不清谁还活着。要看**此刻战局里到底有哪些 AI**，需要客户端插件：

- **插件已打包进 exe**：「战局实测」页顶部「客户端插件：RaidProbeClient」卡片会显示「文件版本 / 运行中版本」，没装或旧版点一下就能装 / 更新（同一份资源也在「关于」→ 内置基础模组里）。
- 插件目录：`<客户端>\BepInEx\plugins\RaidProbe\RaidProbeClient.dll`
- 它挂在 `EFT.BotsController` 上，每 2 秒把当前 `BotOwner` 集合写进 `RaidProbe\live-bots.json`：名字、`WildSpawnType`、阵营、是否存活、坐标。
- 「战局实测」页会多出一张「客户端插件：此刻存活」卡：按类型分组 + 逐只列出（含首领 / 随从 / 已死）。快照超过 15 秒算过期（说明不在战局里）。
- **BepInEx 只在游戏启动时加载插件**：装完 / 更新后必须重启游戏，再进一局才会开始写快照；页面上的「运行中」版本来自插件自己上报的快照。
- Fika 联机 / 无头主机同样可用（每个客户端各写自己那份快照）；Fika 自身不对外暴露存活 AI 列表。

### 局内测试：直接杀 AI（插件 0.3.0）

想验证「新系统的刷新窗口会不会补人」，最直接的办法是进图后把 AI 清空，看下一秒 / 下一个 on 窗口有没有新的进场。

- 管理器：「战局实测」页最下面一张卡「局内测试：直接杀 AI」，三个按钮——杀全部 / 只杀 Scav / 只杀 PMC + 首领。
- 原理：管理器往 `<客户端>\BepInEx\plugins\RaidProbe\command.json` 写一条 `{id, action:"kill", scope}`；插件每 1 秒轮询这个文件，执行完删掉，并写 `command-result.json` 回执（匹配几只 / 杀了几只 / 还剩几只）。页面下个 5 秒轮询就能看到回执和新的存活列表。
- 游戏内也可以用热键，不依赖管理器：`F9` 全杀、`F10` 只杀 Scav、`F11` 只杀 PMC + 首领（可在 `BepInEx\config\com.local.raidprobe.cfg` 改键）。
- 只在本机生效：击杀走 `IHealthController.Kill(EDamageType)`，AI 会正常倒地、掉落，不是凭空移除；Fika 里其他玩家的客户端各自看到同步结果。
- 注意：插件版本必须是 0.3.0 才会轮询指令；旧版（0.1.0 / 0.2.0）只能看快照。页面判读提示会直接写出来。

### 控制台「快速编辑」导致窗口卡住

Windows 控制台的**快速编辑模式**：鼠标只要点一下控制台窗口，进程输出就被冻住，得按回车才恢复。无头主机 / 服务端被这样冻住时，看着就像「卡死」。

管理器启动时会把这个开关关掉（`HKCU\Console\QuickEdit = 0`），日志里会打一行「已关闭控制台『快速编辑』」。注意：

- 只对**新开的**控制台生效，已经开着的窗口要关掉重开。
- 页面上还留了个「切换快速编辑」按钮，想恢复成 Windows 默认就点回去。

## 数据目录

```
data\
  backups\config\     启动器 config / fika.jsonc 等配置备份
  backups\profiles\   存档备份
  backups\replaced\   导入模组时被覆盖的旧文件
  backups\configs\    JSON 配置改写前的备份（AI 规则、bot.json 等，<原名>.<时间戳>.bak）
  backups\loot\       物资刷新前的原始 loot 文件
  backups\database\   物品效果 / 兴奋剂 Buff 改动前的 items.json / globals.json 备份（每类留 6 个）
  exports\            打包导出的安装包
  settings.json       管理器自己的设置（SPT 根目录、端口、无头目录）
```

## 常见问题

**点「启动游戏客户端」提示「游戏或启动器已经在运行了」**
管理器按可执行文件所在目录判断：只有当前 SPT 目录下的那份 `EscapeFromTarkov.exe` 才算，别的副本（比如无头目录）不会挡住启动。

**启动器点「开始游戏」没反应**
看 `SPT\user\logs\launcher.log` 里有没有 `Core dll mismatch :: FAILED`。那就是 `GamePath` 指到了 `SPT\` 子目录，去「游戏客户端」页点「一键修复」。

**启动器点开始游戏闪退 / 日志里 `BattlEye environment validation failed`**
SPT 启动器那条链路会做客户端文件校验，校验不过就直接退出。用「游戏客户端」页的**直接启动**（`-token` + `-config` 拉起游戏本体）可以绕过它。

**改完物资 / AI / 物品效果要不要重启服务端？**
要。管理器只改文件，服务端启动时才读数据库（NoAIBots 规则是例外，mod 自己热重载）。

**服务端启动时刷一屏 `验证文件 ... 失败`**
SPT 用 `SPT_Data\checks.dat` 做文件完整性自检。改过地图 loot（物资刷新、手改、旧版工具）后哈希必然对不上，只是 `Warn` 级，服务端照常启动、游戏照常进。想消掉：物资刷新页还原备份，或从原版安装包抽对应 `looseLoot.json` / `staticLoot.json` 覆盖。

**装了 WTT-ContentBackport 后服务端起不来 / 报 `Could not load file or assembly 'WTT-ServerCommonLib, Version=2.0.0.0'`**
回灌包 1.0.7 要 WTT-CommonLib **2.0.20**，和旧的 2.0.15 不兼容。用「导入模组」装 `WTT-CommonLib-v2.0.20.zip` 覆盖即可，装完服务端日志里能看到 `[mcaddweapon.AddWeapon] Loading: Marlin MXLR ...`。

**模组显示旧版本**
版本优先读 DLL 元数据；日志里的加载行只作兜底。读不到元数据时才可能显示旧值，重新「刷新」一次即可。

**同名模组装不上**
默认拒绝覆盖。勾「覆盖同名模组」再装（旧目录会先备份）。

**服务端刷 `No C#type for taxonomy node with id … LoadAmmoBundleItem`，有人进不去游戏**

这类报错来自「客户端装的 mod 往服务端塞了它不认识的物品类型」，不是管理器的问题。`LoadAmmoBundleItem` 是 `LoadAmmoAnim` 客户端插件里的节点，服务端没有对应的 C# 类型时 `/client/items` 就会报它。处理顺序：

1. 把那个客户端插件停用（模组管理 → 禁用），确认能进游戏；
2. 找该 mod 的**同版本服务端部分**一起装（版本不匹配就会这样）；
3. 仍然报就换回落后的稳定版本。

管理器的「关于」页装 Fika 三件套不会引起这类错误——它只装 Project Fika 官方组件。

## 开发备注

- 后端：`server.js`（HTTP 路由 + 静态文件）、`lib\` 下按功能拆：`archive.js`（7z 解压 / 列表 / 分析包结构）、`mods.js`（扫描模组、版本、启停）、`dllmeta.js`（读 DLL 元数据）、`fika.js`（fika.jsonc / com.fika.core.cfg / 无头）、`launch.js`（启动器配置、直接启动、存档 API、进程管理）、`game.js`（服务端启停、存档、备份、物资/AI）、`pack.js`（打包导出）、`jsonc.js`（保留注释的 JSONC 读写）、`bundled.js`（内置模组的清单 / 安装 / 备份）。
- 前端：`public\index.html` + `public\app.js`（原生 DOM，无框架）+ `public\styles.css`。改完 JS 记得把 `index.html` 里的 `app.js?v=N` 加一，避免浏览器缓存。
- PowerShell 5.1 读写带中文的文件必须显式 `-Encoding UTF8`（默认 GBK 会乱码），写 JSON 配置要用无 BOM 的 `UTF8Encoding($false)`。
- SPT 服务端 API 的请求体和响应体都是 zlib deflate，`lib\launch.js` 里已经封装好。
- 内置模组资源在 `assets\bundled\`：`manifest.json` 描述每个模组装到客户端哪里；`build\build-exe.mjs` 打包时内联成 `build\embedded-bundled.js`（node 直接运行读磁盘，只有 exe 才用内联）。

## 测试

全部用临时目录 / 假数据，不碰真实存档和客户端：

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
node tests\bundled-test.js
node tests\items-test.js
node tests\raidprobe-test.js
```

- **时间轴会区分「PMC 行」和「首领行」**：自定义时间表里的 oss 行画在首领轨上，PMC 行画在 PMC 轨上；
  如果首领行写的首领在这张图原版数据里不存在，图例标「⚠ 该图没有」并画成虚线（mod 会跳过这条，日志也会说明）。
- **时间轴会体现新旧系统开关和 botStop**：规则里 oldSpawn=false → 旧系统轨显示「旧系统已关闭」；`botStop` 小于 `botStart` → 新系统轨显示「没有刷怪窗口」；摘要标签也会加「关旧系统 / 关新系统 / 停止刷 Ns」。

### 新系统存活上限（BotMax）

- 「高级：地图刷新参数」新增 `BotMax`，直接写进该地图的 `Location.BotMax`（客户端显示的同屏上限）。
- 新刷新系统每次补刷按 `BotMax − 当前存活` 算名额，所以想压 scav / 给 PMC 小队留位置时，改它最直接；
  `maxBotPerZone` 只作用于按区域的刷怪路径，管不住新系统的成波补刷（`ActivateBotsWithoutWave`）。
- 灰字提示显示的是服务端 `maxBotCap`（bot.json）覆盖后的实际值，不是 `base.json` 里的旧值。
- 内置安装包里的 NoAIBots 同步升到 1.5.3。
