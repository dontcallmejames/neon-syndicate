# Human Player UI — Design Spec

## Overview

A browser-based interface that lets a human player register a corporation and play Neon Syndicate alongside AI agents. Served as static files by the existing Express server. No framework, no build step — two vanilla JS HTML files consistent with the existing `admin.html` pattern.

---

## Pages

### `public/play.html` — Landing / Auth (`/play`)

Entry point for human players. Dark, cyberpunk-styled. Two sections:

**New Corp**
- Corp name field + one-sentence description field
- Register button → POST to `/register`
- On success: display `agentId` + `apiKey` with copy buttons, auto-redirect to `/game` after 3 seconds
- On failure (season not pending): show clear error message explaining registration is closed

**Returning Player**
- agentId field + API key field
- Enter button → validates by calling `GET /briefing/:agentId` with the key as `Authorization: Bearer <apiKey>` header
- On success: save both to `localStorage`, redirect to `/game`
- On failure: show "Invalid credentials" error

If the season status is `pending`, show a "Season hasn't started yet — you're registered and ready" banner on `/game` with the current player roster from `GET /world`.

---

### `public/game.html` — Game View (`/game`)

On load:
1. Read `agentId` and `apiKey` from `localStorage`. If missing, redirect to `/play`.
2. Call `GET /briefing/:agentId` to populate initial state.
3. Open WebSocket connection for live `tick_complete` events.

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  TOP BAR: corp name · resources · tick timer        │  ~38px
├─────────────────────────────────────────────────────┤
│                                                     │
│   CITY MAP (SVG)              │  SIDE PANEL         │
│   (fills remaining height)   │  (hidden by default, │
│                               │   slides in on      │
│                               │   district click)   │
│                               │                     │
├─────────────────────────────────────────────────────┤
│  LOG PANEL (collapsible — Narrative / Events / Msg) │  tab bar always visible
└─────────────────────────────────────────────────────┘
```

---

## Top Bar

Single slim bar (~38px). Left to right:

- **Corp name** — highlighted in corp color
- Divider
- Resources: `⚡ 18  💰 42  👷 5  🔍 12  🎭 8  ⚡pol 3`
- Divider
- Reputation label (color-coded: green=Trusted, grey=Neutral, orange=Notorious, red=Pariah)
- Valuation: `VAL 1,240`
- Spacer
- **Tick timer**: `NEXT TICK 0:42` with a thin progress bar draining left-to-right beneath the text. Shows "Processing…" when `generating: true`.
- Tick counter: `TICK 7 / 50`

---

## City Map

An inline `<svg>` element filling the center of the screen. 24 `<polygon>` elements with hand-coded coordinates arranged as an irregular city grid (organic neighborhood shapes, not a grid or honeycomb).

**Visual encoding:**
- Each corporation is assigned a distinct neon color on registration (cycle through a palette)
- Unowned districts: dark grey (`#1a2535`) with dashed border
- Owned districts: filled with owner's color at 20% opacity, solid border in owner's color
- Player's own districts: slightly brighter fill + subtle pulsing border animation
- Adjacency connections: thin lines drawn beneath polygons showing which districts border which

**District type icons** — small SVG icon or emoji centered in each polygon:
- `power_grid` → ⚡
- `financial_hub` → 💰
- `labor_zone` → 👷
- `data_center` → 🔍
- `black_market` → 🎭
- `government_quarter` → 🏛

**Interaction:**
- **Hover**: district brightens, tooltip appears showing district name
- **Click**: district gets glowing white stroke, side panel slides in
- **Escape / click outside**: closes side panel, clears selection
- **Ownership changes** (on `tick_complete`): color transitions via CSS `transition: fill 0.4s`

---

## Side Panel

Hidden by default (width: 0). Slides in from right (~220px wide) with a 200ms CSS transition when a district is clicked.

**Contents (top to bottom):**

1. **District header**
   - Name (bold)
   - Type badge (e.g. `financial_hub`)
   - Owner name, or "Unclaimed" in grey

2. **Stats block**
   - Yield per tick (e.g. `+4 💰 credits`)
   - Fortification level: `[████░░░░] 10 / 20`

3. **Adjacency status**
   - `✓ Adjacent to Chrome Quarter (yours)` — in green
   - `✗ Not adjacent to any of your districts` — in grey

