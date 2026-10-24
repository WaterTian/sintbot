# Group design canvas (Feishu whiteboards)

English · [简体中文](./zh-CN/BOARD.md)

> Group members and the agent share a **Feishu whiteboard** for presenting generated images and iterating on annotations. The agent puts images and diagrams on the board; group members draw arrows, add sticky notes, write text or comments there, then say so in the group, and the agent revises according to the annotations. With [auto-detection](#auto-detection-polling) on, nobody has to say anything: a feedback card appears in the group and one click starts the revision. Feishu hosts the whiteboard, so it opens natively on desktop and mobile. SintBot only makes outbound API calls; it hosts no pages and needs no public address. Feishu only.
> Implementation: `src/platform/board.js` (pure functions) · `boardwatch.js` (auto-detection) · `boardnotice.js` (card updates) · `boardops.js` (tracking its own edits) · `sbot feishu board-*` in `bin/sbot.js`.

## How it works for group members

- **Nobody needs to know what a "canvas" is.** Someone says "draw a …" or "make a flowchart". The first time the agent needs to show an image, it creates the canvas, posts the link in the group and pins it as a tab at the top of the group.
- **The group is the notification stream; the canvas is the workspace.** A few images are also posted to the group; for a batch (three or more), only the canvas link is posted, to avoid flooding the chat. Each image has a label node ("Option 1", "v2 · revised per annotations"), so people can refer to it in the chat.
- **Iterating on annotations:** draw arrows, add sticky notes, write text or comments on the board → say "revise per the annotations" in the group → the agent fetches the annotations and comments, and places the new version to the right of the original, in the same row.
- **With auto-detection on**, nobody has to say anything. A "new feedback on the canvas" card appears in the group (annotations and comments combined into one card, with counts and a preview image) → click "Revise per annotations" → the result lands in the same card.
- **Direct edits to the canvas** (changing text in a diagram, deleting a node): the agent only merges the change back into the source file. It does not re-render or produce a new version. With auto-detection on, such edits bring up a "canvas content changed · sync to source" card.
- **The canvas is the design history.** Earlier versions and annotations stay on the board, so the chain "original → annotations → new image" is visible at a glance; comments are marked resolved once handled. Nodes are deleted only when the group explicitly asks for a cleanup, and deleted nodes are archived to the project's `design/board-history.jsonl`.
- The "Ignore" button on a card turns it grey and marks it ignored, so clicking an old card later cannot start a turn by accident.

## Core mechanism: revising per annotations

- **The annotation tools are the whiteboard's own:** arrows (`connector`), sticky notes (`sticky_note`), text (`text_shape`) and freehand strokes (`paint`). They work on mobile too.
- **Reading back is structured:** `GET nodes` returns JSON with coordinates, and each arrow carries the id of the node it snaps to, so there is no ambiguity about which image an annotation refers to.
- **The model gets the clean original plus a structured list of annotations**, not a screenshot with the arrows baked in. That is why **text-only model groups (`vision:false`) can revise per annotations too**: coordinates and text are enough to drive it. The limit: "change this to look like that", which only makes sense when seen, still needs a vision model.
- When someone clicks "Revise per annotations", the synthetic message carries **the list of annotations reported in that round**, so the agent handles only that round's annotations. Older annotations stay on the board and are not reprocessed by mistake.

## Agent subcommands (`sbot feishu board-*`)

| Subcommand | What it does |
|---|---|
| `board-create [--title] [--new]` | Creates the canvas document and whiteboard, shares it with the group (edit access), adds a "how to use" sticky note and pins it as a group tab; if one exists, returns its link |
| `board-add-image <image> [--beside <node id>] [--x --y --width --height] [--label] [--deliver]` | Uploads an image node. `--beside` places it to the right of a reference image, in the same row (required when revising per annotations; several versions are spaced automatically); by default it goes at the far right of the board. `--deliver` puts the result into the feedback card that triggered it |
| `board-add-diagram <source> [--type] [--syntax mermaid\|plantuml] [--as-image] [--beside] [--label] [--deliver]` | Mermaid / PlantUML source → editable diagram nodes; see below |
| `board-add-nodes <node JSON>` | Writes structured nodes directly (free layouts, mind maps or sections that Mermaid cannot express), up to 3000 |
| `board-nodes [--raw]` | Reads a node summary: images / arrows (with their snap targets) / text / shapes / mind maps / groups. **Use this to read annotations, not screenshots** |
| `board-del-node <id…> [--no-cascade]` | Deletes nodes, by default together with group members and mind-map subtrees; **pass all ids in one call** |
| `board-comments` · `board-resolve-comment <id>` · `board-get-media <token> <path>` | Reads comments / marks one resolved / downloads images attached to comments and board assets |

- They are on the `Bash(sbot feishu *)` built-in skills allow list, so they work at any permission level (Codex groups need full access, as usual).
- Canvas state lives in the config at `groups[<chatId>].board` (written under a lock; the daemon hot-reloads it). When a group has a canvas, the agent's self-briefing gains a **Design canvas** section: the link, subcommand usage and conventions (read annotations from node data, not screenshots; put new images on the right and leave originals alone; in `vision:false` groups, "you cannot see the images on the board; go by the node data").
- Text, titles and labels go through outbound redaction; image paths are confined to the project directory.

## Diagrams (Mermaid / PlantUML)

The agent writes Mermaid (preferred) or PlantUML source, keeps it in `design/diagrams/*.mmd` in the repo, and one command turns it into nodes on the board that **can be edited, annotated and deleted**. The point: review a flowchart before building a product feature, review an architecture diagram before a technical plan, and only then write code or generate images. Diagrams are cheap; rework is expensive.

- Feishu's render endpoint cannot be told where to place the result, and the container child nodes it creates cannot be deleted. So SintBot first renders on a per-group **scratch board that the group never sees**, reads the nodes back, cleans them up, moves them to an empty area of the main board, and writes them to the main board in one go. What lands there are ordinary nodes: their position is controllable, they can be deleted, and annotation arrows can snap to them. The whole diagram is made into one group, so it drags as a unit; shapes inside the group can still have their text edited or be deleted one by one.
- Fallbacks: if the editable transplant fails, the whole diagram goes on the board as one image (whitespace trimmed; the PNG is also saved in `design/diagrams/`). Only if that fails too does it render straight onto the main board, with a warning that it may overlap other content. `--as-image` goes straight to the whole-image route (easy to drag, not editable; only for one-off sketches).
- Multi-line labels in Mermaid need `<br/>` (`\n` shows up literally as two characters). Subgraph containers ignore `classDef`; use `style <subgraph id> fill:…,stroke:…`.

## Auto-detection (polling)

- **Off by default.** It is on only when `feishu.board.pollSec` is positive (120 recommended, minimum 30). Restart the daemon after changing it.
- When on, every `pollSec` seconds the daemon fetches the nodes and unresolved comments of **every group that has a canvas** and diffs them against a baseline: new nodes, nodes whose text changed, deleted nodes and new comments. Pure moves, resizes and style changes don't count (they are treated as tidying up).
- **It waits for people to stop drawing.** The whiteboard has no "who is editing" API, so the only signal is whether changes have stopped. A change is held back, and the accumulated changes are reported only once the board's fingerprint stops changing in the next round. During continuous editing it holds for at most `holdRounds` rounds (default 5, about 10 minutes). New comments don't wait; they are reported right away.
- **Its own actions are not reported.** The agent's writes (placing images, creating diagrams, deleting nodes) record the node ids the server returns in `~/.sbot/board-ops/`, and these are merged into the baseline before each poll. So the bot never reacts to its own images, and annotations a user draws at the same moment are still reported as the user's alone.
- A report is just a card in the group, with **zero model calls**. Whether to start a turn (and spend quota) is up to a person clicking the button.
- **API usage:** each group with a canvas takes about 2 Feishu API calls per round; at 120 seconds per round that is about 40,000 calls per group per month. Feishu has a monthly per-tenant API quota, which is why this is off by default.
- **When it is off**, canvas annotations are not reported automatically; someone says so in the group and the agent fetches them. The agent's self-briefing also states that nothing is reported automatically, so it never tells group members "I'll be notified when you're done".
- Feishu's `board.whiteboard.updated_v1` event is not delivered over the long connection even when configured correctly (only this one is missing; the `im.*` events arrive normally), so polling is the main trigger. The event path is kept: if delivery ever works, both paths share the same baseline and nothing is reported twice.

## Setup (Feishu Open Platform)

On top of the basic scopes in [platforms/feishu.md](./platforms/feishu.md), the canvas needs these 12 scopes (all with **app identity**). Publish a new app version after enabling them:

`docx:document:create` · `docx:document:write_only` · `docs:document.media:upload` · `board:whiteboard:node:read` · `board:whiteboard:node:create` · `board:whiteboard:node:delete` · `docs:permission.member:create` · `drive:drive.metadata:readonly` · `im:chat.tabs:write_only` · `docs:document.comment:read` · `docs:document.comment:update` · `docs:document.media:download`

- The buttons on feedback cards need a subscription to "Card action `card.action.trigger`" under Events & Callbacks → **Callback configuration**, using the long connection (this is a separate channel from event subscriptions).
- If a request is refused although the scope is enabled, check two things first: ① each scope has separate "user identity" and "app identity" switches, and SintBot uses app identity; ② after a new version is published, Feishu's cached old token keeps the old scope set until it expires (up to about 2 hours).
- The console's Settings → Feishu app card has the full list and a one-click preflight check.

## Configuration

```jsonc
"feishu": {
  "board": { "pollSec": 0, "holdRounds": 5 }   // auto-detection: 0 = off (default), 120 to turn it on (minimum 30) / max rounds to hold back; restart the daemon after changing
}
```

## Platform facts (tested; know these when writing code)

- **There is no delete endpoint.** Deleting means reading everything and rewriting it with `overwrite`, so **every node id on the board changes after each delete** and later operations must re-read. A board cannot be emptied (at least one node must remain). A user's concurrent edits between the read and the write are overwritten (a window of seconds).
- When nodes are written, the server rewrites the ids passed in (`n1` → `d1:1`); go by the response. Nodes in the same batch can reference each other (arrow snaps, group members), and the server rewrites those references too.
- **Read-only fields are silently dropped.** For example, writing `children` on a `group` raises no error and returns ids as usual, but the grouping has no effect. The correct way is to set `parent_id` on the members and give the group's position and size explicitly. "POST succeeded and returned ids" does not mean it took effect.
- Whole-board export (`download_as_image`) is always a 2560×2560 JPEG with the content scaled proportionally and centred, by unpublished rules; exporting a recently exported board again returns the old snapshot. Card previews rely on "export, then trim the white border", not on mapping coordinates.
- Image assets are uploaded with `parent_type=whiteboard`. It works in testing, but the official docs don't list that value; it is undocumented behavior.
- The read-nodes response for an empty board has no `nodes` key. Shortly after a write, the API may return `4003101 doc is applying`; back off and retry.
- Comments cannot anchor to a specific element on the board (they only show "[Whiteboard]"); spatial references rely on drawing arrows.

## Limits and things deliberately not done

- The whiteboard has no html / embed / iframe nodes, so **AI-generated HTML cannot go on the board as a live page**; only as a screenshot (view only, not editable).
- Images that users paste onto the board themselves are visible to the agent only after it downloads them with `board-get-media`; `vision:false` groups cannot see image content.
- Image generation depends on the model: Codex groups have it built in; other groups borrow the machine's Codex subscription through `sbot imagen`.
- Documents the bot creates live in the app's space. If a document is deleted or moved, the subcommands say "the canvas document does not exist or is not accessible; it can be recreated", and the agent asks the group before recreating it.
- Not done: "generating…" placeholder nodes on the board, and new slash commands (natural language is enough to trigger everything).
