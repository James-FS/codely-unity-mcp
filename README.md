# Codely Unity MCP

**让 AI Agent 直接参与团结编辑器里的游戏开发。**

[English](README.en.md) · [npm](https://www.npmjs.com/package/codely-unity-mcp) · [下载最新版](https://github.com/James-FS/codely-unity-mcp/releases/latest) · [反馈问题](https://github.com/James-FS/codely-unity-mcp/issues)

游戏开发不只是写代码。创建 GameObject、调整组件参数、管理场景和资源、查看 Console，都需要和编辑器打交道。

Codely Unity MCP 是一个开源的 **MCP 适配器**：复用团结引擎 Codely Bridge 的编辑器通信能力，把它接入支持本地 MCP stdio 的 AI Agent。让 AI 在写代码之外，也能读取工程状态、执行编辑器操作并检查结果。

## 一个 MCP，连接多种 AI Agent

![Codely Unity MCP 架构：AI Agent 通过 MCP stdio 和本机 TCP 连接编辑器中的 Codely Bridge](https://raw.githubusercontent.com/James-FS/codely-unity-mcp/main/docs/images/architecture.png)

只要客户端支持配置本地 MCP stdio 服务，就可以使用这套接口，无需为每个 Agent 单独编写 Bridge 连接代码。图中的 Codex、ZCode、DSH 是接入方式的示意，具体兼容性以客户端实际支持为准。

## 为什么复用 Codely Bridge？

Codely 已经提供了编辑器通信能力，这个项目专注于把这些能力接入 MCP。对于已经安装 Bridge 的工程，不需要为了本适配器再安装另一套自建的编辑器通信插件。

![自建编辑器通信插件与复用 Codely Bridge 的架构对比](https://raw.githubusercontent.com/James-FS/codely-unity-mcp/main/docs/images/bridge-comparison.png)

| 特点 | 使用体验 |
|---|---|
| 复用现有 Bridge | 通过工程中的 Codely Bridge 执行编辑器操作 |
| 自动发现端口 | 从指定工程的握手文件读取 TCP 端口，无需手动填写 |
| 端口变化后重新连接 | 编辑器重启后，后续请求可以重新发现端口并连接 |
| Doctor 连接诊断 | 检查工程路径、握手文件和 TCP 握手，帮助定位连接问题 |
| MCP + Agent Skill | MCP 提供工具，Skill 指导 Agent 检查状态和验证操作结果 |
| 轻量运行 | Node.js stdio 服务，无第三方 Node.js 依赖 |

架构对比用于解释连接方式；不同 Unity MCP 的实现可能不同，本项目没有进行跨项目的稳定性或性能比较。

## 能做什么？

项目提供 **12 个 MCP 工具**，覆盖以下工作：

| 工作 | 工具 |
|---|---|
| 检查连接与编辑器状态，控制 Play / Stop | `bridge_status`、`manage_editor` |
| 查询、创建、修改 GameObject，管理组件及属性 | `manage_gameobject` |
| 查询、创建、加载和保存场景 | `manage_scene` |
| 查找、创建、移动和修改资源 | `manage_asset` |
| 执行编辑器或运行时 C# 片段 | `execute_csharp` |
| 读取、清理 Console，辅助定位错误 | `read_console` |
| 调用截图及 Bridge 支持的录制操作 | `screenshot` |
| 管理 Game View、执行菜单命令 | `manage_gameview`、`execute_menu_item` |
| 查询和管理 Bridge 异步任务 | `manage_job` |
| 转发其他 Bridge 命令 | `send_raw` |

具体动作受安装的 Bridge 版本、编辑器状态和写保护限制。适配器提供接口，实际执行能力由编辑器中的 Bridge 提供。

下面是一次使用示例：让 Agent 检查 Player 是否重复挂载组件，结合编辑器查询和 C# 检查给出结论。

![Agent 通过 Codely Unity 工具检查 Player 组件的使用示例](https://raw.githubusercontent.com/James-FS/codely-unity-mcp/main/docs/images/agent-inspection-example.png)

## 快速开始：让 AI 帮你安装

先准备好：

- **Node.js 20 或更新版本。**
- 目标团结工程中已安装 Codely Bridge，编辑器保持打开，Bridge 已就绪。
- 工程路径是包含 `Assets` 的根目录。

复制下面这段提示词，替换工程路径后发送给你的 Agent：

> 帮我安装并配置这个 MCP：https://github.com/James-FS/codely-unity-mcp
>
> 我的团结工程位于 `<包含 Assets 的工程根目录>`。请阅读 README，优先使用 npm/npx，按当前客户端支持的方式配置 MCP，并验证 Codely Bridge 连接。也请安装仓库里的 `skills/codely-unity`；如果当前 Agent 不支持 Skill，请在操作前读取它的 SKILL.md。

MCP 配置格式、技能目录和重新加载方式因客户端而异。需要手动配置时，使用下面的示例。

### 通过 npm / npx 运行

在 MCP 客户端中配置服务，`npx` 会下载固定版本：

```json
{
  "mcpServers": {
    "codely-unity": {
      "command": "npx",
      "args": ["-y", "codely-unity-mcp@1.0.1", "--project", "D:/MyUnityProject"]
    }
  }
}
```

将 `D:/MyUnityProject` 替换为实际工程根目录。Windows 客户端找不到 `npx` 时，可尝试 `npx.cmd` 或填写绝对路径。配置完成后重新加载 MCP 服务。

用 Doctor 检查连接：

```powershell
npx -y --package=codely-unity-mcp@1.0.1 codely-unity-doctor --project "D:\MyUnityProject"
```

Doctor 只读取工程目录和握手文件，尝试 TCP 握手后立即断开，不向编辑器发送操作命令。通过后，让 Agent 调用 `bridge_status`，再调用 `manage_editor action=get_state` 确认目标工程和编辑器状态。

### 下载 ZIP 或使用源码

从 [GitHub Releases](https://github.com/James-FS/codely-unity-mcp/releases/latest) 下载 ZIP 并解压，或克隆仓库。然后配置 MCP 客户端：

```json
{
  "mcpServers": {
    "codely-unity": {
      "command": "node",
      "args": ["C:/Tools/codely-unity-mcp/server.mjs", "--project", "D:/MyUnityProject"],
      "env": { "CODELY_UNITY_HOST": "127.0.0.1" }
    }
  }
}
```

也可通过环境变量传项目路径：

```json
"env": { "CODELY_UNITY_PROJECT": "D:\\MyUnityProject" }
```

`--project` 优先于 `CODELY_UNITY_PROJECT`。适配器只读取指定工程的握手文件，不会从其他工作目录猜测工程。

在源码或解压目录检查连接：

```powershell
node .\scripts\doctor.mjs --project "D:\MyUnityProject"
```

## 配套 Agent Skill

[MCP 工具](#能做什么)负责提供操作能力，[`codely-unity` Skill](skills/codely-unity/SKILL.md)负责指导 Agent 使用这些工具：操作前检查连接、Play 和编译状态，遵守写保护，操作后读取 Console 并验证结果。

Skill 包含 [C# 示例](skills/codely-unity/references/csharp-examples.md)和[原生串流 / DataChannel 排障](skills/codely-unity/references/native-streaming.md)。它是通用指引，项目专用路径和玩法约定应放在各自工程的说明中。

**通过 npx 启动 MCP 不会自动安装 Skill。** GitHub 仓库、Release ZIP 和 npm 包均包含 `skills/codely-unity/`：

1. 取得整个 `codely-unity` 文件夹，复制到 Agent 支持的技能目录。
2. 保留 `SKILL.md` 和 `references/` 的相对结构，按客户端要求重新加载。
3. 操作编辑器前使用该 Skill。客户端不支持技能时，也可以让 Agent 先读取 `SKILL.md`。

## 连接配置与排障

| 设置 | 默认值 | 说明 |
|---|---|---|
| `CODELY_UNITY_PROJECT` | 无 | 目标工程根目录，也可用 `--project` |
| `CODELY_UNITY_HOST` | `127.0.0.1` | Bridge 主机 |
| `CODELY_UNITY_PORT` | 自动发现 | 手动覆盖握手文件中的 TCP 端口 |
| `CODELY_UNITY_TIMEOUT_MS` | `60000` | Bridge 请求超时，毫秒 |
| `CODELY_UNITY_CONNECT_TIMEOUT_MS` | `5000` | TCP 连接和握手超时，毫秒 |

适配器从 `Temp/.com-unity-codely.json` 或工程根目录的 `.com-unity-codely.json` 读取连接信息。编辑器重启、端口变化后，会在后续请求中重新发现并连接。

| 现象 | 先检查 |
|---|---|
| 找不到工程或握手文件 | 路径是否指向包含 `Assets` 的工程根目录，Bridge 是否安装并启动 |
| TCP 连接失败 | 编辑器是否打开；先运行 Doctor 检查握手 |
| Play 中写入被拒 | 读取编辑器状态，需要修改场景和资产时先停止 Play |
| `SendDataChannelMessage REJECTED` | 查看[串流排障参考](skills/codely-unity/references/native-streaming.md)，区分浏览器串流与 MCP/TCP 操作 |

<details>
<summary>Bridge 协议与手动探测</summary>

连接先读取 `WELCOME ... FRAMING=1` 握手行；后续使用 8 字节大端长度头和 UTF-8 JSON 帧。在已检查的 Bridge 构建中，发送 `CLIENT_VERSION=` 明文行会导致连接重置，不应混入已进入帧模式的连接。

`probe.mjs` 是手动 TCP 探测脚本，端口固定为 `5710`；仅适用于实际监听该端口的 Bridge。日常诊断优先使用支持工程路径参数的 Doctor。

MCP 标准输出仅发送 JSON-RPC 消息，诊断信息写入标准错误。

</details>

## 验证范围

MCP 适配器已在团结 2022.3.62t13、Bridge 1.0.81 上通过只读端到端检查（`bridge_status`、`manage_editor get_state`），并通过模拟 Bridge 的协议、握手失败、连接拒绝和端口变化重连测试。

Polarity 工程中的 Bridge 1.0.86 串流修复另有直接 TCP 验证记录；它不等同于该版本通过本 MCP 服务的完整兼容性测试。普通 Unity 兼容性及不同客户端、Bridge 版本的全部动作尚未验证，请以实际工具返回和工程检查为准。

## 开发与反馈

```powershell
npm test
node --check .\server.mjs
```

冒烟测试不需要启动编辑器。对已打开且 Bridge 就绪的工程执行只读集成检查：

```powershell
npm run test:integration -- --project "D:\MyUnityProject"
```

欢迎通过 [Issue](https://github.com/James-FS/codely-unity-mcp/issues)反馈 Bug、分享客户端配置和使用经验，也欢迎提交改进。如果它帮到了你的游戏开发，欢迎给项目一个 Star。

## 许可

本仓库的适配器代码按 [MIT 许可证](LICENSE)发布。Codely Bridge 是独立的编辑器组件，不随本项目打包；其安装与使用应遵循提供方说明和许可。本项目不代表团结或 Codely 官方。