4. **Actions section**

   Available actions shown as solid buttons with cost. Unavailable actions shown greyed out with a one-line reason.

   - `CLAIM (3⚡ 5💰)` — only if unclaimed + adjacent
   - `ATTACK (energy: slider)` — only if owned by a rival
     - Clicking expands an energy slider (min 5, max player's current energy)
     - Live readout: `Attack strength: 22 · Est. defense: 14 · Likely WIN ✓`
     - Defense estimate = `fortificationLevel + 5` (rough — alliance bonuses not client-side calculable)
     - Confirm button below slider
   - `FORTIFY (2⚡ 8💰)` — only if player owns it, fortification < 20
   - `SABOTAGE (4⚡ 15💰 5🎭)` — only if rival-owned + player has ≥5 influence
   - `LEAK SCANDAL (2⚡ 10💰 5🎭)` — targets the owning corp, not the district; shown here for context. Submits with `targetCorpId` = the district's `ownerId`.
   - `counter_intelligence` (3⚡, requires intelligence ≥ 10) — corp-wide action with no district target; not surfaced in the district panel. Out of scope for v1 (can be added to Messages tab in a future iteration).

   After submitting any action:
   - Button changes to `✓ Queued for tick N`
   - All action buttons lock until next tick fires (prevent double-submit)

5. **Close hint** — `ESC to close` in dim text at bottom

---

## Log Panel

Collapsible drawer at the bottom. Default: collapsed to a tab bar (~32px). Click tab bar or a tab to expand to ~30% of screen height.

**Tabs:**

- **Narrative** — AI-written briefing for this tick. Replaces each tick. Shows "Waiting for first tick…" initially.
- **Events** — scrollable list of recent public events (last 3 ticks). New entries flash briefly on arrival. Each event is one line with tick number prefix.
- **Messages** — Inbox + compose:
  - List of messages received this tick with sender name
  - Alliance proposals with `Accept` / `Decline` buttons
  - Pending alliance status (sent, awaiting response)
  - Compose form: corp dropdown (from world state) + message text + Send
  - Trade form: corp dropdown + offer resources + request resources + Send
  - Embargo button per corp

**Unread badges** appear on tab names when new content arrives. Tab bar pulses briefly on `tick_complete`.

---

## Tick Timer — Server Changes Required

The client needs to know when the next tick fires. Two small server-side additions:

### 1. `seasons` table — add `last_tick_at` column

```sql
ALTER TABLE seasons ADD COLUMN last_tick_at INTEGER DEFAULT 0;
```

Updated in `src/game/tick.js` at the start of each tick:
```js
conn.prepare('UPDATE seasons SET last_tick_at = ? WHERE id = ?').run(Date.now(), seasonId);
```

### 2. Expose `nextTickAt` in two places

**Briefing response** (`src/api/routes/briefing.js`):
```js
nextTickAt: season.last_tick_at + season.tick_interval_ms
```

**`tick_complete` WebSocket broadcast** (`src/game/tick.js`):
```js
nextTickAt: Date.now() + season.tick_interval_ms
```

The client seeds the timer from `briefing.nextTickAt` on load, then resets it from `tick_complete.nextTickAt` on each tick event.

---

## Server Routes — New

Two new routes in `src/api/server.js`:

```js
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, '../../public/play.html')));
app.get('/game', (_req, res) => res.sendFile(path.join(__dirname, '../../public/game.html')));
```

No auth middleware — both pages are public HTML. Auth is handled client-side via localStorage + API calls.

---

## Corp Color Assignment

Each registered corporation is assigned a color from a fixed neon palette. Color is derived deterministically from the corp's registration order. `GET /world` returns corporations sorted by `rowid ASC`, so the client uses array index (0, 1, 2…) as the color index — consistent across sessions without storing anything extra.

Palette (8 colors, cycles if more than 8 corps):
```
#00f5c4  #ff4d64  #ffd700  #a855f7  #3b82f6  #f97316  #10b981  #ec4899
```

---

## WebSocket Integration

The game page connects to `ws(s)://<host>/ws` (same dynamic protocol logic as `admin.html`).

On `tick_complete` event:
1. Update all district polygon colors (ownership changes)
2. Re-fetch briefing (`GET /briefing/:agentId`) for updated resources, narrative, messages
3. Reset tick timer to `nextTickAt`
4. Unlock action buttons (clear queued action state)
5. Flash unread badges on log panel tabs

If WebSocket disconnects, show a small "Reconnecting…" indicator in the top bar and poll the briefing every 10 seconds as fallback.

---

## Pending / Ended Season States

**Pending**: Show game map (populated from `GET /world`) with a centered overlay: "Season hasn't started yet — registered players: [list]". Map is visible but non-interactive.

**Ended**: Show final scoreboard overlay on top of the map. Corp rankings by valuation. "Season complete — final standings." No actions available.

---

## Files

| File | Purpose |
|------|---------|
| `public/play.html` | Landing/auth page |
| `public/game.html` | Game view |
| `src/api/server.js` | Add `/play` and `/game` routes |
| `src/api/routes/briefing.js` | Add `nextTickAt` to response |
| `src/game/tick.js` | Update `last_tick_at`, add `nextTickAt` to broadcast |
| `src/db/schema.sql` | Add `last_tick_at` column to seasons |
| Migration script or inline | `ALTER TABLE seasons ADD COLUMN last_tick_at INTEGER DEFAULT 0` |
