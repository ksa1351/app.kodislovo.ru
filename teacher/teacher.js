"use strict";

/* ========= CONFIG ========= */
const API_BASE = "https://d5d17sjh01l20fnemocv.3zvepvee.apigw.yandexcloud.net";
const TEACHER_TOKEN = "42095b52-9d18-423d-a8c2-bfa56e5cd03b1b9d15ca-bbba-49f9-a545-f545b3e16c1f"; // ← ВСТАВЬ ТОКЕН

/* ========= DOM HELPERS ========= */
const $ = (id) => document.getElementById(id);
const status = (msg) => { const el = $("statusLine"); if (el) el.textContent = msg; };

function repoPrefixGuess() {
  // GitHub Pages: https://user.github.io/<repo>/...
  const parts = location.pathname.split("/").filter(Boolean);
  if (!parts.length) return "";
  if (parts[0].includes(".")) return "/" + parts[0];
  return "";
}

/* ========= API ========= */
async function api(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Teacher-Token": TEACHER_TOKEN
    },
    body: JSON.stringify(body || {})
  });

  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }

  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

/* ========= THEME ========= */
const themeToggle = $("themeToggle");
const themeLabel = $("themeLabel");

function applyTheme(t) {
  const theme = (t === "light") ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  if (themeToggle) themeToggle.checked = (theme === "light");
  if (themeLabel) themeLabel.textContent = (theme === "light") ? "Светлая" : "Тёмная";
  localStorage.setItem("kd-theme", theme);
}

applyTheme(localStorage.getItem("kd-theme") || "dark");

themeToggle?.addEventListener("change", () => {
  applyTheme(themeToggle.checked ? "light" : "dark");
});

/* ========= MANIFEST / VARIANTS ========= */
let manifestCache = null;

async function loadManifest(subject) {
  if (manifestCache && manifestCache.subject === subject) return manifestCache.manifest;

  const prefix = repoPrefixGuess();
  const url1 = `${prefix}/controls/${subject}/variants/manifest.json`;
  const url2 = `/controls/${subject}/variants/manifest.json`;

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    return r.json();
  }

  try {
    const m = await fetchJson(url1);
    manifestCache = { subject, manifest: m, baseUrl: url1.replace(/manifest\.json$/i, "") };
    return m;
  } catch {
    const m = await fetchJson(url2);
    manifestCache = { subject, manifest: m, baseUrl: url2.replace(/manifest\.json$/i, "") };
    return m;
  }
}

function normalizeVariantName(v) {
  // accepts: "variant_01", "01", "1", "variant_1"
  const s = String(v || "").trim();
  if (!s) return "";
  const m = s.match(/(\d+)/);
  if (!m) return s;
  const n = m[1];
  return n.length === 1 ? `0${n}` : n;
}

async function loadVariantJson(subject, variantInput) {
  const vNorm = normalizeVariantName(variantInput);
  const m = await loadManifest(subject);
  const base = manifestCache?.baseUrl || "";

  // 1) try manifest mapping if exists
  if (m && Array.isArray(m.variants)) {
    const found = m.variants.find(x => {
      const id = normalizeVariantName(x.id || x.variant || x.name || "");
      const file = String(x.file || x.path || "");
      return id === vNorm || file.includes(vNorm);
    });
    if (found?.file) {
      const url = base + found.file;
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) return r.json();
    }
  }

  // 2) fallback: variant_XX.json рядом с manifest
  if (vNorm) {
    const guess = base + `variant_${vNorm}.json`;
    const r = await fetch(guess, { cache: "no-store" });
    if (r.ok) return r.json();
  }

  return null;
}

/* ========= LIST + FILTER ========= */
let lastList = [];     // raw from api
let visibleList = [];  // after filters

function applyClientFilters(items) {
  const fioQ = ($("fioSearch")?.value || "").trim().toLowerCase();
  if (!fioQ) return items.slice();

  return items.filter(it => {
    const hay = `${it.fio || ""} ${it.cls || ""} ${it.variant || ""} ${it.key || ""}`.toLowerCase();
    return hay.includes(fioQ);
  });
}

function makeBtn(label, attrs = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "kd-btn secondary";
  b.textContent = label;
  Object.entries(attrs).forEach(([k, v]) => b.setAttribute(k, v));
  return b;
}

