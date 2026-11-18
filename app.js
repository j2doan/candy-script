// Candy Tracker – all state lives in one object, auto-saved to localStorage (+ optional linked file).
const KEY = 'candy-tracker';
let state = { players: [], queue: [], records: [], notes: [], ui: { date: '', time: null, event: '', player: null } };
let fileHandle = null;

function timeLabel(t) {
  if (t === -1) return 'Special';
  const h = t % 12 === 0 ? 12 : t % 12;
  return h + ':00' + (t < 12 ? 'AM' : 'PM');
}

const slotKey = (e) => e.date + '|' + e.time + '|' + e.event;

// Sortable number for dates like "Oct 3", "October 3", "10/3". shortcut: ignores year; unparsable dates sort last.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dateKey(d) {
  let m = /^([a-z]{3})[a-z]*\.?\s*(\d{1,2})/i.exec(d.trim());
  if (m && MONTHS.includes(m[1].toLowerCase())) return (MONTHS.indexOf(m[1].toLowerCase()) + 1) * 100 + Number(m[2]);
  m = /^(\d{1,2})\/(\d{1,2})/.exec(d.trim());
  if (m) return Number(m[1]) * 100 + Number(m[2]);
  return Infinity;
}

// Pure: players × slots. Cell = {value, recordId}. value is a number, 'pending', or 'NaN'.
function buildTable(s) {
  const slots = [];
  const seen = new Set();
  for (const e of [...s.records, ...[...s.queue].reverse()]) {
    const k = slotKey(e);
    if (!seen.has(k)) { seen.add(k); slots.push({ key: k, date: e.date, time: e.time, event: e.event }); }
  }
  slots.sort((a, b) => (dateKey(a.date) - dateKey(b.date)) || (a.time - b.time)); // stable: ties keep entry order
  const rows = s.players.map((p) => ({
    player: p,
    cells: slots.map((sl) => {
      const rec = s.records.findLast((r) => r.player === p && slotKey(r) === sl.key);
      if (rec) return { value: rec.candy, recordId: rec.id };
      if (s.queue.some((q) => q.player === p && slotKey(q) === sl.key)) return { value: 'pending' };
      return { value: 'NaN' };
    }),
  }));
  return { slots, rows };
}

function save() {
  const json = JSON.stringify(state, null, 2);
  try { localStorage.setItem(KEY, json); } catch (e) { console.error(e); }
  if (fileHandle) {
    fileHandle.createWritable()
      .then(async (w) => { await w.write(json); await w.close(); })
      .catch((e) => { alert('Could not write linked file: ' + e.message); fileHandle = null; updateLinkLabel(); });
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
  } catch (e) { console.error(e); }
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const $ = (id) => document.getElementById(id);

// In-page "click again to confirm" (browser confirm() can be silently disabled by the user).
function confirmClick(action) {
  return (ev) => {
    const btn = ev.currentTarget;
    if (btn.dataset.armed) {
      btn.textContent = btn.dataset.armed;
      delete btn.dataset.armed;
      return action();
    }
    btn.dataset.armed = btn.textContent;
    btn.textContent = 'Sure?';
    setTimeout(() => { if (btn.dataset.armed) { btn.textContent = btn.dataset.armed; delete btn.dataset.armed; } }, 3000);
  };
}
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...kids);
  return n;
}

function renderTimes() {
  const box = $('times');
  box.replaceChildren();
  const TOP = [0, 20, 19]; // most-used times first
  const rest = Array.from({ length: 25 }, (_, i) => i - 1).filter((t) => !TOP.includes(t));
  for (const t of [...TOP, ...rest]) {
    box.append(el('button', {
      style: t === TOP.at(-1) ? 'margin-bottom:8px' : '',
      textContent: timeLabel(t),
      className: state.ui.time === t ? 'on' : '',
      onclick: () => { state.ui.time = t; save(); renderTimes(); },
    }));
  }
}

