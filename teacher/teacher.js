/* teacher.js — Kodislovo Teacher Panel
   - Robust binding: supports multiple possible element IDs + data-action attributes.
   - Theme toggle by click: <html data-theme="dark|light"> with localStorage persistence.
   - Loads manifest: /controls/{subject}/variants/manifest.json (supports GitHub Pages repo prefix).
   - Uses manifest.teacher.base_url + manifest.teacher.token by default.
   - API: /teacher/list, /teacher/get, /teacher/void (delete fallback -> void), /teacher/config/get|set, /teacher/reset (not auto-called).
*/
(() => {
  "use strict";

  // ---------- Small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function pickEl(candidates) {
    for (const sel of candidates) {
      const el = $(sel);
      if (el) return el;
    }
    return null;
  }

  function safeText(v) {
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function isoToLocal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleString();
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
    // rows: array of objects
    const cols = Array.from(
      rows.reduce((s, r) => {
        Object.keys(r || {}).forEach((k) => s.add(k));
        return s;
      }, new Set())
    );

    const esc = (val) => {
      const s = safeText(val);
      if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = cols.map(esc).join(";");
    const lines = rows.map((r) => cols.map((c) => esc(r?.[c])).join(";"));
    return [header, ...lines].join("\r\n");
  }

  // ---------- Toast / status ----------
  function ensureStatusNode() {
    // Prefer existing nodes in current HTML
    const status = pickEl([
      "#status",
      "#statusText",
      "#toast",
      "[data-role='status']",
      ".status",
      ".toast",
      "#msg",
    ]);
    if (status) return status;

    // Create minimal status area (non-invasive)
    const div = document.createElement("div");
    div.id = "status";
    div.style.position = "sticky";
    div.style.top = "0";
    div.style.zIndex = "50";
    div.style.padding = "10px 12px";
    div.style.background = "rgba(0,0,0,.25)";
    div.style.backdropFilter = "blur(8px)";
    div.style.borderBottom = "1px solid rgba(255,255,255,.12)";
    div.style.fontSize = "14px";
    div.style.display = "none";
    document.body.prepend(div);
    return div;
  }

  const statusNode = ensureStatusNode();

  function showStatus(msg, kind = "info", persistMs = 3500) {
    if (!statusNode) return;
    statusNode.textContent = msg;

    // Minimal coloring without assuming CSS variables exist
    statusNode.style.display = "block";
    statusNode.style.color = kind === "error" ? "#ffb3bd" : kind === "ok" ? "#b7ffd9" : "#e9ecff";

    if (persistMs > 0) {
      clearTimeout(showStatus._t);
      showStatus._t = setTimeout(() => {
        statusNode.style.display = "none";
      }, persistMs);
    }
  }

  // ---------- Theme ----------
  const THEME_KEY = "kodislovo_teacher_theme"; // separate from student if needed
  function getTheme() {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "dark" || t === "light") return t;
    // If HTML already set a theme, respect it
    const cur = document.documentElement.getAttribute("data-theme");
    if (cur === "dark" || cur === "light") return cur;
    // default
    return "dark";
  }
  function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);

    // Optional: reflect on toggle button label/icon if it exists
    const btn = findThemeToggleBtn();
    if (btn) {
      btn.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
      // If button has a label span, update it softly
      const label = btn.querySelector("[data-role='theme-label']") || btn.querySelector(".label");
      if (label) label.textContent = t === "dark" ? "Тёмная" : "Светлая";
      btn.title = t === "dark" ? "Переключить на светлую" : "Переключить на тёмную";
    }
  }
  function toggleTheme() {
    const cur = getTheme();
    applyTheme(cur === "dark" ? "light" : "dark");
  }
  function findThemeToggleBtn() {
    return pickEl([
      "#themeToggle",
      "#themeBtn",
      "#btnTheme",
      "[data-action='toggle-theme']",
      "[data-action='theme']",
      "[data-role='theme-toggle']",
      "button.theme",
    ]);
  }

  // ---------- State / config ----------
  const state = {
    subject: null,
    manifestUrl: null,
    manifest: null,

    teacherBaseUrl: null,
    teacherToken: null,

    items: [],
    filtered: [],
    selected: null,
    keyMap: null, // optional answer key
  };

  function readParam(name) {
    const u = new URL(location.href);
    const v = u.searchParams.get(name);
    return v === null ? "" : v;
  }

  function repoPrefixGuess() {
    // GitHub Pages: https://user.github.io/<repo>/...
    // Custom domain: /...
    const parts = location.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    // If first segment looks like a repo name with dots (your repo is "app.kodislovo.ru")
    // we treat it as prefix
    if (parts[0].includes(".")) return "/" + parts[0];
    return "";
  }

  async function fetchJson(url, opts = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
    try {
      const r = await fetch(url, { ...opts, signal: controller.signal });
      const text = await r.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // not JSON
      }
      if (!r.ok) {
        const msg = (data && (data.error || data.message)) || text || `${r.status} ${r.statusText}`;
        const err = new Error(msg);
        err.status = r.status;
        err.body = data || text;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  function inferSubject() {
    // Priority:
    // 1) ?subject=
    // 2) subject select in HTML
    // 3) default russian
    const qp = readParam("subject");
    if (qp) return qp;

    const sel = pickEl([
      "#subject",
      "#subjectSelect",
      "select[name='subject']",
      "[data-role='subject']",
    ]);
    if (sel && sel.value) return sel.value;

    return "russian";
  }

  function manifestUrlFor(subject) {
    const prefix = repoPrefixGuess();
    const noPrefix = `/controls/${subject}/variants/manifest.json`;
    const withPrefix = `${prefix}/controls/${subject}/variants/manifest.json`;
    // Prefer withPrefix if we detected it; but also try fallback
    return { withPrefix, noPrefix };
  }

  function bindSubjectSelector() {
    const sel = pickEl([
      "#subject",
      "#subjectSelect",
      "select[name='subject']",
      "[data-role='subject']",
    ]);
    if (!sel) return;

    sel.value = state.subject || sel.value;
    sel.addEventListener("change", async () => {
      state.subject = sel.value || "russian";
      await boot(); // reload everything
    });
  }

  function bindThemeToggle() {
    const btn = findThemeToggleBtn();
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleTheme();
    });
  }

  // ---------- API client ----------
  function readTeacherBaseUrlFromUI() {
    const el = pickEl([
      "#teacherBaseUrl",
      "#apiBaseUrl",
      "#baseUrl",
      "input[name='teacherBaseUrl']",
      "input[name='apiBaseUrl']",
      "[data-role='teacher-base-url']",
    ]);
    return el?.value?.trim() || "";
  }

  function readTeacherTokenFromUI() {
    const el = pickEl([
      "#teacherToken",
      "#token",
      "#apiToken",
      "input[name='teacherToken']",
      "input[name='token']",
      "[data-role='teacher-token']",
    ]);
    return el?.value?.trim() || "";
  }

  function writeTeacherBaseUrlToUI(v) {
    const el = pickEl([
      "#teacherBaseUrl",
      "#apiBaseUrl",
      "#baseUrl",
      "input[name='teacherBaseUrl']",
      "input[name='apiBaseUrl']",
      "[data-role='teacher-base-url']",
    ]);
    if (el && !el.value) el.value = v;
  }

  function writeTeacherTokenToUI(v) {
    const el = pickEl([
      "#teacherToken",
      "#token",
      "#apiToken",
      "input[name='teacherToken']",
      "input[name='token']",
      "[data-role='teacher-token']",
    ]);
    if (el && !el.value) el.value = v;
  }

  function getEffectiveBaseUrl() {
    return readTeacherBaseUrlFromUI() || state.teacherBaseUrl || "";
  }

  function getEffectiveToken() {
    return readTeacherTokenFromUI() || state.teacherToken || "";
  }

  async function apiCall(path, { method = "GET", params = null, body = null } = {}) {
    const base = getEffectiveBaseUrl();
    const token = getEffectiveToken();

    if (!base) throw new Error("Не задан teacher.base_url");
    if (!token) throw new Error("Не задан teacher token");

    const u = new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : base + "/");
    if (params && typeof params === "object") {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
      }
    }

    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("X-Teacher-Token", token);
    headers.set("Authorization", `Bearer ${token}`);
    if (body !== null && body !== undefined) headers.set("Content-Type", "application/json;charset=utf-8");

    const res = await fetch(u.toString(), {
      method,
      headers,
      body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || (typeof data === "string" ? data : "") || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  // ---------- UI: containers ----------
  function ensureResultsContainer() {
    const el = pickEl([
      "#results",
      "#resultsList",
      "#list",
      "#items",
      "#tableBody",
      "tbody#rows",
      "[data-role='results']",
      "[data-role='list']",
    ]);
    if (el) return el;

    const wrap = document.createElement("div");
    wrap.id = "results";
    wrap.style.padding = "12px";
    document.body.appendChild(wrap);
    return wrap;
  }

  function ensureSearchInput() {
    return pickEl([
      "#search",
      "#q",
      "#filter",
      "#filterText",
      "input[name='search']",
      "[data-role='search']",
    ]);
  }

  function ensureLoadingFlag() {
    const el = pickEl([
      "#loading",
      "[data-role='loading']",
      ".loading",
    ]);
    return el;
  }

  function setLoading(isLoading) {
    const el = ensureLoadingFlag();
    if (el) {
      el.style.display = isLoading ? "" : "none";
    }
    document.documentElement.classList.toggle("is-loading", !!isLoading);
  }

  // ---------- Render ----------
  function normalizeItem(x) {
    // Try to unify common fields without depending on backend exact schema
    const key =
      x?.key ||
      x?.id ||
      x?.resultKey ||
      x?.objectKey ||
      x?.storageKey ||
      x?.name ||
      "";

    const created =
      x?.createdAt ||
      x?.created_at ||
      x?.ts ||
      x?.timestamp ||
      x?.submittedAt ||
      x?.submitted_at ||
      x?.time ||
      "";

    const student =
      x?.student ||
      x?.studentName ||
      x?.name ||
      x?.fio ||
      x?.user ||
      x?.who ||
      "";

    const klass =
      x?.class ||
      x?.klass ||
      x?.grade ||
      x?.group ||
      "";

    const variant =
      x?.variant ||
      x?.variantId ||
      x?.variant_id ||
      x?.variantTitle ||
      x?.variant_title ||
      "";

    const voided = !!(x?.voided || x?.isVoided || x?.deleted || x?.archived);

    return {
      ...x,
      __key: key,
      __created: created,
      __student: student,
      __class: klass,
      __variant: variant,
      __voided: voided,
    };
  }

  function applyFilter() {
    const q = (ensureSearchInput()?.value || "").trim().toLowerCase();
    const items = state.items || [];
    if (!q) {
      state.filtered = items.slice();
      return;
    }
    state.filtered = items.filter((it) => {
      const hay = [
        it.__key,
        it.__student,
        it.__class,
        it.__variant,
        it.__created,
        it.subject,
      ]
        .map((v) => safeText(v).toLowerCase())
        .join(" | ");
      return hay.includes(q);
    });
  }

  function renderList() {
    const root = ensureResultsContainer();
    applyFilter();

    // If root is a <tbody>, render rows. Otherwise render cards.
    const isTbody = root.tagName === "TBODY";

    const items = state.filtered || [];
    if (!items.length) {
      if (isTbody) {
        root.innerHTML = `<tr><td colspan="8" style="padding:12px;opacity:.8">Нет результатов</td></tr>`;
      } else {
        root.innerHTML = `<div style="padding:12px;opacity:.8">Нет результатов</div>`;
      }
      return;
    }

    if (isTbody) {
      root.innerHTML = "";
      for (const it of items) {
        const tr = document.createElement("tr");
        tr.dataset.key = it.__key || "";
        tr.innerHTML = `
          <td>${escapeHtml(it.__key)}</td>
          <td>${escapeHtml(it.__student)}</td>
          <td>${escapeHtml(it.__class)}</td>
          <td>${escapeHtml(it.__variant)}</td>
          <td>${escapeHtml(isoToLocal(it.__created))}</td>
          <td>${it.__voided ? "void" : ""}</td>
          <td style="white-space:nowrap">
            <button class="btn" data-action="download-json">JSON</button>
            <button class="btn" data-action="print">PDF</button>
            <button class="btn" data-action="void">${it.__voided ? "Unvoid?" : "Void"}</button>
          </td>
        `;
        tr.addEventListener("click", (e) => {
          const btn = e.target?.closest?.("button[data-action]");
          if (btn) return; // handled by delegation
          state.selected = it;
        });
        root.appendChild(tr);
      }
    } else {
      root.innerHTML = "";
      for (const it of items) {
        const card = document.createElement("div");
        card.className = "card";
        card.dataset.key = it.__key || "";
        card.style.padding = "12px";
        card.style.marginBottom = "10px";
        card.style.border = "1px solid rgba(255,255,255,.12)";
        card.style.borderRadius = "14px";
        card.style.background = "rgba(255,255,255,.04)";

        const title = `${it.__student || "Без имени"} ${it.__class ? "• " + it.__class : ""}`;
        const meta = [
          it.__variant ? `Вариант: ${it.__variant}` : "",
          it.__created ? `Сдано: ${isoToLocal(it.__created)}` : "",
          it.__key ? `Key: ${it.__key}` : "",
          it.__voided ? `Статус: void` : "",
        ].filter(Boolean).join(" • ");

        card.innerHTML = `
          <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
            <div style="min-width:240px;flex:1">
              <div style="font-weight:700;font-size:16px;margin-bottom:4px">${escapeHtml(title)}</div>
              <div style="opacity:.85;font-size:13px;line-height:1.35">${escapeHtml(meta)}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <button class="btn" data-action="download-json">Скачать JSON</button>
              <button class="btn" data-action="print">PDF (печать)</button>
              <button class="btn" data-action="void">Удалить / void</button>
            </div>
          </div>
          <details style="margin-top:10px">
            <summary style="cursor:pointer;opacity:.9">Детали</summary>
            <pre style="white-space:pre-wrap;word-break:break-word;opacity:.9;margin:10px 0 0">${escapeHtml(JSON.stringify(it, null, 2))}</pre>
          </details>
        `;

        root.appendChild(card);
      }
    }

    // Delegated actions
    root.onclick = async (e) => {
      const btn = e.target?.closest?.("button[data-action]");
      if (!btn) return;

      const host = e.target?.closest?.("[data-key]");
      const key = host?.dataset?.key || "";
      const it = (state.filtered || []).find((x) => x.__key === key) || (state.items || []).find((x) => x.__key === key);
      if (!it) return;

      const action = btn.dataset.action;
      if (action === "download-json") {
        await actionDownloadJson(it);
      } else if (action === "print") {
        await actionPrint(it);
      } else if (action === "void") {
        await actionVoid(it);
      }
    };
  }

  function escapeHtml(s) {
    return safeText(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ---------- Actions ----------
  async function loadList() {
    setLoading(true);
    try {
      // Many backends accept subject filter; harmless if ignored
      const data = await apiCall("/teacher/list", { params: { subject: state.subject } });

      // allow formats:
      // 1) {items:[...]}
      // 2) [...]
      // 3) {results:[...]}
      const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.results) ? data.results : [];
      state.items = arr.map(normalizeItem);

      // sort newest first if possible
      state.items.sort((a, b) => {
        const ta = new Date(a.__created || 0).getTime();
        const tb = new Date(b.__created || 0).getTime();
        return (tb || 0) - (ta || 0);
      });

      renderList();
      showStatus(`Загружено: ${state.items.length}`, "ok", 2200);
    } catch (e) {
      console.error(e);
      showStatus(`Ошибка списка: ${e.message}`, "error", 6000);
      // keep previous list if any
      renderList();
    } finally {
      setLoading(false);
    }
  }

  async function getResultJson(it) {
    // Try multiple patterns to match your function without breaking it
    const key = it.__key;
    if (!key) throw new Error("Не найден ключ результата");

    const trySeq = [
      () => apiCall("/teacher/get", { params: { key } }),
      () => apiCall("/teacher/get", { params: { id: key } }),
      () => apiCall(`/teacher/get/${encodeURIComponent(key)}`),
    ];

    let lastErr = null;
    for (const fn of trySeq) {
      try {
        const data = await fn();
        return data;
      } catch (e) {
        lastErr = e;
        // only continue on 400/404-ish; otherwise stop
        if (e.status && ![400, 404].includes(e.status)) break;
      }
    }
    throw lastErr || new Error("Не удалось получить результат");
  }

  async function actionDownloadJson(it) {
    try {
      showStatus("Получаю JSON…", "info", 0);
      const data = await getResultJson(it);
      const fname = `result_${state.subject}_${(it.__student || "student").replace(/\s+/g, "_")}_${(it.__variant || "variant").replace(/\s+/g, "_")}_${(it.__key || "key").slice(0, 16)}.json`;
      downloadJson(data, fname);
      showStatus("Скачано ✅", "ok", 1800);
    } catch (e) {
      console.error(e);
      showStatus(`Ошибка JSON: ${e.message}`, "error", 6000);
    }
  }

  async function actionVoid(it) {
    const key = it.__key;
    if (!key) return;

    try {
      showStatus("Удаляю (void)…", "info", 0);

      // If you later add hard delete, we can call it here.
      // For now: try /teacher/void in different shapes.
      const trySeq = [
        () => apiCall("/teacher/void", { method: "POST", body: { key, subject: state.subject } }),
        () => apiCall("/teacher/void", { method: "POST", body: { id: key, subject: state.subject } }),
        () => apiCall("/teacher/void", { params: { key } }),
      ];

      let ok = false;
      let lastErr = null;
      for (const fn of trySeq) {
        try {
          await fn();
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
          if (e.status && ![400, 404].includes(e.status)) break;
        }
      }
      if (!ok) throw lastErr || new Error("Void не выполнен");

      showStatus("Готово ✅", "ok", 2000);
      // refresh list
      await loadList();
    } catch (e) {
      console.error(e);
      showStatus(`Ошибка void: ${e.message}`, "error", 6000);
    }
  }

  async function actionPrint(it) {
    try {
      showStatus("Готовлю печать…", "info", 0);
      const result = await getResultJson(it);

      // Try to also load variant JSON if it has a reference
      let variant = null;
      const variantId =
        result?.variantId ||
        result?.variant_id ||
        result?.variant ||
        it.__variant ||
        "";

      if (variantId && state.manifest?.variants?.length) {
        const found = state.manifest.variants.find((v) => v.id === variantId || v.title === variantId);
        const file = found?.file;
        if (file) {
          const base = state.manifestUrl.replace(/manifest\.json$/i, "");
          const url = base + file;
          try {
            variant = await fetchJson(url);
          } catch {
            // ignore
          }
        }
      }

      openPrintWindow({ result, variant, it });
      showStatus("Открыто окно печати ✅", "ok", 1800);
    } catch (e) {
      console.error(e);
      showStatus(`Ошибка печати: ${e.message}`, "error", 6000);
    }
  }

  function openPrintWindow({ result, variant, it }) {
    const w = window.open("", "_blank");
    if (!w) {
      showStatus("Браузер заблокировал popup. Разрешите всплывающие окна.", "error", 7000);
      return;
    }

    const title = `Кодислово — ${it.__student || "ученик"} — ${it.__variant || ""}`.trim();

    const cssLink = (() => {
      // keep using shared control styles
      const prefix = repoPrefixGuess();
      const href1 = `${prefix}/assets/css/control-ui.css`;
      const href2 = `/assets/css/control-ui.css`;
      // we will include both; whichever works will load
      return `
        <link rel="stylesheet" href="${href1}">
        <link rel="stylesheet" href="${href2}">
      `;
    })();

    const htmlTheme = document.documentElement.getAttribute("data-theme") || "dark";

    const variantBlock = variant
      ? `<h2>Вариант</h2><pre>${escapeHtml(JSON.stringify(variant, null, 2))}</pre>`
      : `<h2>Вариант</h2><p style="opacity:.8">Вариант не подгрузился (это нормально, печать всё равно доступна).</p>`;

    const resultBlock = `<h2>Ответы ученика</h2><pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;

    w.document.open();
    w.document.write(`
      <!doctype html>
      <html lang="ru" data-theme="${escapeHtml(htmlTheme)}">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        ${cssLink}
        <style>
          body{padding:16px}
          h1{margin:0 0 12px}
          h2{margin:18px 0 8px}
          pre{white-space:pre-wrap;word-break:break-word;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
          .meta{opacity:.85;margin:0 0 10px}
          .toolbar{position:sticky;top:0;background:rgba(0,0,0,.25);backdrop-filter:blur(8px);padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:14px;margin-bottom:12px}
          .btn{padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
          @media print {.toolbar{display:none} body{padding:0}}
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button class="btn" onclick="window.print()">Печать / Сохранить в PDF</button>
        </div>
        <h1>${escapeHtml(title)}</h1>
        <p class="meta">${escapeHtml([
          it.__class ? `Класс: ${it.__class}` : "",
          it.__created ? `Сдано: ${isoToLocal(it.__created)}` : "",
          it.__key ? `Key: ${it.__key}` : "",
        ].filter(Boolean).join(" • "))}</p>
        ${variantBlock}
        ${resultBlock}
      </body>
      </html>
    `);
    w.document.close();
  }

  // ---------- CSV export ----------
  function bindCsvButton() {
    const btn = pickEl([
      "#btnCsv",
      "#csvBtn",
      "[data-action='export-csv']",
      "[data-role='export-csv']",
    ]);
    if (!btn) return;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        applyFilter();
        const rows = (state.filtered || []).map((it) => {
          // flatten with safe subset
          return {
            key: it.__key,
            student: it.__student,
            class: it.__class,
            variant: it.__variant,
            submittedAt: it.__created,
            voided: it.__voided ? 1 : 0,
            subject: state.subject,
          };
        });
        const csv = toCsv(rows);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, `results_${state.subject}_${new Date().toISOString().slice(0, 10)}.csv`);
        showStatus("CSV скачан ✅", "ok", 2000);
      } catch (err) {
        console.error(err);
        showStatus(`CSV ошибка: ${err.message}`, "error", 6000);
      }
    });
  }

  // ---------- Key file (autocheck scaffold) ----------
  function bindKeyFileInput() {
    const inp = pickEl([
      "#keyFile",
      "input[type='file'][name='key']",
      "[data-role='key-file']",
    ]);
    if (!inp) return;

    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const txt = await file.text();
        const json = JSON.parse(txt);
        state.keyMap = json;
        showStatus("Ключ загружен ✅ (автопроверка — можно подключать дальше)", "ok", 3500);
      } catch (e) {
        showStatus("Не удалось прочитать ключ (ожидается JSON).", "error", 6000);
      }
    });
  }

  // ---------- Refresh/search bindings ----------
  function bindRefreshButton() {
    const btn = pickEl([
      "#btnRefresh",
      "#refreshBtn",
      "#reloadBtn",
      "[data-action='refresh']",
      "[data-role='refresh']",
    ]);
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await loadList();
    });
  }

  function bindSearchInput() {
    const inp = ensureSearchInput();
    if (!inp) return;
    inp.addEventListener("input", () => renderList());
  }

  // ---------- Boot sequence ----------
  async function loadManifest() {
    const subj = state.subject;
    const { withPrefix, noPrefix } = manifestUrlFor(subj);

    // Try withPrefix first, then fallback
    const attempts = [withPrefix, noPrefix].filter(Boolean);

    let lastErr = null;
    for (const url of attempts) {
      try {
        const m = await fetchJson(url);
        state.manifest = m;
        state.manifestUrl = url;
        return m;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Не удалось загрузить manifest.json");
  }

  async function boot() {
    state.subject = inferSubject();
    bindSubjectSelector();

    // Theme
    applyTheme(getTheme());
    bindThemeToggle();

    setLoading(true);
    try {
      showStatus("Загружаю manifest…", "info", 0);
      const manifest = await loadManifest();

      // Fill defaults from manifest
      const baseUrl = manifest?.teacher?.base_url || manifest?.teacher?.baseUrl || "";
      const token = manifest?.teacher?.token || "";

      state.teacherBaseUrl = baseUrl;
      state.teacherToken = token;

      // If UI inputs exist, seed them (do not overwrite user typed values)
      if (baseUrl) writeTeacherBaseUrlToUI(baseUrl);
      if (token) writeTeacherTokenToUI(token);

      showStatus("Manifest загружен ✅", "ok", 1600);

      // Bind buttons/inputs
      bindRefreshButton();
      bindSearchInput();
      bindCsvButton();
      bindKeyFileInput();

      // Initial list load
      await loadList();
    } catch (e) {
      console.error(e);
      showStatus(`Ошибка запуска: ${e.message}`, "error", 7000);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Global data-action (optional) ----------
  // If your HTML uses data-action on top-level controls, we support them too.
  function bindGlobalActions() {
    document.addEventListener("click", (e) => {
      const el = e.target?.closest?.("[data-action]");
      if (!el) return;

      const act = el.dataset.action;
      if (act === "toggle-theme" || act === "theme") {
        e.preventDefault();
        toggleTheme();
      }
      if (act === "refresh") {
        e.preventDefault();
        loadList();
      }
      if (act === "export-csv") {
        // handled by bindCsvButton if button exists; otherwise do it here
        // (no-op if already bound)
      }
    });
  }

  // ---------- Init ----------
  bindGlobalActions();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
