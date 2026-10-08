---
name: codely-unity
description: General operating guide for Unity or Tuanjie Editor through the Codely Unity MCP. Use before calling editor, scene, GameObject, asset, C# execution, console, screenshot, or job tools.
---

# Codely Unity editor workflow

Use this guide when operating an editor through the Codely Unity MCP. It contains general safety and verification rules; project-specific conventions should be documented separately by each project.

## Before changes

1. Call `bridge_status`; continue only when `unity_port` is positive and the bridge is ready.
2. Call `manage_editor` with `action=get_state` and check play mode, compilation, active scene, dirty state, and write guard.
3. Play Mode is write-protected by default. Stop Play Mode before editing scenes or assets if the bridge reports a write guard.
4. Clear Console before a change whose errors need to be attributed, perform the change, then read Console.

## Tool mapping

| Task | MCP tool |
|---|---|
| Bridge state | `bridge_status` |
| Editor state and controls | `manage_editor` |
| Scene hierarchy and save/load | `manage_scene` |
| GameObjects and components | `manage_gameobject` |
| Project assets | `manage_asset` |
| C# editor/runtime snippets | `execute_csharp` |
| Console | `read_console` |
| Menu commands | `execute_menu_item` |
| Game view settings | `manage_gameview` |
| Screenshots | `screenshot` |
| Long-running Bridge jobs | `manage_job` |

## Editing and verification

- Prefer idempotent `ensure` operations and batch edits where available. Read back the resulting state before repeating a write.
- Save at meaningful boundaries: before entering Play Mode, after a large batch of edits, and before reporting completion.
- After a batch of editor changes, refresh once, inspect the returned errors and Console, then read back hierarchy, components, properties, or asset metadata.
- Use structured editor state as the primary evidence. Take screenshots only when the visual result itself needs review.
- For runtime behavior, drive the behavior through game APIs and return structured values when possible. Do not infer behavior from a static screenshot.

## C# execution constraints

- Do not use blocking calls such as `Thread.Sleep`, `.Wait()`, `.Result`, `SpinWait`, or busy loops.
- Top-level `await` and `yield return` are not supported. Put asynchronous work in a local `async Task<T>` method and return its task; put coroutine work in a local `IEnumerator` method and return its enumerator.
- `IEnumerator` execution does not produce a structured return value; use `Task<T>` when a result is needed.
- Code inside `Task.Run` must not call Unity APIs. After `await`, Unity's synchronization context normally resumes on the editor thread.
- Use editor APIs only in editor execution mode and runtime APIs only in Play execution mode.

## Examples

See [C# examples](references/csharp-examples.md) for short, project-independent snippets.

## Bridge streaming warnings

For `SendDataChannelMessage REJECTED` or `dataChannel=null`, read [Native streaming troubleshooting](references/native-streaming.md). Distinguish browser streaming from MCP/TCP command transport, check actual log evidence, and choose a remedy based on whether browser streaming is needed. The reference includes the verified Polarity repair and its limitations.
