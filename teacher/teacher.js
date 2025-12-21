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
