// Kick Deleted Messages — DOM-only.
//
// Why DOM-only: on current Kick the chat realtime feed (messages, deletes, bans)
// is NOT reachable from a content script — hooking window.WebSocket in the MAIN
// world yields zero chat frames (verified live: the page's only main-thread socket,
// wss://websockets.kick.com/viewer/v1, carries presence/pings only; chat runs in an
// isolated worker). So the ONLY signal we have is what Kick renders into the DOM.
//
// What we recover: manual moderator deletions. Kick briefly swaps a message row's
// content for a "deleted by a moderator" notice, then removes the row. We keep a live
// clone of each row's content and, on detecting that notice, surface the clone.
//
// What we can NOT recover: automod blocks (removed with no DOM placeholder) and
// anything from before the page loaded (Kick never serves deleted messages in chat
// history, so a reload always loses them).
//
// Rendering: Kick's chat is a react-virtuoso virtualised list — rows are absolutely
// positioned and recycled, so injecting a restored message *inline* gets painted over
// by scrolling chat. Instead we collect deleted messages into an extension-owned
// floating panel docked to the chat corner (outside the scroller), collapsed to a
// small pill by default so it never covers the live chat.

(function () {
  'use strict';

  const liveClones = new WeakMap(); // row node -> clone of its last good content
  const handledRows = new WeakSet();

  // Whether the floating panel is shown (popup toggle). Inline restoration is
  // always on. Default enabled.
  const SHOW_PANEL_KEY = 'kdm.showPanel';
  let showPanel = true;

  const DELETION_RE =
    /(deleted by a moderator|message deleted|removed by a moderator|deleted by the broadcaster)/i;

  // The notice replaces the whole message body, so it is short and phrase-dominated.
  // The length cap avoids false positives on normal messages containing "deleted".
  function isDeletionNotice(text) {
    const t = (text || '').trim();
    return t.length > 0 && t.length <= 60 && DELETION_RE.test(t);
  }

  function getRow(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    while (el) {
      if (el.hasAttribute && el.hasAttribute('data-index')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── Panel ─────────────────────────────────────────────────────────────────────

  let panelEl = null;
  let listEl = null;
  let countEl = null;
  let count = 0;

  function ensurePanel() {
    if (panelEl && panelEl.isConnected) return panelEl;
    // Attach to <body>, not the chat box: #channel-chatroom is its own stacking
    // context, so a panel inside it can never paint above Kick's own overlays
    // (pin tooltip, etc.) no matter how high its z-index. position: fixed at the
    // root stacking context is the only thing that actually wins.
    const host = document.body;

    panelEl = document.createElement('div');
    panelEl.className = 'kdm-panel kdm-collapsed' + (showPanel ? '' : ' kdm-hidden');
    panelEl.setAttribute('data-kdm-injected', '1');

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'kdm-panel-header';
    const label = document.createElement('span');
    label.className = 'kdm-panel-label';
    label.textContent = 'Deleted messages';
    countEl = document.createElement('span');
    countEl.className = 'kdm-panel-count';
    countEl.textContent = '0';
    header.append(countEl, label);
    header.addEventListener('click', () => panelEl.classList.toggle('kdm-collapsed'));

    listEl = document.createElement('div');
    listEl.className = 'kdm-panel-list';

    panelEl.append(header, listEl);
    host.appendChild(panelEl);
    makeDraggable(panelEl, header);
    return panelEl;
  }

  // Drag the panel by its header. A click that doesn't move toggles collapse; a drag
  // repositions and is persisted. Position is in viewport coordinates (panel is fixed).
  const POS_KEY = 'kdm.panelPos';

  function makeDraggable(panel, handle) {
    // Restore saved position.
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        panel.style.left = saved.left + 'px';
        panel.style.top = saved.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
    } catch {
      /* ignore */
    }

    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;
    let moved = false;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      const left = Math.min(Math.max(0, baseLeft + dx), maxLeft);
      const top = Math.min(Math.max(0, baseTop + dy), maxTop);
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (moved) {
        handle.dataset.kdmDragged = '1'; // suppress the click-toggle that follows
        try {
          localStorage.setItem(
            POS_KEY,
            JSON.stringify({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }),
          );
        } catch {
          /* ignore */
        }
      }
    };

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const panelRect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      baseLeft = panelRect.left;
      baseTop = panelRect.top;
      moved = false;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    // Swallow the click that ends a drag so it doesn't toggle collapse.
    handle.addEventListener(
      'click',
      (e) => {
        if (handle.dataset.kdmDragged) {
          delete handle.dataset.kdmDragged;
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  }

  // Strip react-virtuoso absolute positioning so the clone lays out in normal flow.
  function neutralize(el) {
    el.classList.remove('absolute', 'inset-x-0', 'top-0');
    el.style.position = 'static';
    el.style.transform = 'none';
    el.style.inset = 'auto';
    el.style.width = 'auto';
    el.removeAttribute('data-index');
    el.removeAttribute('data-kt-id');
  }

  function applyPanelVisibility() {
    if (panelEl) panelEl.classList.toggle('kdm-hidden', !showPanel);
  }

  // Always accumulate deletions for the whole session, even while hidden, so toggling
  // the panel back on shows the full history (capped) rather than rebuilding empty.
  function addToPanel(clone) {
    ensurePanel();
    const item = document.createElement('div');
    item.className = 'kdm-item';

    const body = clone.cloneNode(true);
    body.classList.add('kdm-deleted');
    neutralize(body);

    item.append(body);
    listEl.appendChild(item);
    while (listEl.children.length > 100) listEl.removeChild(listEl.firstChild);

    count += 1;
    countEl.textContent = String(count);
    panelEl.classList.add('kdm-flash');
    setTimeout(() => panelEl.classList.remove('kdm-flash'), 600);
    listEl.scrollTop = listEl.scrollHeight;
  }

  // ── Deletion handling ──────────────────────────────────────────────────────────

  // The message body is the last element of Kick's content container. On deletion
  // Kick swaps it for a "deleted by a moderator" span; we put the original back.
  function contentContainer(rowEl) {
    return (
      rowEl.querySelector('div.w-full.min-w-0.shrink-0') ||
      rowEl.querySelector('div[class*="w-full"][class*="min-w-0"]') ||
      rowEl.querySelector('div.w-full') ||
      rowEl.firstElementChild
    );
  }

  // Replace the live notice row's message body with the original content (from the
  // pre-clone), keeping Kick's own timestamp + username. Editing Kick's own row (not
  // a foreign node) means the virtualiser keeps scrolling it normally. Idempotent and
  // re-appliable: if Kick re-renders the row back to the notice, we restore again.
  function restoreInline(row, clone) {
    if (row.querySelector('[data-kdm-injected]')) return; // already restored
    const live = contentContainer(row);
    const orig = contentContainer(clone);
    if (!live || !orig) return;
    const liveBody = live.lastElementChild;
    const origBody = orig.lastElementChild;
    if (!liveBody || !origBody) return;

    const restored = origBody.cloneNode(true);
    restored.classList.add('kdm-inline');
    restored.setAttribute('data-kdm-injected', '1');
    restored.style.position = 'static';
    restored.style.transform = 'none';
    liveBody.replaceWith(restored);
    row.classList.add('kdm-row');
  }

  function handleDeleted(row) {
    const clone = liveClones.get(row);
    if (clone) restoreInline(row, clone); // inline: re-appliable on re-render
    // Panel: once per deletion event for this row.
    if (!handledRows.has(row)) {
      handledRows.add(row);
      if (clone) addToPanel(clone);
    }
  }

  function captureRow(row) {
    if (!row) return;
    if (row.querySelector('[data-kdm-injected]')) return; // don't re-clone our own injection
    const text = row.textContent || '';
    if (isDeletionNotice(text) || text.trim().length === 0) return;
    // Fresh good content: keep the clone current and let a future deletion of this
    // (possibly virtualiser-recycled) node be treated as new.
    liveClones.set(row, row.cloneNode(true));
    handledRows.delete(row);
  }

  function processNode(node) {
    if (node.nodeType === 3) {
      if (isDeletionNotice(node.textContent)) {
        const row = getRow(node);
        if (row) handleDeleted(row);
      }
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.getAttribute && node.getAttribute('data-kdm-injected')) return;

    if (node.hasAttribute('data-index')) {
      if (isDeletionNotice(node.textContent)) handleDeleted(node);
      else captureRow(node);
      return;
    }
    const row = getRow(node);
    if (!row) return;
    if (isDeletionNotice(node.textContent) || isDeletionNotice(row.textContent)) handleDeleted(row);
    else captureRow(row);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      if (mut.type === 'characterData') {
        const row = getRow(mut.target);
        if (!row) continue;
        if (isDeletionNotice(row.textContent)) handleDeleted(row);
        else captureRow(row);
        continue;
      }
      for (const node of mut.addedNodes) processNode(node);
    }
  });

  observer.observe(document, { childList: true, subtree: true, characterData: true });

  // Panel toggle: read setting, then react to changes from the popup without reload.
  // Toggling only flips visibility — the panel and its session history are kept in
  // memory (not rebuilt), so re-enabling shows everything captured this session.
  try {
    chrome.storage.local.get(SHOW_PANEL_KEY, (r) => {
      showPanel = r[SHOW_PANEL_KEY] !== false;
      applyPanelVisibility();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SHOW_PANEL_KEY]) return;
      showPanel = changes[SHOW_PANEL_KEY].newValue !== false;
      applyPanelVisibility();
    });
  } catch {
    /* chrome.storage unavailable — panel just stays enabled */
  }

  for (const row of document.querySelectorAll('[data-index]')) captureRow(row);
})();