function renderPlayers() {
  const box = $('players');
  box.replaceChildren();
  state.players.forEach((p, i) => {
    box.append(el('div', { className: 'row' },
      el('button', {
        textContent: p,
        className: 'grow ' + (state.ui.player === p ? 'on' : ''),
        onclick: () => { state.ui.player = p; save(); renderPlayers(); },
      }),
      el('button', {
        textContent: '✎', title: 'Rename',
        onclick: (ev) => { // rename inline; Enter saves, Esc cancels
          const inp = el('input', { value: p, size: 10, className: 'grow' });
          ev.currentTarget.parentElement.firstChild.replaceWith(inp);
          inp.focus();
          inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = p; inp.blur(); } };
          inp.onblur = () => {
            const n = inp.value.trim();
            if (n && n !== p && !state.players.includes(n)) {
              state.players[i] = n;
              for (const e of [...state.queue, ...state.records, ...state.notes]) if (e.player === p) e.player = n;
              if (state.ui.player === p) state.ui.player = n;
              save();
            }
            renderAll();
          };
        },
      }),
      el('button', {
        textContent: '✕', title: 'Remove',
        onclick: confirmClick(() => { // their entries are kept
          state.players.splice(i, 1);
          if (state.ui.player === p) state.ui.player = null;
          save(); renderAll();
        }),
      }),
    ));
  });
}

