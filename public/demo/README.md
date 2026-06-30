# Demo audio folders

Put **one pair per subfolder**. Folder names must match the **pair id** in Pair ideas (e.g. `house-classics`, `levels-good-feeling`).

## Layout

```
public/demo/
  house-classics/
    a.mp3
    b.mp3
    meta.json          ← optional label
  levels-good-feeling/
    01-levels.mp3
    02-good-feeling.mp3
```

## Pair ids (folder names)

| Folder name | Pair |
|-------------|------|
| `house-classics` | Show Me Love → Gypsy Woman |
| `levels-good-feeling` | Levels → Good Feeling |
| `daft-punk` | One More Time → Around the World |
| `one-dance-latch` | One Dance → Latch |
| `disco-afrobeats` | I Feel Love → Last Last |
| `get-lucky-blinding` | Get Lucky → Blinding Lights |
| `adele-lizzo` | Rolling in the Deep → About Damn Time |
| `brightside-feel-close` | Mr. Brightside → Feel So Close |

Click the pair in **Pair ideas** to load both files automatically.

## File naming

| Deck A | Deck B |
|--------|--------|
| `a.*` | `b.*` |
| `deck-a.*` | `deck-b.*` |
| `01*` | `02*` |

Supported: `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.aac`

## Optional label

```json
{ "name": "House classics" }
```

Files are gitignored — use your own licensed copies.
