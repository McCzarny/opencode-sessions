# OpenCode Sessions for Stream Deck

[![Build](https://github.com/McCzarny/opencode-sessions/actions/workflows/build.yml/badge.svg)](https://github.com/McCzarny/opencode-sessions/actions/workflows/build.yml)

A Stream Deck plugin that shows your current [OpenCode](https://opencode.ai) agent sessions and
their status. Put one key per session on your deck and watch them run.

```
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ ● RUNNING     │  │ ● NEEDS INPUT │  │ ● UNREAD      │
│ Stream Deck   │  │ Refactor auth │  │ Battle UI     │
│ extension…    │  │ middleware    │  │ icons         │
│ build · a1b2  │  │ build · c3d4  │  │ explore · e5f │
└───────────────┘  └───────────────┘  └───────────────┘
```

## What it does

- **Session keys** — each key renders one OpenCode session: a status colour, the session title
  and a short subtitle (agent, pending prompts, id).
- **Lots of keys, no setup** — by default keys claim their slot from their place on the deck, so a
  row of Session keys lines up with the first, second, third … session automatically.
- **Live status** — the plugin polls the local OpenCode service (including active session drains
  and pending permission requests) to keep the status current.
- **Press to refresh** — pressing a key forces an immediate status refresh.

### Status values

| Status         | Meaning                                                       |
| -------------- | ------------------------------------------------------------- |
| `RUNNING`      | The session is actively running in OpenCode.                  |
| `NEEDS INPUT`  | The session is waiting on a permission request.               |
| `UNREAD`       | The session finished and its latest idle transition is unseen. |
| `FAILED`       | The last turn failed.                                         |
| `STOPPED`      | The last turn was interrupted.                                |
| `DONE`         | The last turn succeeded and has been viewed.                  |
| `IDLE`         | No outcome recorded yet.                                      |
| `OFFLINE`      | The plugin cannot reach the OpenCode service.                 |
| `NO SESSION`   | The key has no session to show (slot empty or none pinned).   |

## Requirements

- Stream Deck 7.1 or newer.
- OpenCode V2 installed (the plugin discovers, or starts, the shared background service).
- Node.js 20+ for building from source.

## Install from source

```sh
npm install
npm run build          # generates icons and bundles the plugin
```

Then link the `ai.opencode.streamdeck.sdPlugin` folder into Stream Deck. The easiest way is the
Stream Deck CLI (installed as a dev dependency):

```sh
npx streamdeck link ai.opencode.streamdeck.sdPlugin
```

Or install it manually by copying `ai.opencode.streamdeck.sdPlugin` into:

- macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
- Windows: `%appdata%\Elgato\StreamDeck\Plugins\`

During development:

```sh
npm run watch          # rebuild on change and restart the plugin
```

## CI and releases

- `.github/workflows/build.yml` runs on every push and pull request: typecheck, build, validate the
  manifest, package the plugin with `streamdeck pack`, and upload the `.streamDeckPlugin` as a build
  artifact.
- `.github/workflows/release.yml` runs when you push a `vX.Y.Z` tag: it builds the plugin and
  publishes the `.streamDeckPlugin` to a GitHub Release.
- `.github/dependabot.yml` keeps the GitHub Actions and npm dependencies up to date.

## Using it

1. Add a **Session** key to your deck (drag it from the OpenCode category).
2. In the property inspector choose how the key picks a session:
   - **Live slot** — the key follows a session in the list. By default **Slot source** is
     **By key position**: drop several Session keys and they line up with the first, second,
     third … session based on their place on the deck (row, then column). Pinned keys are skipped
     when numbering, so you can mix a few pinned keys with a position-ordered row. Switch **Slot
     source** to **Manual number** to type a session number instead (1 is the first session).
     **Scope** decides which sessions are counted: **All sessions** (the default) or **Running /
     waiting only**.
   - **Pinned session** — the key always shows one session you pick from the dropdown.
3. Press a key to refresh the status immediately.

## How it works

- `src/plugin.ts` wires the action to a shared `OpenCodeConnection`.
- `src/opencode/connection.ts` discovers or starts the local OpenCode service using the official
  [`@opencode/client`](https://www.npmjs.com/package/@opencode/client) service API, then polls
  `/api/session`, `/api/session/active` and `/api/permission/request` every few seconds.
- `src/render.ts` draws each key as an SVG data URL.
- `src/actions/session.ts` is the Stream Deck action, and `ai.opencode.streamdeck.sdPlugin/ui/*`
  is its property inspector.

## Limitations

- Stream Deck cannot add or remove keys at runtime, so the "view" is a set of keys you lay out
  (they are assigned by position or pinning).
- Status updates are polled (default 2s) rather than pushed; press a key to refresh on demand.
- The plugin only reads session state. It does not open or navigate OpenCode, because the desktop
  app has no session deep link yet.

## License

MIT