function renderQueue() {
  const box = $('queue');
  box.replaceChildren();
  for (const q of state.queue) {
    const input = el('input', { type: 'number', placeholder: 'candy', className: 'candy' });
    const confirmIt = () => {
      if (input.value === '') return input.focus();
      state.queue = state.queue.filter((x) => x !== q);
      state.records.push({ ...q, candy: Number(input.value) });
      save(); renderQueue(); renderTable();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') confirmIt(); };
    box.append(el('div', { className: 'item' },
      el('span', { className: 'grow', textContent: `${q.date} ${timeLabel(q.time)} · ${q.event} · ${q.player}` }),
      input,
      el('button', { textContent: '✓', title: 'Confirm', onclick: confirmIt }),
      el('button', {
        textContent: '✕', title: 'Delete',
        onclick: confirmClick(() => { state.queue = state.queue.filter((x) => x !== q); save(); renderQueue(); renderTable(); }),
      }),
    ));
  }
  $('queue-count').textContent = state.queue.length;
}

function renderNotes() {
  $('notes').replaceChildren(...state.notes.map((n) => {
    const text = el('span', { className: 'grow', textContent: n.text, contentEditable: 'true' });
    text.onblur = () => { n.text = text.textContent; save(); };
    const ctx = [n.date, n.time === null ? '' : timeLabel(n.time), n.event, n.player].filter(Boolean).join(' · ');
    return el('div', { className: 'item' },
      el('small', { textContent: ctx + ':' }),
      text,
      el('button', {
        textContent: '✕', title: 'Delete',
        onclick: confirmClick(() => { state.notes = state.notes.filter((x) => x !== n); save(); renderNotes(); }),
      }),
    );
  }));
}

let tableShown = false;
const slotLabel = (s) => `${s.date}\n${timeLabel(s.time)}\n${s.event}`;

// Pure: header + rows of [label, ...cells]. byEvent = rotated (rows events, cols players).
function grid(s, byEvent) {
  const { slots, rows } = buildTable(s);
  if (!byEvent) return { header: ['Player', ...slots.map(slotLabel)], rows: rows.map((r) => [r.player, ...r.cells]) };
  return { header: ['Event', ...rows.map((r) => r.player)], rows: slots.map((sl, j) => [slotLabel(sl), ...rows.map((r) => r.cells[j])]) };
}

function renderGrid(tableEl, byEvent, other) {
  const { header, rows } = grid(state, byEvent);
  tableEl.replaceChildren(
    el('tr', {}, ...header.map((h) => el('th', { textContent: h }))),
    ...rows.map(([label, ...cells]) => el('tr', {}, el('th', { textContent: label }),
      ...cells.map((c) => {
        const td = el('td', { textContent: c.value, className: typeof c.value === 'number' ? '' : c.value });
        if (c.recordId != null) {
          td.contentEditable = 'true';
          td.onblur = () => {
            const rec = state.records.find((x) => x.id === c.recordId);
            const v = td.textContent.trim();
            if (v === '' || isNaN(Number(v))) { td.textContent = rec.candy; return; }
            if (rec.candy !== Number(v)) { rec.candy = Number(v); save(); other(); }
          };
        }
        return td;
      }))),
  );
}

const renderByPlayer = () => renderGrid($('table'), false, renderByEvent);
const renderByEvent = () => renderGrid($('table2'), true, renderByPlayer);
function renderTable() {
  if (!tableShown) return;
  renderByPlayer(); renderByEvent();
}

// Plain values for export: header + rows of strings/numbers.
function gridValues(byEvent) {
  const { header, rows } = grid(state, byEvent);
  const flat = (h) => h.replace(/\n/g, ' ');
  return [header.map(flat), ...rows.map(([label, ...cells]) => [flat(label), ...cells.map((c) => c.value)])];
}

function tableCsv() {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  return gridValues(false).map((r) => r.map(q).join(',')).join('\n');
}

function updateLinkLabel() {
  $('link').textContent = fileHandle ? 'Linked: ' + fileHandle.name : 'Link save file';
}

function renderAll() {
  $('date').value = state.ui.date;
  $('event').value = state.ui.event;
  renderTimes(); renderPlayers(); renderQueue(); renderNotes(); renderTable();
}

function init() {
  load();
  $('date').oninput = (e) => { state.ui.date = e.target.value; save(); };
  $('event').oninput = (e) => { state.ui.event = e.target.value; save(); };

  const addPlayer = () => {
    const n = $('new-player').value.trim();
    if (!n) return;
    if (state.players.includes(n)) return alert('Player already exists');
    state.players.push(n);
    $('new-player').value = '';
    save(); renderPlayers(); renderTable();
  };
  $('add-player').onclick = addPlayer;
  $('new-player').onkeydown = (e) => { if (e.key === 'Enter') addPlayer(); };

  $('submit').onclick = () => {
    const u = state.ui;
    if (!u.date.trim() || u.time === null || !u.event.trim() || !u.player) return alert('Fill in date, time, event and player.');
    state.queue.push({ id: Date.now() + Math.random(), date: u.date.trim(), time: u.time, event: u.event.trim(), player: u.player, candy: null });
    save(); renderQueue(); renderTable();
  };

  $('add-note').onclick = () => {
    const text = $('note-text').value.trim();
    if (!text) return;
    const u = state.ui;
    state.notes.push({ id: Date.now() + Math.random(), date: u.date.trim(), time: u.time, event: u.event.trim(), player: u.player, text });
    $('note-text').value = '';
    save(); renderNotes();
  };

  $('organize').onclick = () => { tableShown = true; renderTable(); $('table-wrap').hidden = false; };
  // Full state (re-importable) + both tables as plain arrays. Comments are state.notes.
  $('dl-json').onclick = () => download('candy-data.json',
    JSON.stringify({ ...state, tables: { byPlayer: gridValues(false), byEvent: gridValues(true) } }, null, 2), 'application/json');
  $('dl-csv').onclick = () => download('candy-table.csv', tableCsv(), 'text/csv');
  $('import').onclick = confirmClick(() => $('import-file').click()); // import replaces ALL data
  $('import-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.players) || !Array.isArray(data.queue) || !Array.isArray(data.records)) throw new Error('missing players/queue/records');
      delete data.tables; // derived, rebuilt from records
      state = { ...state, notes: [], ...data }; // older files have no notes
      save(); renderAll();
    } catch (err) { alert('Import failed: ' + err.message); }
  };

  $('link').title = 'The chosen file is OVERWRITTEN with current data. To restore from a file, use Import first.';
  $('link').onclick = confirmClick(async () => {
    if (!window.showSaveFilePicker) return alert('This browser cannot write to files. Use Chrome/Edge, or rely on Download JSON.');
    try {
      fileHandle = await showSaveFilePicker({ suggestedName: 'data.json', types: [{ accept: { 'application/json': ['.json'] } }] });
      updateLinkLabel(); save();
    } catch (e) { if (e.name !== 'AbortError') alert(e.message); }
  });

  renderAll();
}

if (typeof document !== 'undefined' && document.getElementById('app')) init();
