(() => {
  'use strict';

  const CACHE_KEY = 'the-list:cache:v2';      // { data, etag, pending }
  const LEGACY_KEY = 'the-list:v1';           // pre-backend localStorage data
  const TAB_KEY = 'the-list:tab';
  const PASS_KEY = 'the-list:passcode';
  const API = '/api/lists';
  const POLL_MS = 30000;

  const CATEGORIES = {
    books:  { title: 'Books',  placeholder: 'Add a book' },
    comics: { title: 'Comics', placeholder: 'Add a comic' },
    movies: { title: 'Movies', placeholder: 'Add a movie' },
    shows:  { title: 'Shows',  placeholder: 'Add a show' },
    albums: { title: 'Albums', placeholder: 'Add an album' },
  };
  const CAT_KEYS = Object.keys(CATEGORIES);
  const GAP = 6; // must match .item margin-bottom

  const $ = (id) => document.getElementById(id);
  const titleEl = $('title');
  const countEl = $('count');
  const statusEl = $('sync');
  const form = $('add-form');
  const input = $('add-input');
  const activeEl = $('active');
  const doneEl = $('done');
  const doneWrap = $('done-wrap');
  const doneCount = $('done-count');
  const emptyEl = $('empty');
  const lock = $('lock');
  const lockForm = $('lock-form');
  const lockInput = $('lock-input');
  const lockError = $('lock-error');
  const tabs = [...document.querySelectorAll('.tabs button')];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };

  const emptyData = () => Object.fromEntries(CAT_KEYS.map((c) => [c, []]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- State ----------
  // data:    current view of all lists (server state + pending ops applied)
  // etag:    version of the server document `data` is based on (null = none yet)
  // pending: ops not yet confirmed by the server; replayed onto server state on conflict
  let { data, etag, pending } = loadCache();
  let current = pickInitialCategory();
  let passcode = store.get(PASS_KEY);

  function loadCache() {
    let cache = null;
    try { cache = JSON.parse(store.get(CACHE_KEY)); } catch (_) {}
    const state = {
      data: normalize(cache && cache.data),
      etag: (cache && cache.etag) || null,
      pending: (cache && Array.isArray(cache.pending)) ? cache.pending : [],
    };

    // One-time migration of pre-backend data: turn each item into an "add" op
    // so it merges into whatever is already on the server.
    let legacy = null;
    try { legacy = JSON.parse(store.get(LEGACY_KEY)); } catch (_) {}
    if (legacy && typeof legacy === 'object') {
      for (const cat of CAT_KEYS) {
        for (const item of (Array.isArray(legacy[cat]) ? legacy[cat] : [])) {
          if (!item || typeof item.text !== 'string') continue;
          const op = { type: 'add', cat, item: { id: item.id || uid(), text: item.text, done: !!item.done } };
          if (item.done) op.item.doneAt = item.doneAt || Date.now();
          applyOp(state.data, op);
          state.pending.push(op);
        }
      }
      store.del(LEGACY_KEY);
      store.set(CACHE_KEY, JSON.stringify(state));
    }
    return state;
  }

  function saveCache() {
    store.set(CACHE_KEY, JSON.stringify({ data, etag, pending }));
  }

  function normalize(d) {
    const out = emptyData();
    if (d && typeof d === 'object') {
      for (const cat of CAT_KEYS) if (Array.isArray(d[cat])) out[cat] = d[cat];
    }
    return out;
  }

  function pickInitialCategory() {
    const fromHash = location.hash.slice(1);
    if (CATEGORIES[fromHash]) return fromHash;
    const last = store.get(TAB_KEY);
    return CATEGORIES[last] ? last : 'books';
  }

  const list = () => data[current];
  const activeItems = () => list().filter((i) => !i.done);
  const doneItems = () => list().filter((i) => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const findItem = (id) => list().find((i) => i.id === id);

  // ---------- Operations ----------
  // Ops reference items by id so they can be replayed onto newer server state.
  function applyOp(d, op) {
    const items = d[op.cat];
    if (!items) return;
    const idx = items.findIndex((i) => i.id === (op.id || (op.item && op.item.id)));
    const activeOf = (arr) => arr.filter((i) => !i.done);
    const doneOf = (arr) => arr.filter((i) => i.done);

    switch (op.type) {
      case 'add': {
        if (idx !== -1) return;
        const item = { ...op.item };
        // New active items go after the last active item; done items order by doneAt.
        d[op.cat] = item.done
          ? [...items, item]
          : [...activeOf(items), item, ...doneOf(items)];
        return;
      }
      case 'toggle': {
        if (idx === -1) return;
        const item = items[idx];
        item.done = op.done;
        if (op.done) item.doneAt = op.at;
        else {
          delete item.doneAt;
          // Restored items return to the bottom of the active list.
          const rest = items.filter((i) => i !== item);
          d[op.cat] = [...activeOf(rest), item, ...doneOf(rest)];
        }
        return;
      }
      case 'edit':
        if (idx !== -1) items[idx].text = op.text;
        return;
      case 'delete':
        if (idx !== -1) items.splice(idx, 1);
        return;
      case 'move': {
        if (idx === -1 || items[idx].done) return;
        const active = activeOf(items);
        const from = active.findIndex((i) => i.id === op.id);
        const [moved] = active.splice(from, 1);
        let to;
        if (op.afterId === null) to = 0;
        else {
          const a = active.findIndex((i) => i.id === op.afterId);
          to = a === -1 ? from : a + 1; // anchor gone: keep previous position
        }
        active.splice(to, 0, moved);
        d[op.cat] = [...active, ...doneOf(items)];
        return;
      }
    }
  }

  function commit(op) {
    op.cat = op.cat || current;
    applyOp(data, op);
    pending.push(op);
    saveCache();
    render();
    schedulePush();
  }

  // ---------- Sync ----------
  let syncing = false;
  let pushTimer = 0;
  let netState = 'ok'; // ok | offline | error

  function setStatus(state) {
    netState = state;
    const busy = syncing || pending.length > 0;
    let label = '';
    if (state === 'offline') label = 'Offline · saved on this device';
    else if (state === 'error') label = 'Sync error · will retry';
    else if (busy) label = 'Syncing…';
    statusEl.textContent = label;
    statusEl.dataset.state = state === 'ok' ? (busy ? 'busy' : 'ok') : state;
  }

  async function api(method, body, ifMatch) {
    const headers = { Authorization: 'Bearer ' + passcode };
    if (body) headers['Content-Type'] = 'application/json';
    if (ifMatch) headers['If-Match'] = ifMatch;
    const res = await fetch(API, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json };
  }

  function schedulePush(delay = 250) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(sync, delay);
  }

  // Pushes pending ops if there are any, otherwise pulls the latest state.
  async function sync() {
    if (!passcode || syncing) return;
    if (!navigator.onLine) { setStatus('offline'); return; }
    syncing = true;
    setStatus('ok');
    try {
      if (pending.length) await push();
      else await pull();
      setStatus('ok');
    } catch (err) {
      if (err && err.message === 'unauthorized') return;
      setStatus(navigator.onLine ? 'error' : 'offline');
      schedulePush(5000);
    } finally {
      syncing = false;
      setStatus(netState);
      if (pending.length && netState === 'ok') schedulePush(0);
    }
  }

  async function pull() {
    const { status, json } = await api('GET');
    if (status === 401) return unauthorized();
    if (status !== 200 || !json) throw new Error('pull failed');
    if (pending.length) return; // a local change landed mid-request; push will rebase
    if (json.etag === etag) return;
    data = normalize(json.data);
    etag = json.etag;
    saveCache();
    renderIfIdle();
  }

  async function push() {
    for (let attempt = 0; attempt < 5 && pending.length; attempt++) {
      const sent = pending.length;
      const { status, json } = await api('PUT', { data }, etag || 'none');
      if (status === 401) return unauthorized();

      if (status === 200 && json) {
        etag = json.etag;
        pending.splice(0, sent);
        // Ops added during the request are already applied to `data`; keep it.
        if (!pending.length) data = normalize(json.data);
        saveCache();
        if (!pending.length) renderIfIdle();
        continue;
      }

      if (status === 409 && json) {
        // Someone else wrote first: rebase local ops onto the newer document.
        data = normalize(json.data);
        etag = json.etag;
        for (const op of pending) applyOp(data, op);
        saveCache();
        renderIfIdle();
        continue;
      }

      throw new Error('push failed: ' + status);
    }
  }

  function unauthorized() {
    passcode = null;
    store.del(PASS_KEY);
    showLock('That passcode was not accepted.');
    const err = new Error('unauthorized');
    throw err;
  }

  // ---------- Lock screen ----------
  function showLock(message) {
    lock.hidden = false;
    lockError.textContent = message || '';
    lockError.hidden = !message;
    setTimeout(() => lockInput.focus(), 50);
  }

  lockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = lockInput.value.trim();
    if (!value) return;
    passcode = value;
    lockError.hidden = true;
    const btn = lockForm.querySelector('button');
    btn.disabled = true;
    try {
      const { status } = await api('GET');
      if (status === 401) { passcode = null; showLock('That passcode was not accepted.'); return; }
      if (status !== 200) throw new Error();
      store.set(PASS_KEY, value);
      lock.hidden = true;
      lockInput.value = '';
      sync();
    } catch (_) {
      passcode = null;
      showLock('Could not reach the server. Check your connection.');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Rendering ----------
  const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
  const ICON_GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 12h16M4 16h16"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function itemEl(item) {
    const li = document.createElement('li');
    li.className = 'item' + (item.done ? ' is-done' : '');
    li.dataset.id = item.id;

    const check = document.createElement('button');
    check.className = 'check';
    check.dataset.action = 'toggle';
    check.setAttribute('aria-label', item.done ? 'Mark not done' : 'Mark done');
    check.innerHTML = '<span>' + ICON_CHECK + '</span>';

    const text = document.createElement('span');
    text.className = 'text';
    text.dataset.action = 'edit';
    text.textContent = item.text;

    li.append(check, text);

    const btn = document.createElement('button');
    if (!item.done) {
      btn.className = 'icon-btn handle';
      btn.dataset.action = 'drag';
      btn.setAttribute('aria-label', 'Reorder (drag, or use arrow keys)');
      btn.innerHTML = ICON_GRIP;
    } else {
      btn.className = 'icon-btn';
      btn.dataset.action = 'delete';
      btn.setAttribute('aria-label', 'Delete');
      btn.innerHTML = ICON_X;
    }
    li.append(btn);
    return li;
  }

  let editing = false;
  let renderDeferred = false;

  function renderIfIdle() {
    if (drag || editing) renderDeferred = true;
    else render();
  }

  function render() {
    renderDeferred = false;
    const meta = CATEGORIES[current];
    titleEl.textContent = meta.title;
    input.placeholder = meta.placeholder;
    document.title = meta.title + ' · The List';

    const active = activeItems();
    const done = doneItems();

    activeEl.replaceChildren(...active.map(itemEl));
    doneEl.replaceChildren(...done.map(itemEl));

    countEl.textContent = active.length ? String(active.length) : '';
    emptyEl.hidden = active.length > 0;
    doneWrap.hidden = done.length === 0;
    doneCount.textContent = '(' + done.length + ')';

    tabs.forEach((t) => t.setAttribute('aria-current', String(t.dataset.cat === current)));
  }

  function switchTo(cat) {
    if (!CATEGORIES[cat] || cat === current) return;
    current = cat;
    history.replaceState(null, '', '#' + cat);
    store.set(TAB_KEY, cat);
    doneWrap.open = false;
    render();
    window.scrollTo(0, 0);
  }

  // ---------- User actions ----------
  function deleteWithConfirm(id) {
    const item = findItem(id);
    if (!item) return;
    if (!confirm('Delete "' + item.text + '"?')) return;
    commit({ type: 'delete', id });
  }

  function startEdit(li) {
    const id = li.dataset.id;
    const item = findItem(id);
    const textEl = li.querySelector('.text');
    if (!item || !textEl || li.querySelector('input')) return;

    editing = true;
    const original = item.text;
    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'text';
    field.value = original;
    field.setAttribute('aria-label', 'Edit item');
    field.setAttribute('enterkeyhint', 'done');
    Object.assign(field.style, {
      font: 'inherit', color: 'inherit', background: 'transparent',
      border: '0', outline: 'none', padding: '12px 0', fontSize: '16px',
    });
    textEl.replaceWith(field);
    let finished = false;

    // While editing, the drag handle becomes a delete button.
    const handle = li.querySelector('.handle');
    if (handle) {
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.setAttribute('aria-label', 'Delete');
      del.innerHTML = ICON_X;
      // pointerdown fires before the input's blur, so the delete wins.
      del.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        finished = true;
        editing = false;
        commit({ type: 'delete', id });
      });
      handle.replaceWith(del);
    }

    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);

    const finish = (save) => {
      if (finished) return;
      finished = true;
      editing = false;
      const value = field.value.trim();
      if (save && value !== original) {
        commit(value ? { type: 'edit', id, text: value } : { type: 'delete', id });
      } else {
        render();
      }
    };
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') finish(false);
    });
    field.addEventListener('blur', () => finish(true));
  }

  // ---------- Drag to reorder ----------
  let drag = null;

  function onPointerDown(e) {
    const handle = e.target.closest('[data-action="drag"]');
    if (!handle || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();

    const li = handle.closest('li');
    const lis = [...activeEl.children];
    const index = lis.indexOf(li);
    const sy = window.scrollY;
    const rects = lis.map((el) => {
      const r = el.getBoundingClientRect();
      return { mid: r.top + sy + r.height / 2, h: r.height };
    });

    drag = {
      handle, li, lis, index, rects,
      target: index,
      shift: rects[index].h + GAP,
      startPageY: e.clientY + sy,
      pointerY: e.clientY,
      raf: 0,
    };

    handle.setPointerCapture(e.pointerId);
    li.classList.add('dragging');
    lis.forEach((el) => { if (el !== li) el.classList.add('shifting'); });
    if (navigator.vibrate) navigator.vibrate(8);

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerEnd);
    handle.addEventListener('pointercancel', onPointerEnd);
    tick();
  }

  function onPointerMove(e) {
    if (drag) drag.pointerY = e.clientY;
  }

  function tick() {
    if (!drag) return;

    const navH = document.querySelector('.tabs').offsetHeight;
    const edge = 70;
    const y = drag.pointerY;
    if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 6));
    else if (y > window.innerHeight - navH - edge) {
      window.scrollBy(0, Math.ceil((y - (window.innerHeight - navH - edge)) / 6));
    }

    const { li, lis, index, rects, shift } = drag;
    const dy = y + window.scrollY - drag.startPageY;
    li.style.transform = 'translateY(' + dy + 'px)';

    const mid = rects[index].mid + dy;
    let target = index;
    for (let i = index + 1; i < rects.length; i++) if (mid > rects[i].mid) target = i;
    for (let i = index - 1; i >= 0; i--) if (mid < rects[i].mid) target = i;
    drag.target = target;

    lis.forEach((el, i) => {
      if (i === index) return;
      let t = '';
      if (i > index && i <= target) t = 'translateY(' + -shift + 'px)';
      else if (i < index && i >= target) t = 'translateY(' + shift + 'px)';
      el.style.transform = t;
    });

    drag.raf = requestAnimationFrame(tick);
  }

  function onPointerEnd() {
    if (!drag) return;
    const { handle, lis, index, target, raf } = drag;
    cancelAnimationFrame(raf);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerEnd);
    handle.removeEventListener('pointercancel', onPointerEnd);
    drag = null;

    if (target === index) { render(); return; }
    const ids = lis.map((el) => el.dataset.id);
    const [id] = ids.splice(index, 1);
    ids.splice(target, 0, id);
    commit({ type: 'move', id, afterId: target === 0 ? null : ids[target - 1] });
  }

  // ---------- Events ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    commit({ type: 'add', item: { id: uid(), text, done: false } });
    input.value = '';
    input.focus();
  });

  activeEl.addEventListener('pointerdown', onPointerDown);

  function onListClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const li = target.closest('li');
    const id = li && li.dataset.id;
    switch (target.dataset.action) {
      case 'toggle': {
        const item = findItem(id);
        if (item) commit({ type: 'toggle', id, done: !item.done, at: Date.now() });
        break;
      }
      case 'delete': deleteWithConfirm(id); break;
      case 'edit': startEdit(li); break;
    }
  }
  activeEl.addEventListener('click', onListClick);
  doneEl.addEventListener('click', onListClick);

  // Keyboard reordering on the handle.
  activeEl.addEventListener('keydown', (e) => {
    const handle = e.target.closest('[data-action="drag"]');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = handle.closest('li').dataset.id;
    const ids = activeItems().map((i) => i.id);
    const from = ids.indexOf(id);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    commit({ type: 'move', id, afterId: to === 0 ? null : ids[to - 1] });
    const moved = activeEl.querySelector('[data-id="' + id + '"] [data-action="drag"]');
    if (moved) moved.focus();
  });

  // Flush deferred renders once editing/dragging ends.
  document.addEventListener('pointerup', () => { if (renderDeferred) setTimeout(renderIfIdle, 0); });
  document.addEventListener('focusout', () => { if (renderDeferred) setTimeout(renderIfIdle, 0); });

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (btn) switchTo(btn.dataset.cat);
  });

  window.addEventListener('hashchange', () => switchTo(location.hash.slice(1)));

  // Refresh when the app comes back to the foreground, reconnects, or periodically.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => setStatus('offline'));
  setInterval(() => { if (!document.hidden) sync(); }, POLL_MS);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  history.replaceState(null, '', '#' + current);
  render();
  setStatus(navigator.onLine ? 'ok' : 'offline');
  if (passcode) sync(); else showLock();
})();
