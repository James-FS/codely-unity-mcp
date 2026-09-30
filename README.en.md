# Codely Unity MCP

An MCP adapter for the Codely Bridge in Unity / Tuanjie Editor. It forwards MCP stdio messages to the local Bridge TCP service. It has no third-party Node.js dependencies and does not include the editor plugin.

## Requirements

- Node.js 20 or later.
- Install Codely Bridge in the target project, then keep the editor open and Bridge connected.
- The target project must contain an `Assets` directory. The Bridge's official distribution channel and redistribution terms have not been verified; this repository does not bundle it.

This version passed a read-only end-to-end check (bridge_status and manage_editor get_state) with a Tuanjie project and Bridge 1.0.81, as well as protocol tests against a mock Bridge. During the real-editor check, the editor was in Edit Mode and was not playing, compiling, or updating. Regular Unity and other Bridge versions have not been verified.

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

See [`skills/codely-unity/SKILL.md`](skills/codely-unity/SKILL.md) for a general operation guide and C# examples. Standard output is reserved for JSON-RPC messages; diagnostics go to standard error.

## License

The adapter code in this repository is released under the MIT License; see [`LICENSE`](LICENSE). Codely Bridge is a separate third-party editor component. Its official distribution channel and redistribution terms have not been verified, so it is not bundled here.

For a read-only integration check against an open editor, run `npm run test:integration -- --project "D:\MyUnityProject"`.
