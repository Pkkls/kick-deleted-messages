# Kick Deleted Messages

A Chrome (MV3) extension that brings back the original text of chat messages removed
by moderators on [kick.com](https://kick.com), in place of the bare
"Deleted by a moderator" placeholder Kick shows.

It restores the message **two ways at once**:

- **Inline.** Kick's own "Deleted by a moderator" row is rewritten in place to show
  the original message (prefixed with `[deleted]`, on a red background), keeping Kick's
  timestamp and username. Because it edits Kick's own row, it scrolls naturally with
  the chat.
- **Floating panel.** A small draggable pill docked in the chat corner collects every
  deletion it sees. Click to expand the full list; drag the header to move it (the
  position is remembered). You can turn it off from the extension popup (click the
  toolbar icon); inline restoration stays on regardless.
<img width="337" height="500" alt="image" src="https://github.com/user-attachments/assets/16933bb1-79e3-4f4f-8139-c687a3df1723" />
<img width="217" height="165" alt="image" src="https://github.com/user-attachments/assets/16f0df93-dbdf-484f-9fa6-cce45fe35dbb" />
<img width="217" height="165" alt="image" src="https://github.com/user-attachments/assets/9b761864-0f4a-4747-bdbf-5a7007a69c43" />

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open any `kick.com` channel.

No network calls. Permissions: `https://kick.com/*` host access and `storage` (used
only to remember the panel on/off toggle; the panel's drag position lives in the page's
`localStorage`).

## How it works

Kick's chat is a **virtualised list** (react-virtuoso): each row is a `<div data-index>`
that is absolutely positioned and recycled as you scroll.

The extension keeps a **live clone** of every row's last known good content. When a
moderator deletes a message, Kick briefly swaps that row's body for a
"deleted by a moderator" notice and then removes the row. A `MutationObserver` spots the
notice, looks up the stored clone, and:

1. puts the original message body back into Kick's own row (idempotent: if Kick
   re-renders the row back to the notice, the restoration is re-applied), and
2. appends a copy to the floating panel, which lives **outside** the virtualiser so
   scrolling chat can never paint over it.

### Why DOM-only (and not the WebSocket feed)

An earlier approach hooked `window.WebSocket` to read chat events directly. On current
Kick this **does not work**: the only main-thread socket
(`wss://websockets.kick.com/viewer/v1/connect`) carries presence and heartbeats only.
Chat, deletions and bans travel over a worker-isolated transport that a content script
cannot observe (verified live: a `document_start` WebSocket hook receives zero chat
frames). The legacy Pusher endpoint is dead too (it rejects anonymous clients with code
4001). So the rendered DOM is the only signal available.

## Limitations

These are inherent to the approach and can't be worked around from a content script:

- **Automod blocks are not recoverable.** Messages removed by automod leave no DOM
  placeholder, and the realtime feed is inaccessible, so there is nothing to restore.
- **A page reload loses everything.** Kick never includes deleted messages in chat
  history, so only deletions witnessed live (while the extension is running) can be shown.
- **Manual moderator deletions only.** Detection keys on Kick's English notice strings
  (e.g. "deleted by a moderator").

## Session history & persistence

The panel keeps every deletion captured **for the current session**, in memory. Hiding
the panel (popup toggle) only hides it: the history is preserved and reappears when you
turn it back on, without rebuilding.

That history is **deliberately not persisted**: a page reload, a Kick chat clear, or
closing the tab wipes it, and nothing is written to durable storage for it. This is a
conscious trade-off, since persisting full message history (content, emotes, authors)
would eat a meaningful amount of extension storage for little benefit. Only the panel's
on/off toggle and its drag position are persisted.

## Files

```
manifest.json     MV3 manifest (content script + CSS + popup)
src/content.js    capture, detection, inline restore, panel
src/styles.css    inline + panel styling
src/popup.html    toolbar popup (panel on/off toggle)
src/popup.js      reads/writes the toggle via chrome.storage
```
