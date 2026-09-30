# Codely Unity MCP

**让支持 MCP stdio 的 AI Agent 通过统一的工具接口连接团结编辑器中的 Codely Bridge，读取工程状态并执行编辑器操作。**

本项目把团结 Bridge 的能力封装成 MCP 服务，方便接入不同的 Agent 和 AI 客户端。只要客户端支持配置本地 MCP stdio 服务，就可以使用本适配器，无需为每个 Agent 单独编写 Bridge 连接代码。具体兼容性以客户端的 MCP 支持情况为准。

连接后，Agent 可以查询编辑器和场景状态、管理 GameObject 与资产、执行 C# 片段、读取 Console，以及调用截图等工具，用于辅助开发、自动化编辑和问题排查。使用者仍需在自己的工程中安装并启动 Codely Bridge；本项目提供 Agent 到 Bridge 的连接入口。

```text
支持 MCP 的 Agent / AI 客户端
            ↓ MCP stdio
      Codely Unity MCP（本项目）
            ↓ 本机 TCP
      团结工程中的 Codely Bridge
            ↓
         团结编辑器
```

适配器不包含编辑器插件，也不需要第三方 Node.js 依赖。普通 Unity 的兼容性尚未验证，具体要求和验证范围见下文。

## 使用前准备

- Node.js 20 或更新版本。
- 在目标工程中安装 Codely Bridge，并保持 Unity / 团结编辑器打开且 Bridge 已连接。
- 目标工程需要含 `Assets` 目录。Bridge 的安装来源及再分发许可尚未核实；本项目不打包 Bridge。

此版本已在团结工程与 Bridge 1.0.81 上通过只读端到端验证（bridge_status、manage_editor get_state），并通过模拟 Bridge 的协议测试。验证时编辑器处于 Edit Mode，未在 Play、编译或更新中；普通 Unity 及其他 Bridge 版本尚未验证。

## 通过 npm 运行

安装 Node.js 后，可在 MCP 客户端中使用以下配置，`npx` 会自动下载固定版本：

```json
{
  "mcpServers": {
    "codely-unity": {
      "command": "npx",
      "args": ["-y", "codely-unity-mcp@1.0.0", "--project", "D:/MyUnityProject"]
    }
  }
}
```

将工程路径替换为自己的目录。若 Windows 客户端无法找到 `npx`，可尝试 `npx.cmd` 或配置其绝对路径。连接诊断命令：

```powershell
npx -y --package=codely-unity-mcp@1.0.0 codely-unity-doctor --project "D:\MyUnityProject"
```

## 下载运行

从 GitHub Releases 下载 ZIP 并解压。确认工程内存在 `Temp/.com-unity-codely.json` 或根目录下的 `.com-unity-codely.json`，然后配置 MCP 客户端：

```json
{
  "mcpServers": {
    "codely-unity": {
      "command": "node",
      "args": ["C:/Tools/codely-unity-mcp/server.mjs", "--project", "D:/MyUnityProject"],
      "env": {
        "CODELY_UNITY_HOST": "127.0.0.1"
      }
    }
  }
}
```

Windows 路径可写为 `D:\\MyUnityProject`。也可以用环境变量传项目路径：

```json
"env": { "CODELY_UNITY_PROJECT": "D:\\MyUnityProject" }
```

命令行 `--project` 优先于 `CODELY_UNITY_PROJECT`。适配器只读取指定工程的握手文件，不会从其他工作目录猜测工程。

## 检查连接

在解压目录运行：

```powershell
node .\scripts\doctor.mjs --project "D:\MyUnityProject"
```

Doctor 只读取工程目录和握手文件，并尝试 TCP 握手后立即断开；它不会向编辑器发送操作命令。成功时 MCP 客户端重启后即可调用 `bridge_status`，再读取编辑器状态。

## 端口和超时

| 设置 | 默认值 | 说明 |
|---|---|---|
| `CODELY_UNITY_PROJECT` | 无 | 目标工程根目录；也可用 `--project` |
| `CODELY_UNITY_HOST` | `127.0.0.1` | Bridge 主机 |
| `CODELY_UNITY_PORT` | 自动发现 | 手动覆盖握手文件中的 TCP 端口 |
| `CODELY_UNITY_TIMEOUT_MS` | `60000` | Bridge 请求超时 |
| `CODELY_UNITY_CONNECT_TIMEOUT_MS` | `5000` | TCP 连接和握手超时 |

适配器每次发出命令前检查端口；编辑器重启并变更端口后，会重新连接。

## MCP 工具

`bridge_status`、`send_raw`、`execute_csharp`、`manage_gameobject`、`manage_scene`、`manage_asset`、`manage_editor`、`manage_gameview`、`execute_menu_item`、`read_console`、`screenshot`、`manage_job`。

MCP 标准输出仅发送 JSON-RPC 消息，任何诊断信息写入标准错误。

## 配套 Agent skill

本项目附带 [`codely-unity` skill](skills/codely-unity/SKILL.md)，用于指导 Agent 正确调用 Bridge 工具，内容包括连接和编辑器状态检查、Play Mode 写保护、Console 验证流程以及 C# 执行约束。[C# 示例](skills/codely-unity/references/csharp-examples.md)也随 skill 提供。它是通用版本，不包含特定游戏工程的路径或项目记忆。

skill 已包含在 GitHub 仓库、Release ZIP 和 npm 包的 `skills/codely-unity/` 目录中。**配置 MCP 或通过 `npx` 启动服务不会自动安装 skill**；MCP 提供工具接口，skill 提供 Agent 使用这些工具的操作指引。

安装方式：

1. 下载 Release ZIP 或克隆本仓库，取得 `skills/codely-unity/`。
2. 将整个 `codely-unity` 文件夹复制到所用 Agent 支持的技能目录，保留 `SKILL.md` 和 `references/` 的相对结构。
3. 按该 Agent 的技能加载方式重新加载，并在操作编辑器前使用此 skill。

技能目录和加载方式因 Agent 而异。若客户端不支持 skills，也可以让 Agent 在调用 MCP 工具前读取 `SKILL.md`，需要 C# 示例时再读取引用文档。skill 是推荐的配套指引，MCP 服务本身不依赖安装它。

## 开发检查

```powershell
npm test
node --check .\server.mjs
```

冒烟检查不需要运行 Unity。要对已打开并连接 Bridge 的工程执行只读集成检查：

```powershell
npm run test:integration -- --project "D:\MyUnityProject"
```

## 许可

本仓库中的适配器代码按 MIT 许可证发布，见 [`LICENSE`](LICENSE)。Codely Bridge 是独立的第三方编辑器组件，不属于本仓库；它的官方安装来源及再分发许可尚未核实，因此不随本项目打包。