function ensureExtraButtons() {
  const row = $("btnList")?.parentElement;
  if (!row) return;

  if (!$("btnCsv")) {
    const b = makeBtn("CSV", { id: "btnCsv", style: "height:42px;border-radius:14px;padding:0 14px" });
    row.insertBefore(b, $("btnVoidSelected"));
    b.onclick = exportCsv;
  }

  if (!$("btnPrintSelected")) {
    const b = makeBtn("Печать выбранного", { id: "btnPrintSelected", style: "height:42px;border-radius:14px;padding:0 14px" });
    row.appendChild(b);
    b.onclick = printSelected;
  }

  if (!$("btnKeyLoad")) {
    const leftPanel = $("btnResetMake")?.parentElement; // kd-actions
    if (leftPanel) {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.gap = "10px";
      wrap.style.alignItems = "center";
      wrap.style.marginTop = "10px";

      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json";
      inp.id = "keyFile";
      inp.style.maxWidth = "210px";

      const b = makeBtn("Загрузить ключ", { id: "btnKeyLoad" });

      wrap.appendChild(inp);
      wrap.appendChild(b);

      leftPanel.parentElement.appendChild(wrap);

      b.onclick = async () => {
        const f = inp.files?.[0];
        if (!f) { status("Выбери файл ключа (JSON)."); return; }
        try {
          const txt = await f.text();
          keyStore = JSON.parse(txt);
          status("Ключ загружен ✅ (автопроверка доступна).");
        } catch (e) {
          status("Ошибка ключа: нужен валидный JSON.");
        }
      };
    }
  }
}

async function loadList() {
  status("Загрузка списка…");

  ensureExtraButtons();

  // server-side filters
  const variant = normalizeVariantName(($("variantFilter")?.value || "").replace(/^variant_/, ""));
  const cls = $("classFilter")?.value || "";

  const data = await api("/teacher/list", {
    variant,
    cls,
    limit: 200
  });

  lastList = Array.isArray(data.items) ? data.items : [];
  visibleList = applyClientFilters(lastList);

  renderTable(visibleList);
  status(`Загружено: ${visibleList.length}`);
}

