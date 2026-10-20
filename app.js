(() => {
  'use strict';

  const STORAGE_KEY = 'the-list:v1';
  const CATEGORIES = {
    books:  { title: 'Books',  placeholder: 'Add a book' },
    comics: { title: 'Comics', placeholder: 'Add a comic' },
    movies: { title: 'Movies', placeholder: 'Add a movie' },
    shows:  { title: 'Shows',  placeholder: 'Add a show' },
    albums: { title: 'Albums', placeholder: 'Add an album' },
  };
  const GAP = 6; // must match .item margin-bottom

  const $ = (id) => document.getElementById(id);
  const titleEl = $('title');
  const countEl = $('count');
  const form = $('add-form');
  const input = $('add-input');
  const activeEl = $('active');
  const doneEl = $('done');
  const doneWrap = $('done-wrap');
  const doneCount = $('done-count');
  const emptyEl = $('empty');
  const tabs = [...document.querySelectorAll('.tabs button')];

  // ---------- State ----------
  let data = load();
  let current = pickInitialCategory();

  function load() {
    let parsed = {};
    try { parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (_) {}
    const out = {};
    for (const key of Object.keys(CATEGORIES)) {
      out[key] = Array.isArray(parsed[key]) ? parsed[key] : [];
    }
    return out;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function pickInitialCategory() {
    const fromHash = location.hash.slice(1);
    if (CATEGORIES[fromHash]) return fromHash;
    try {
      const last = localStorage.getItem(STORAGE_KEY + ':tab');
      if (CATEGORIES[last]) return last;
    } catch (_) {}
    return 'books';
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const list = () => data[current];
  const activeItems = () => list().filter((i) => !i.done);
  const doneItems = () => list().filter((i) => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

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

    if (!item.done) {
      const handle = document.createElement('button');
      handle.className = 'icon-btn handle';
      handle.dataset.action = 'drag';
      handle.setAttribute('aria-label', 'Reorder (drag, or use arrow keys)');
      handle.innerHTML = ICON_GRIP;
      li.append(handle);
    } else {
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.dataset.action = 'delete';
      del.setAttribute('aria-label', 'Delete');
      del.innerHTML = ICON_X;
      li.append(del);
    }
    return li;
  }

  function render() {
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
    try { localStorage.setItem(STORAGE_KEY + ':tab', cat); } catch (_) {}
    doneWrap.open = false;
    render();
    window.scrollTo(0, 0);
  }

  // ---------- Mutations ----------
  function addItem(text) {
    // New items go to the bottom of the active list.
    const items = list();
    const firstDone = items.findIndex((i) => i.done);
    const item = { id: uid(), text, done: false };
    if (firstDone === -1) items.push(item); else items.splice(firstDone, 0, item);
    save();
    render();
  }

  function findItem(id) { return list().find((i) => i.id === id); }

  function toggleItem(id) {
    const item = findItem(id);
    if (!item) return;
    item.done = !item.done;
    if (item.done) {
      item.doneAt = Date.now();
    } else {
      delete item.doneAt;
      // Return un-checked items to the bottom of the active list.
      const rest = list().filter((i) => i !== item);
      const active = rest.filter((i) => !i.done);
      data[current] = [...active, item, ...rest.filter((i) => i.done)];
    }
    save();
    render();
  }

  function deleteItem(id) {
    const item = findItem(id);
    if (!item) return;
    if (!confirm('Delete "' + item.text + '"?')) return;
    data[current] = list().filter((i) => i.id !== id);
    save();
    render();
  }

  function moveActive(from, to) {
    const active = activeItems();
    if (to < 0 || to >= active.length || from === to) return false;
    const [moved] = active.splice(from, 1);
    active.splice(to, 0, moved);
    data[current] = [...active, ...list().filter((i) => i.done)];
    save();
    return true;
  }

  function startEdit(li) {
    const id = li.dataset.id;
    const item = findItem(id);
    const textEl = li.querySelector('.text');
    if (!item || !textEl || li.querySelector('input')) return;

    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'text';
    field.value = item.text;
    field.setAttribute('aria-label', 'Edit item');
    field.setAttribute('enterkeyhint', 'done');
    Object.assign(field.style, {
      font: 'inherit', color: 'inherit', background: 'transparent',
      border: '0', outline: 'none', padding: '12px 0', fontSize: '16px',
    });
    textEl.replaceWith(field);
    let finished = false;

    // While editing, swap the drag handle for a delete button.
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
        data[current] = list().filter((i) => i.id !== id);
        save();
        render();
      });
      handle.replaceWith(del);
    }

    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);

    const finish = (commit) => {
      if (finished) return;
      finished = true;
      const value = field.value.trim();
      if (commit && value !== item.text) {
        if (value) item.text = value;
        else data[current] = list().filter((i) => i.id !== id); // cleared = delete
        save();
      }
      render();
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

    // Auto-scroll near the top/bottom edges.
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
    const { handle, index, target, raf } = drag;
    cancelAnimationFrame(raf);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerEnd);
    handle.removeEventListener('pointercancel', onPointerEnd);
    drag = null;
    moveActive(index, target);
    render();
  }

  // ---------- Events ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addItem(text);
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
      case 'toggle': toggleItem(id); break;
      case 'delete': deleteItem(id); break;
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
    const from = activeItems().findIndex((i) => i.id === id);
    if (moveActive(from, from + (e.key === 'ArrowUp' ? -1 : 1))) {
      render();
      const moved = activeEl.querySelector('[data-id="' + id + '"] [data-action="drag"]');
      if (moved) moved.focus();
    }
  });

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (btn) switchTo(btn.dataset.cat);
  });

  window.addEventListener('hashchange', () => switchTo(location.hash.slice(1)));

  // Keep lists in sync across tabs/windows.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) { data = load(); render(); }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  history.replaceState(null, '', '#' + current);
  render();
})();
