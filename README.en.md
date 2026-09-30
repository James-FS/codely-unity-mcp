# Codely Unity MCP

**Connect AI agents that support MCP stdio to the Codely Bridge in Tuanjie Editor, so they can inspect project state and perform editor operations through a common tool interface.**

This project exposes Tuanjie Bridge capabilities as an MCP server for different agents and AI clients. Clients that support configuring local MCP stdio servers can use the adapter without implementing their own Bridge connection code. Compatibility depends on each client's MCP support.

Connected agents can inspect editor and scene state, manage GameObjects and assets, execute C# snippets, read Console messages, and invoke screenshot tools to assist development, automate editor tasks, and investigate problems. Users must install and start Codely Bridge in their own projects; this project provides the connection between the agent and that Bridge.

```text
MCP-capable agent / AI client
            ↓ MCP stdio
      Codely Unity MCP (this project)
            ↓ local TCP
      Codely Bridge in the Tuanjie project
            ↓
         Tuanjie Editor
```

The adapter has no third-party Node.js dependencies and does not include the editor plugin. Regular Unity compatibility has not been verified; requirements and the validation scope are described below.

## Requirements

- Node.js 20 or later.
- Install Codely Bridge in the target project, then keep the editor open and Bridge connected.
- The target project must contain an `Assets` directory. The Bridge's official distribution channel and redistribution terms have not been verified; this repository does not bundle it.

This version passed a read-only end-to-end check (bridge_status and manage_editor get_state) with a Tuanjie project and Bridge 1.0.81, as well as protocol tests against a mock Bridge. During the real-editor check, the editor was in Edit Mode and was not playing, compiling, or updating. Regular Unity and other Bridge versions have not been verified.

## Run with npm

With Node.js installed, configure your MCP client as follows. `npx` downloads the pinned version automatically:

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

Replace the project path with your own. If a Windows client cannot locate `npx`, try `npx.cmd` or its absolute path. Diagnose the connection with:

```powershell
npx -y --package=codely-unity-mcp@1.0.0 codely-unity-doctor --project "D:\MyUnityProject"
```

## Download and configure

Download and extract the ZIP from GitHub Releases. Configure your MCP client with the absolute paths to the server and project:

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

Alternatively set `CODELY_UNITY_PROJECT` in `env`. The `--project` argument takes precedence. The adapter reads handshake files only from the selected project; it never guesses a project from the current working directory.

## Diagnose the connection

Run from the extracted folder:

```powershell
node .\scripts\doctor.mjs --project "D:\MyUnityProject"
```

Doctor reads the project and handshake files and performs a TCP handshake, then closes the socket without sending editor commands. Restart the MCP client and call `bridge_status` after the checks succeed.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `CODELY_UNITY_PROJECT` | none | Project root; alternatively pass `--project` |
| `CODELY_UNITY_HOST` | `127.0.0.1` | Bridge host |
| `CODELY_UNITY_PORT` | auto-detected | Override the TCP port from the handshake file |
| `CODELY_UNITY_TIMEOUT_MS` | `60000` | Bridge request timeout |
| `CODELY_UNITY_CONNECT_TIMEOUT_MS` | `5000` | TCP connect and handshake timeout |

The adapter checks the configured port before each request and reconnects if the editor restarts on a new port.

## Tools

`bridge_status`, `send_raw`, `execute_csharp`, `manage_gameobject`, `manage_scene`, `manage_asset`, `manage_editor`, `manage_gameview`, `execute_menu_item`, `read_console`, `screenshot`, and `manage_job`.

Standard output is reserved for JSON-RPC messages; diagnostics go to standard error.

## Companion agent skill

The included [`codely-unity` skill](skills/codely-unity/SKILL.md) guides agents through Bridge and editor state checks, Play Mode write protection, Console verification, and C# execution constraints. It includes [C# examples](skills/codely-unity/references/csharp-examples.md) and contains no game-specific paths or project memory.

The skill is included in the GitHub repository, Release ZIP, and npm package under `skills/codely-unity/`. **Configuring MCP or starting the server with `npx` does not automatically install the skill.** MCP provides the tool interface; the skill provides instructions for using those tools.

To install:

1. Download the Release ZIP or clone this repository to obtain `skills/codely-unity/`.
2. Copy the entire `codely-unity` folder into your agent's supported skills directory, preserving `SKILL.md` and the `references/` folder structure.
3. Reload skills using your agent's loading procedure and use this skill before operating the editor.

Skill locations and loading procedures vary by agent. If your client does not support skills, ask the agent to read `SKILL.md` before calling MCP tools and consult the referenced C# examples as needed. The skill is recommended guidance; the MCP server does not require it to be installed.

## License

The adapter code in this repository is released under the MIT License; see [`LICENSE`](LICENSE). Codely Bridge is a separate third-party editor component. Its official distribution channel and redistribution terms have not been verified, so it is not bundled here.

For a read-only integration check against an open editor, run `npm run test:integration -- --project "D:\MyUnityProject"`.
