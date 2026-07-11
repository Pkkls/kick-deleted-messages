# Kick Deleted Messages

Chrome extension that restores chat messages deleted by moderators on [kick.com](https://kick.com).

<img width="337" height="500" alt="image" src="https://github.com/user-attachments/assets/16933bb1-79e3-4f4f-8139-c687a3df1723" />

**Inline.** Rewrites Kick's "Deleted by a moderator" placeholder with the original message (`[deleted]`, red border).
**Panel.** Draggable overlay collecting all deletions this session. Toggle it from the popup; position is remembered.

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open any `kick.com` channel

## Limitations

- Automod blocks can't be recovered (no DOM trace left)
- History is lost on page reload
- Only detects English deletion notices
