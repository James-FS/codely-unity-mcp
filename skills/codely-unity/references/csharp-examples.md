# C# examples for `execute_csharp`

Use a short `summary` and choose `execution_mode: editor` for editor work or `play` for runtime behavior.

## Read the active scene

```csharp
var scene = UnityEditor.SceneManagement.EditorSceneManager.GetActiveScene();
return new { scene.name, scene.path, rootCount = scene.rootCount };
```

## List root GameObjects

```csharp
var roots = UnityEngine.Object.FindObjectsOfType<UnityEngine.GameObject>()
    .Where(go => go.transform.parent == null)
    .Select(go => go.name)
    .ToArray();
return roots;
```

## Create an object in Edit Mode

```csharp
var go = new UnityEngine.GameObject("ExampleObject");
go.AddComponent<UnityEngine.Light>();
return new { go.name, hasLight = go.GetComponent<UnityEngine.Light>() != null };
```

## Async work

Top-level `await` is unsupported. Return a local task instead:

```csharp
using System.Threading.Tasks;
using UnityEngine;

async Task<string> RunAsync()
{
    await Task.Delay(200);
    return $"Resumed on main thread: {SynchronizationContext.Current != null}";
}

return RunAsync();
```

Avoid blocking calls such as `.Wait()`, `.Result`, and `Thread.Sleep`.
