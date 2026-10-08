# Native streaming / DataChannel warnings

Read this reference when Console reports `Codely Bridge: [NWB-C++] SendDataChannelMessage REJECTED`, especially after editor window changes, script compilation, or Play transitions.

## Identify the failing connection

The MCP service forwards commands over TCP to the editor Bridge. Native browser streaming uses a separate WebRTC connection: video tracks carry images; DataChannel carries window notifications, progress, and interaction messages. Streaming is not the same as saving a recording.

A rejection alone does not identify its cause. Inspect the editor log for the adjacent native diagnostic. `SendDataChannelMessage rejected: dataChannel=null` confirms that no DataChannel exists at that send attempt. Do not infer TCP command failure, a firewall problem, or a bad MCP installation path from this warning. Verify TCP separately with `bridge_status` and `manage_editor action=get_state`.

Typical editor logs are under `%LOCALAPPDATA%/Tuanjie/Editor/` or `%LOCALAPPDATA%/Unity/Editor/`. Search narrowly for `NWB-WebRTC`, `dataChannel=null`, and `REJECTED`; avoid dumping entire logs, which can contain credentials.

Window-list notifications contain `{"type":"editor_windows_changed"}` (33 UTF-8 bytes). The 33-byte length is a useful clue, but use the surrounding diagnostic and call stack to confirm the source.

## Check versions and logging before changing anything

Compare the installed editor packages and native DLL hashes, not just the MCP server copies. In the observed Bridge 1.0.81/1.0.86 comparison, NativeWindowBridge.dll and datachannel.dll were identical and both projects logged native rejections. CodelyLogger changed from logging disabled by default (1.0.81) to warnings and errors by default (1.0.86), subject to persisted preferences. A quiet Console therefore does not prove an older version avoided the rejection. Treat this as evidence from those versions, not a guarantee about other releases.

## Choose a remedy that fits the workflow

First establish whether the project needs browser live preview and interaction.

- For a TCP/MCP-only workflow, a project-scoped native streaming auto-start switch can default to off. It must leave TCP startup and normal warning/error logging intact.
- For browser streaming, retain startup and fix connection readiness handling. Notifications should be skipped or coalesced until a receiver is ready. Do not invent an existing readiness API: the inspected native C# interface did not expose a direct DataChannel-open query, so a complete implementation may require native source changes.
- `AI > Logging > Off` hides all Bridge logs; it is a visibility workaround, not a repair.

A temporary stop can be sent through `send_raw`:

```json
{"type":"manage_window_bridge","params":{"action":"stop_stream_server"}}
```

Read status with `get_stream_server_status` (not `get_stream_status`). The editor can auto-start streaming again after a domain reload, so one stop is not a persistent fix. Stopping streaming also affects browser clients sharing that editor.

## Persistent TCP-only repair: verified Polarity example

Polarity embedded Bridge 1.0.86 under `Packages/cn.tuanjie.codely.bridge`; the editor package manager resolved it as Embedded. Do not patch Library/PackageCache as the maintained solution: package refreshes can overwrite it.

Two changes were made:

1. `Editor/Bridge/Tools/ManageWindowBridge.cs`: add a project-path-scoped EditorPrefs auto-start option, default false. Expose `AI > Streaming > Auto Start Native Streaming`. Check the option inside AutoStartStreamServer, including delayed retries. Disabling the option calls StopStreamServer, which unregisters window-change tracking and stops the native server.
2. `Editor/Bridge/Native/NativeWindowBridgeHost.cs`: inside SendDataChannelMessage, return false before the native send if IsRunning() is false. Reload and compilation callbacks also send messages, so gating only window notifications is insufficient.

These menu items and the AutoStartNativeStreamingEnabled property are local additions, not upstream APIs. Explicit start_stream_server remains available. A manually started server without a browser receiver may still warn: the stopped-server guard is not a complete DataChannel readiness fix.

Keep an embedded-package patch note with the upstream version and changed files. Review/reapply the patch when updating the vendor package. Skill documentation records the method; it does not apply the code to another project or change the MCP service.

## Verify without losing user work

Before package resolution/recompilation, inspect Play mode and dirty scenes. Preserve user changes and avoid restarting or reloading scenes with unsaved work. Verify the resolved package path/source after resolution; a successful AssetDatabase refresh alone does not prove the new package is active. The TCP port may change after reload; reread the handshake instead of reusing a cached port.

Once the patched package is loaded, clear Console, trigger compilation, reconnect, and read state/status/Console. With safe scene save boundaries, enter and exit Play and verify TCP commands still respond and streaming remains stopped. Attribute a final old-package reload warning to its original call stack rather than claiming the patched code emitted it.

Polarity verification on 2026-10-08: embedded package loaded; auto-start false; stream running false; subsequent compilation returned 0 errors/0 warnings; TCP state and C# execution succeeded; Play entry/exit succeeded; final Console had 0 entries. Editor restart and browser streaming were not tested. Record those limitations rather than marking them passed.