function renderTable(items) {
  const tbody = $("resultsTbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const it of items) {
    const tr = document.createElement("tr");
    tr.style.borderTop = "1px solid var(--line)";

    const created = (it.createdAt || "").replace("T", " ").slice(0, 16);

    tr.innerHTML = `
      <td style="padding:10px">
        <input type="checkbox" data-key="${escapeHtml(it.key)}">
      </td>
      <td style="padding:10px">
        ${escapeHtml(it.fio || "")}<br>
        <span style="color:var(--muted)">${escapeHtml(it.cls || "")}</span>
      </td>
      <td style="padding:10px">${escapeHtml(it.variant || "")}</td>
      <td style="padding:10px">${escapeHtml(created)}</td>
      <td style="padding:10px;font-size:12px;opacity:.9">${escapeHtml(it.key || "")}</td>
      <td style="padding:10px;white-space:nowrap">
        <button class="kd-btn secondary" data-get="${escapeHtml(it.key)}">JSON</button>
        <button class="kd-btn secondary" data-dl="${escapeHtml(it.key)}">Скачать</button>
        <button class="kd-btn secondary" data-print="${escapeHtml(it.key)}">Печать</button>
        <button class="kd-btn secondary" data-check="${escapeHtml(it.key)}">Проверить</button>
      </td>
    `;

    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

$("btnList")?.addEventListener("click", () => loadList());
$("fioSearch")?.addEventListener("input", () => {
  visibleList = applyClientFilters(lastList);
  renderTable(visibleList);
  status(`Фильтр: ${visibleList.length}`);
});

/* ========= GET / DOWNLOAD ========= */
async function getResultByKey(key) {
  return api("/teacher/get", { key });
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "result.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ========= CSV EXPORT ========= */
function toCsv(rows) {
  const cols = Array.from(rows.reduce((s, r) => {
    Object.keys(r || {}).forEach(k => s.add(k));
    return s;
  }, new Set()));

  const esc = (val) => {
    const s = String(val ?? "");
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = cols.map(esc).join(";");
  const lines = rows.map(r => cols.map(c => esc(r?.[c])).join(";"));
  return [header, ...lines].join("\r\n");
}

function exportCsv() {
  try {
    const rows = (visibleList || []).map(it => ({
      fio: it.fio || "",
      cls: it.cls || "",
      variant: it.variant || "",
      createdAt: it.createdAt || "",
      percent: it.percent ?? "",
      mark: it.mark ?? "",
      voided: it.voided ? 1 : 0,
      key: it.key || ""
    }));
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kodislovo_results_${$("subjectSelect")?.value || "subject"}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status("CSV скачан ✅");
  } catch (e) {
    status("CSV ошибка: " + e.message);
  }
}

/* ========= VOID SELECTED ========= */
$("btnVoidSelected")?.addEventListener("click", async () => {
  try {
    const keys = Array.from($("resultsTbody").querySelectorAll("input[type='checkbox'][data-key]:checked"))
      .map(x => x.getAttribute("data-key"))
      .filter(Boolean);

    if (!keys.length) { status("Ничего не выбрано."); return; }

    status("Аннулирование…");
    await api("/teacher/void", { keys });
    status("Аннулировано ✅");
    await loadList();
  } catch (e) {
    status("Void ошибка: " + e.message);
  }
});

/* ========= RESET ========= */
$("btnResetMake")?.addEventListener("click", async () => {
  try {
    status("Создание reset-кода…");

    const subject = $("subjectSelect").value;
    const variant = normalizeVariantName(($("resetVariant").value || "").replace(/^variant_/, ""));
    const cls = ($("resetClass").value || "").trim();
    const fio = ($("resetFio").value || "").trim();

    const r = await api("/teacher/reset", { subject, variant, cls, fio });

    try { await navigator.clipboard.writeText(r.code); } catch {}
    status(`Reset-код: ${r.code} (скопирован)`);
  } catch (e) {
    status("Reset ошибка: " + e.message);
  }
});

/* ========= TIMER ========= */
$("btnTimerLoad")?.addEventListener("click", async () => {
  try {
    status("Загрузка таймера…");
    const r = await api("/teacher/config/get", { subject: $("subjectSelect").value });
    $("timerMinutes").value = r.time_limit_minutes || 0;
    status("Таймер загружен ✅");
  } catch (e) {
    status("Таймер load ошибка: " + e.message);
  }
});

$("btnTimerSave")?.addEventListener("click", async () => {
  try {
    status("Сохранение таймера…");
    await api("/teacher/config/set", {
      subject: $("subjectSelect").value,
      time_limit_minutes: Number($("timerMinutes").value || 0),
    });
    status("Таймер сохранён ✅");
  } catch (e) {
    status("Таймер save ошибка: " + e.message);
  }
});

/* ========= AUTOCHECK ========= */
let keyStore = null;

// Heuristics: try to extract answers map from result json
function extractStudentAnswers(result) {
  // 1) direct maps
  if (result && typeof result.answers === "object" && !Array.isArray(result.answers)) return result.answers;
  if (result && typeof result.userAnswers === "object" && !Array.isArray(result.userAnswers)) return result.userAnswers;
  if (result && typeof result.responses === "object" && !Array.isArray(result.responses)) return result.responses;

  // 2) array items
  const arr = result?.items || result?.tasks || result?.responses || null;
  if (Array.isArray(arr)) {
    const map = {};
    for (const x of arr) {
      const id = x?.id ?? x?.qid ?? x?.key ?? x?.taskId;
      const val = x?.answer ?? x?.value ?? x?.response ?? x?.selected ?? x?.choice;
      if (id != null) map[String(id)] = val;
    }
    if (Object.keys(map).length) return map;
  }
  return {};
}

// Heuristics: extract key (correct answers) from variant json OR uploaded key json
function extractKeyAnswers(variantJson, loadedKey) {
  // A) loadedKey is direct map {id:answer}
  if (loadedKey && typeof loadedKey === "object" && !Array.isArray(loadedKey)) {
    // if has nested "answers"
    if (loadedKey.answers && typeof loadedKey.answers === "object") return loadedKey.answers;
    // if has "key"
    if (loadedKey.key && typeof loadedKey.key === "object") return loadedKey.key;
    // else assume itself is the map
    const keys = Object.keys(loadedKey);
    if (keys.length && keys.every(k => typeof loadedKey[k] !== "object")) return loadedKey;
  }

  // B) variantJson has tasks with answer/correct
  const tasks = variantJson?.tasks || variantJson?.items || variantJson?.questions;
  if (Array.isArray(tasks)) {
    const map = {};
    for (const t of tasks) {
      const id = t?.id ?? t?.qid ?? t?.key ?? t?.taskId;
      const ans = t?.answer ?? t?.correct ?? t?.right ?? t?.solution;
      if (id != null && ans != null) map[String(id)] = ans;
    }
    if (Object.keys(map).length) return map;
  }

  // C) variantJson.answers map
  if (variantJson && typeof variantJson.answers === "object" && !Array.isArray(variantJson.answers)) return variantJson.answers;

  return {};
}

function normalizeAnswer(a) {
  if (a === null || a === undefined) return "";
  if (typeof a === "string") return a.trim().toLowerCase();
  if (typeof a === "number" || typeof a === "boolean") return String(a);
  // arrays -> join
  if (Array.isArray(a)) return a.map(x => normalizeAnswer(x)).join("|");
  // objects -> JSON
  return JSON.stringify(a);
}

function gradeAnswers(studentMap, keyMap) {
  const ids = Object.keys(keyMap || {});
  let total = 0, ok = 0;
  const details = [];

  for (const id of ids) {
    total++;
    const correct = keyMap[id];
    const given = studentMap[id];

    const good = normalizeAnswer(given) === normalizeAnswer(correct);
    if (good) ok++;

    details.push({
      id,
      given,
      correct,
      ok: good
    });
  }

  const percent = total ? Math.round((ok / total) * 100) : 0;
  return { total, ok, percent, details };
}

async function autocheckOne(subject, listItem, resultJson) {
  const variantId = listItem.variant || normalizeVariantName(($("variantFilter")?.value || "").replace(/^variant_/, "")) || normalizeVariantName(($("resetVariant")?.value || "").replace(/^variant_/, ""));
  const variantJson = await loadVariantJson(subject, variantId);

  const studentMap = extractStudentAnswers(resultJson);
  const keyMap = extractKeyAnswers(variantJson, keyStore);

  if (!Object.keys(keyMap).length) {
    throw new Error("Не найден ключ. Загрузите ключ JSON или добавьте ответы в variant JSON (tasks[].answer/answers).");
  }

  const g = gradeAnswers(studentMap, keyMap);
  return { variantId, keyFound: Object.keys(keyMap).length, ...g };
}

/* ========= PRINT ========= */
function openPrintWindow({ title, subject, variantJson, resultJson, grade }) {
  const w = window.open("", "_blank");
  if (!w) { status("Popup заблокирован. Разреши всплывающие окна."); return; }

  const theme = document.documentElement.dataset.theme || "dark";
  const prefix = repoPrefixGuess();
  const css1 = `${prefix}/assets/css/control-ui.css`;
  const css2 = `/assets/css/control-ui.css`;

  const gradeLine = grade
    ? `Автопроверка: ${grade.ok}/${grade.total} (${grade.percent}%)`
    : "";

  w.document.open();
  w.document.write(`<!doctype html>
<html lang="ru" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${css1}">
<link rel="stylesheet" href="${css2}">
<style>
  body{padding:16px}
  .bar{position:sticky;top:0;background:rgba(0,0,0,.25);backdrop-filter:blur(8px);
       border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:10px;margin-bottom:14px}
  .btn{padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
  pre{white-space:pre-wrap;word-break:break-word;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px;background:rgba(255,255,255,.04)}
  h1{margin:0 0 6px}
  h2{margin:18px 0 10px}
  .muted{opacity:.85}
  table{width:100%;border-collapse:collapse}
  td,th{border-top:1px solid rgba(255,255,255,.12);padding:8px;text-align:left;vertical-align:top}
  @media print {.bar{display:none} body{padding:0}}
</style>
</head>
<body>
  <div class="bar">
    <button class="btn" onclick="window.print()">Печать / Сохранить в PDF</button>
  </div>

  <h1>${escapeHtml(title)}</h1>
  <div class="muted">Предмет: ${escapeHtml(subject)} ${gradeLine ? " • " + escapeHtml(gradeLine) : ""}</div>

  <h2>Вариант</h2>
  ${variantJson ? `<pre>${escapeHtml(JSON.stringify(variantJson, null, 2))}</pre>` : `<div class="muted">Не удалось подгрузить variant JSON (печать ответов всё равно доступна).</div>`}

  <h2>Ответы ученика</h2>
  <pre>${escapeHtml(JSON.stringify(resultJson, null, 2))}</pre>

  ${grade && grade.details ? `
  <h2>Автопроверка (по ключу)</h2>
  <table>
    <thead><tr><th>ID</th><th>Ответ ученика</th><th>Правильно</th><th>OK</th></tr></thead>
    <tbody>
      ${grade.details.map(d => `
        <tr>
          <td>${escapeHtml(d.id)}</td>
          <td>${escapeHtml(typeof d.given === "string" ? d.given : JSON.stringify(d.given))}</td>
          <td>${escapeHtml(typeof d.correct === "string" ? d.correct : JSON.stringify(d.correct))}</td>
          <td>${d.ok ? "✅" : "❌"}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  ` : ""}

</body>
</html>`);
  w.document.close();
}

/* ========= TABLE ACTIONS ========= */
$("resultsTbody")?.addEventListener("click", async (e) => {
  const btnGet = e.target.closest("button[data-get]");
  const btnDl = e.target.closest("button[data-dl]");
  const btnPrint = e.target.closest("button[data-print]");
  const btnCheck = e.target.closest("button[data-check]");

  if (!(btnGet || btnDl || btnPrint || btnCheck)) return;

  const key =
    (btnGet?.dataset.get) ||
    (
