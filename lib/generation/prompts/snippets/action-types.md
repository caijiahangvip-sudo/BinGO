## Action Type Definitions

Actions are expressed as objects in a JSON array. Each object has a `type` field.

### speech - Voice Narration

```json
{ "type": "text", "content": "Narration content" }
```

### spotlight - Focus Element

```json
{
  "type": "action",
  "name": "spotlight",
  "params": { "elementId": "element_id", "dimOpacity": 0.24 }
}
```

Keep spotlight readable: use `dimOpacity` between `0.2` and `0.32`, never above `0.42`.

### laser - Laser Pointer

```json
{ "type": "action", "name": "laser", "params": { "elementId": "element_id" } }
```

### discussion - Interactive Discussion

```json
{
  "type": "action",
  "name": "discussion",
  "params": { "topic": "Discussion topic", "prompt": "Guiding prompt" }
}
```
