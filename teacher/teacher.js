/* teacher.js — Kodislovo Teacher Panel (matches current teacher/index.html)
   Features:
   - Theme toggle via checkbox #themeToggle + label #themeLabel (stored in localStorage)
   - Loads manifest.json for selected subject to get teacher.base_url + teacher.token
   - Buttons:
     #btnTimerLoad -> /teacher/config/get
     #btnTimerSave -> /teacher/config/set
     #btnResetMake -> /teacher/reset (creates reset code)
     #btnList -> /teacher/list (loads results list)
     #btnVoidSelected -> /teacher/void (void selected)
   - Row actions: Open JSON, Download JSON, Print (PDF via print), Void
*/

(() => {
  "use strict";

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const htmlEl = document.documentElement;

  const els = {
    themeLabel: $("themeLabel"),
    themeToggle: $("themeToggle"),

    subjectSelect: $("subjectSelect"),
    resetVariant: $("resetVariant"),
    timerMinutes: $("timerMinutes"),
    resetClass: $("resetClass"),
    resetFio: $("resetFio"),

    btnTimerLoad: $("btnTimerLoad"),
    btnTimerSave: $("btnTimerSave"),
    btnResetMake: $("btnResetMake"),

    statusLine: $("statusLine"),

    btnList: $("btnList"),
    btnVoidSelected: $("btnVoidSelected"),
    classFilter: $("classFilter"),
    variantFilter: $("variantFilter"),
    fioSearch: $("fioSearch"),

    resultsTbody: $("resultsTbody"),
    jsonViewer: $("jsonViewer"),
  };

  function setStatus(msg, kind = "info") {
    if (!els.statusLine) return;
    els.statusLine.textContent = msg;
    els.statusLine.style.borderColor =
      kind === "error" ? "rgba(255,91,110,.55)" :
      kind === "ok"    ? "rgba(53,208,127,.55)" :
                         "rgba(255,255,255,.12)";
    els.statusLine.style.color =
      kind === "error" ? "var(--bad)" :
      kind === "ok"    ? "var(--ok)" :
                         "var(--text)";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function repoPrefixGuess() {
    // GitHub Pages: https://user.github.io/<repo>/...
    const parts = location.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    // If teacher lives under repo folder (repo name contains dots: app.kodislovo.ru)
    if (parts[0].includes(".")) return "/" + parts[0];
    return "";
  }

  function manifestUrlFor(subject) {
    const prefix = repoPrefixGuess();
    const withPrefix = `${prefix}/controls/${subject}/variants/manifest.json`;
    const noPrefix = `/controls/${subject}/variants/manifest.json`;
    return { withPrefix, noPrefix };
  }

  async function fetchJson(url) {
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || text || `${r.status} ${r.statusText}`;
      throw new Error(`HTTP ${r.status}: ${msg}`);
    }
    return data;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, filename);
  }

  function toCsv(rows) {
    const cols = Array.from(rows.reduce((s, r) => {
      Object.keys(r || {}).forEach(k => s.add(k));
      return s;
    }, new Set()));

    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = cols.map(esc).join(";");
    const body = rows.map(r => cols.map(c => esc(r?.[c])).join(";")).join("\r\n");
    return header + "\r\n" + body;
  }

  // ---------- Theme ----------
  const THEME_KEY = "kodislovo_teacher_theme";
  function applyTheme(theme) {
    const t = (theme === "light") ? "light" : "dark";
    htmlEl.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    if (els.themeToggle) els.themeToggle.checked = (t === "light");
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const initial = saved || htmlEl.getAttribute("data-theme") || "dark";
    applyTheme(initial);

    if (els.themeToggle) {
      els.themeToggle.addEventListener("change", () => {
        applyTheme(els.themeToggle.checked ? "light" : "dark");
      });
    }
    // allow clicking label area too
    if (els.themeLabel) {
      els.themeLabel.style.cursor = "pointer";
      els.themeLabel.addEventListener("click", () => {
        if (!els.themeToggle) return;
        els.themeToggle.checked = !els.themeToggle.checked;
        els.themeToggle.dispatchEvent(new Event("change"));
      });
    }
  }

  // ---------- State ----------
  const state = {
    subject: "russian",
    manifest: null,
    manifestUrl: null,
    baseUrl: "",
    token: "",
    items: [],
    selectedKeys: new Set(),
    lastJson: null,
  };

  function normalizeItem(x) {
    const key = x?.key || x?.id || x?.resultKey || x?.objectKey || x?.storageKey || "";
    const created = x?.createdAt || x?.created_at || x?.submittedAt || x?.submitted_at || x?.ts || x?.timestamp || "";
    const fio = x?.fio || x?.student || x?.studentName || x?.name || "";
    const cls = x?.class || x?.klass || x?.grade || x?.group || "";
    const variant = x?.variant || x?.variantId || x?.variant_id || x?.variantTitle || "";
    const voided = !!(x?.voided || x?.isVoided || x?.deleted || x?.archived);

    return {
      ...x,
      __key: String(key || ""),
      __created: created,
      __fio: fio,
      __class: cls,
      __variant: variant,
      __voided: voided
    };
  }

  // ---------- API ----------
  async function apiCall(path, { method = "GET", params = null, body = null } = {}) {
    if (!state.baseUrl) throw new Error("teacher.base_url не задан (не загрузился manifest?)");
    if (!state.token) throw new Error("teacher.token не задан (не загрузился manifest?)");

    const url = new URL(path.replace(/^\//, ""), state.baseUrl.endsWith("/") ? state.baseUrl : state.baseUrl + "/");
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== "") url.searchParams.set(k, String(v));
      });
    }

    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("X-Teacher-Token", state.token);
    headers.set("Authorization", `Bearer ${state.token}`);
    if (body !== null) headers.set("Content-Type", "application/json;charset=utf-8");

    const r = await fetch(url.toString(), {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });

    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || (typeof data === "string" ? data : "") || `${r.status} ${r.statusText}`;
      throw new Error(`API ${r.status}: ${msg}`);
    }
    return data;
  }

  async function loadManifestForSubject(subject) {
    const { withPrefix, noPrefix } = manifestUrlFor(subject);
    let lastErr = null;

    for (const url of [withPrefix, noPrefix]) {
      try {
        const m = await fetchJson(url);
        state.manifest = m;
        state.manifestUrl = url;
        state.baseUrl = (m?.teacher?.base_url || m?.teacher?.baseUrl || "").trim();
        state.token = (m?.teacher?.token || "").trim();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Не удалось загрузить manifest.json");
  }

  // ---------- Rendering ----------
  function currentFilters() {
    return {
      cls: (els.classFilter?.value || "").trim(),
      variant: (els.variantFilter?.value || "").trim(),
      q: (els.fioSearch?.value || "").trim(),
    };
  }

  function renderList() {
    const tb = els.resultsTbody;
    if (!tb) return;
    tb.innerHTML = "";

    const q = (els.fioSearch?.value || "").trim().toLowerCase();
    const clsFilter = (els.classFilter?.value || "").trim().toLowerCase();
    const varFilter = (els.variantFilter?.value || "").trim().toLowerCase();

    const filtered = state.items.filter(it => {
      if (clsFilter && String(it.__class || "").toLowerCase().indexOf(clsFilter) === -1) return false;
      if (varFilter && String(it.__variant || "").toLowerCase().indexOf(varFilter) === -1) return false;
      if (q) {
        const hay = `${it.__fio} ${it.__class} ${it.__variant} ${it.__key}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" style="padding:12px;opacity:.8">Нет результатов</td>`;
      tb.appendChild(tr);
      return;
    }

    for (const it of filtered) {
      const tr = document.createElement("tr");
      tr.dataset.key = it.__key;

      const checked = state.selectedKeys.has(it.__key) ? "checked" : "";
      tr.innerHTML = `
        <td style="width:44px">
          <input type="checkbox" class="kd-check" data-action="select" ${checked} />
        </td>
        <td style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace;font-size:12px">${escapeHtml(it.__key)}</td>
        <td>${escapeHtml(it.__fio)}</td>
        <td>${escapeHtml(it.__class)}</td>
        <td>${escapeHtml(it.__variant)}</td>
        <td style="opacity:.85">${escapeHtml(it.__created ? new Date(it.__created).toLocaleString() : "")}</td>
        <td style="white-space:nowrap">
          <button class="kd-btn secondary" data-action="open">Открыть</button>
          <button class="kd-btn secondary" data-action="download">JSON</button>
          <button class="kd-btn secondary" data-action="print">PDF</button>
          <button class="kd-btn secondary" data-action="void" style="border-color:rgba(255,91,110,.55);color:var(--bad);background:transparent">Void</button>
        </td>
      `;

      tb.appendChild(tr);
    }
  }

  async function openJsonForKey(key) {
    setStatus("Получаю JSON…");
    const data = await apiCall("/teacher/get", { params: { key, subject: state.subject } });
    state.lastJson = data;
    if (els.jsonViewer) els.jsonViewer.value = JSON.stringify(data, null, 2);
    setStatus("JSON загружен.", "ok");
  }

  function openPrintWindow(payload) {
    const w = window.open("", "_blank");
    if (!w) {
      setStatus("Браузер заблокировал popup — разрешите всплывающие окна.", "error");
      return;
    }

    const cssPrefix = repoPrefixGuess();
    const css1 = `${cssPrefix}/assets/css/control-ui.css`;
    const css2 = `/assets/css/control-ui.css`;
    const theme = htmlEl.getAttribute("data-theme") || "dark";

    w.document.open();
    w.document.write(`
      <!doctype html>
      <html lang="ru" data-theme="${escapeHtml(theme)}">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Кодислово — PDF</title>
        <link rel="stylesheet" href="${css1}">
        <link rel="stylesheet" href="${css2}">
        <style>
          body{padding:16px}
          pre{white-space:pre-wrap;word-break:break-word;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
          .toolbar{position:sticky;top:0;background:rgba(0,0,0,.25);backdrop-filter:blur(8px);padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:14px;margin-bottom:12px}
          .btn{padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
          @media print {.toolbar{display:none} body{padding:0}}
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button class="btn" onclick="window.print()">Печать / Сохранить в PDF</button>
        </div>
        <h2 style="margin:0 0 12px">Результат</h2>
        <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
      </body>
      </html>
    `);
    w.document.close();
  }

  // ---------- Actions ----------
  async function doList() {
    try {
      setStatus("Загрузка списка…");
      const { cls, variant, q } = currentFilters();
      const data = await apiCall("/teacher/list", {
        params: { subject: state.subject, cls, class: cls, variant, q }
      });

      const arr = Array.isArray(data)
        ? data
        : (Array.isArray(data?.items) ? data.items
        : (Array.isArray(data?.results) ? data.results : []));

      state.items = arr.map(normalizeItem).sort((a, b) => {
        const ta = new Date(a.__created || 0).getTime();
        const tb = new Date(b.__created || 0).getTime();
        return (tb || 0) - (ta || 0);
      });

      // keep selection only for existing keys
      const keys = new Set(state.items.map(x => x.__key));
      state.selectedKeys.forEach(k => { if (!keys.has(k)) state.selectedKeys.delete(k); });

      renderList();
      setStatus(`Загружено: ${state.items.length}`, "ok");
    } catch (e) {
      console.error(e);
      setStatus(`Ошибка list: ${e.message}`, "error");
    }
  }

  async function doVoidOne(key) {
    await apiCall("/teacher/void", { method: "POST", body: { key, subject: state.subject } });
  }

  async function doVoidSelected() {
    const keys = Array.from(state.selectedKeys);
    if (!keys.length) {
      setStatus("Ничего не выделено.", "error");
      return;
    }
    try {
      setStatus(`Аннулирую: ${keys.length}…`);
      for (const k of keys) {
        await doVoidOne(k);
      }
      state.selectedKeys.clear();
      setStatus("Готово ✅", "ok");
      await doList();
    } catch (e) {
      console.error(e);
      setStatus(`Ошибка void: ${e.message}`, "error");
    }
  }

  async function doTimerLoad() {
    try {
      setStatus("Загружаю таймер…");
      const data = await apiCall("/teacher/config/get", { params: { subject: state.subject } });
      // allow {timerMinutes: N} or {config:{timerMinutes:N}}
      const minutes = data?.timerMinutes ?? data?.config?.timerMinutes ?? data?.timer ?? data?.config?.timer ?? "";
      if (els.timerMinutes) els.timerMinutes.value = String(minutes ?? "");
      setStatus("Таймер загружен.", "ok");
    } catch (e) {
      console.error(e);
      setStatus(`Ошибка config/get: ${e.message}`, "error");
    }
  }

  async function doTimerSave() {
    try {
      const minutes = Number(els.timerMinutes?.value || 0);
      setStatus("Сохраняю таймер…");
      await apiCall("/teacher/config/set", { method: "POST", body: { subject: state.subject, timerMinutes: minutes } });
      setStatus("Сохранено ✅", "ok");
    } catch (e) {
      console.error(e);
      setStatus(`Ошибка config/set: ${e.message}`, "error");
    }
  }

  async function doResetMake() {
    try {
      const variant = (els.resetVariant?.value || "").trim();
      const cls = (els.resetClass?.value || "").trim();
      const fio = (els.resetFio?.value || "").trim();

      if (!variant || !cls || !fio) {
        setStatus("Для reset-кода заполните: вариант, класс, ФИО.", "error");
        return;
      }

      setStatus("Создаю reset-код…");
      const data = await apiCall("/teacher/reset", {
        method: "POST",
        body: { subject: state.subject, variant, class: cls, fio }
      });

      const code = data?.code || data?.resetCode || data?.reset_code || data?.token || data?.value || "";
      if (!code) {
        setStatus("Reset-код не вернулся (проверь ответ /teacher/reset).", "error");
        if (els.jsonViewer) els.jsonViewer.value = JSON.stringify(data, null, 2);
        return;
      }

      // Copy to clipboard (best effort)
      try { await navigator.clipboard.writeText(String(code)); } catch {}
      setStatus(`Reset-код: ${code} (скопирован в буфер)`, "ok");
    } catch (e) {
      console.error(e);
      setStatus(`Ошибка reset: ${e.message}`, "error");
    }
  }

  // ---------- Events ----------
  function bindEvents() {
    els.subjectSelect?.addEventListener("change", async () => {
      state.subject = els.subjectSelect.value || "russian";
      try {
        setStatus("Загружаю manifest…");
        await loadManifestForSubject(state.subject);
        setStatus("Manifest загружен ✅", "ok");
        // refresh list for new subject
        await doList();
      } catch (e) {
        console.error(e);
        setStatus(`Manifest ошибка: ${e.message}`, "error");
      }
    });

    els.btnList?.addEventListener("click", (e) => { e.preventDefault(); doList(); });
    els.btnVoidSelected?.addEventListener("click", (e) => { e.preventDefault(); doVoidSelected(); });

    els.btnTimerLoad?.addEventListener("click", (e) => { e.preventDefault(); doTimerLoad(); });
    els.btnTimerSave?.addEventListener("click", (e) => { e.preventDefault(); doTimerSave(); });
    els.btnResetMake?.addEventListener("click", (e) => { e.preventDefault(); doResetMake(); });

    // live filter
    const rerender = () => renderList();
    els.classFilter?.addEventListener("input", rerender);
    els.variantFilter?.addEventListener("input", rerender);
    els.fioSearch?.addEventListener("input", rerender);

    // table actions (delegation)
    els.resultsTbody?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action], input[data-action]");
      if (!btn) return;

      const tr = e.target.closest("tr[data-key]");
      const key = tr?.dataset?.key || "";
      if (!key) return;

      const action = btn.getAttribute("data-action");
      if (action === "select") {
        const checked = btn.checked;
        if (checked) state.selectedKeys.add(key);
        else state.selectedKeys.delete(key);
        return;
      }

      try {
        if (action === "open") {
          await openJsonForKey(key);
        } else if (action === "download") {
          const data = await apiCall("/teacher/get", { params: { key, subject: state.subject } });
          downloadJson(data, `result_${state.subject}_${key.slice(0, 16)}.json`);
          setStatus("Скачано ✅", "ok");
        } else if (action === "print") {
          const data = await apiCall("/teacher/get", { params: { key, subject: state.subject } });
          openPrintWindow(data);
          setStatus("Окно печати открыто ✅", "ok");
        } else if (action === "void") {
          setStatus("Аннулирую…");
          await doVoidOne(key);
          setStatus("Void ✅", "ok");
          await doList();
        }
      } catch (err) {
        console.error(err);
        setStatus(`Ошибка: ${err.message}`, "error");
      }
    });
  }

  // ---------- Init ----------
  async function init() {
    initTheme();

    state.subject = els.subjectSelect?.value || "russian";

    try {
      setStatus("Загружаю manifest…");
      await loadManifestForSubject(state.subject);
      setStatus("Готово. Нажми «Загрузить list».", "ok");
    } catch (e) {
      console.error(e);
      setStatus(`Manifest ошибка: ${e.message}`, "error");
    }

    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
