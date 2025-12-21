"use strict";

/* ========= DOM ========= */
const $ = (id) => document.getElementById(id);
const status = (msg) => { const el = $("statusLine"); if (el) el.textContent = msg; };

/* ========= Repo prefix for GitHub Pages (/app.kodislovo.ru) ========= */
function repoPrefixGuess() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (!parts.length) return "";
  if (parts[0].includes(".")) return "/" + parts[0];
  return "";
}

/* ========= Manifest load ========= */
let manifestCache = { subject: null, manifest: null, baseUrl: null };

async function loadManifest(subject) {
  if (manifestCache.manifest && manifestCache.subject === subject) return manifestCache.manifest;

  const prefix = repoPrefixGuess();
  const url1 = `${prefix}/controls/${subject}/variants/manifest.json`;
  const url2 = `/controls/${subject}/variants/manifest.json`;

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`manifest.json ${r.status}`);
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

function getApiFromManifest(m) {
  const base = String(m?.teacher?.base_url || "").replace(/\/+$/, "");
  const token = String(m?.teacher?.token || "");
  return { base, token };
}

/* ========= API (POST only, X-Teacher-Token only) ========= */
async function apiCall(path, body) {
  const subject = $("subjectSelect")?.value || "russian";
  const m = await loadManifest(subject);
  const { base, token } = getApiFromManifest(m);

  if (!base || !token) {
    throw new Error("В manifest.json нет teacher.base_url или teacher.token");
  }

  const url = base + path;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Teacher-Token": token
    },
    body: JSON.stringify(body || {})
  });

  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

/* ========= Theme ========= */
function applyTheme(t) {
  const theme = (t === "light") ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  const toggle = $("themeToggle");
  const label = $("themeLabel");
  if (toggle) toggle.checked = (theme === "light");
  if (label) label.textContent = (theme === "light") ? "Светлая" : "Тёмная";
  localStorage.setItem("kd-theme", theme);
}
applyTheme(localStorage.getItem("kd-theme") || "dark");
$("themeToggle")?.addEventListener("change", (e) => {
  applyTheme(e.target.checked ? "light" : "dark");
});

/* ========= Utilities ========= */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeVariantName(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const m = s.match(/(\d+)/);
  if (!m) return s;
  const n = m[1];
  return n.length === 1 ? `0${n}` : n;
}

/* ========= Variant JSON load for print/autocheck ========= */
async function loadVariantJson(subject, variantInput) {
  const m = await loadManifest(subject);
  const base = manifestCache.baseUrl || "";
  const vNorm = normalizeVariantName(variantInput);

  // mapping via manifest
  if (Array.isArray(m?.variants)) {
    const found = m.variants.find(x => {
      const id = normalizeVariantName(x.id || x.variant || x.name || "");
      const file = String(x.file || x.path || "");
      return id === vNorm || file.includes(vNorm);
    });
    if (found?.file) {
      const r = await fetch(base + found.file, { cache: "no-store" });
      if (r.ok) return r.json();
    }
  }

  // fallback: variant_XX.json
  if (vNorm) {
    const r = await fetch(base + `variant_${vNorm}.json`, { cache: "no-store" });
    if (r.ok) return r.json();
  }
  return null;
}

/* ========= State ========= */
let lastList = [];
let visibleList = [];
let keyStore = null;

/* ========= Inject extra buttons/controls ========= */
function ensureExtras() {
  // Buttons row on right
  const btnList = $("btnList");
  const btnVoidSelected = $("btnVoidSelected");
  const row = btnList?.parentElement;
  if (row) {
    if (!$("btnCsv")) {
      const b = document.createElement("button");
      b.id = "btnCsv";
      b.type = "button";
      b.className = "kd-btn secondary";
      b.textContent = "CSV";
      b.style.cssText = "height:42px;border-radius:14px;padding:0 14px";
      b.onclick = exportCsv;
      row.insertBefore(b, btnVoidSelected);
    }
    if (!$("btnPrintSelected")) {
      const b = document.createElement("button");
      b.id = "btnPrintSelected";
      b.type = "button";
      b.className = "kd-btn secondary";
      b.textContent = "Печать выбранного";
      b.style.cssText = "height:42px;border-radius:14px;padding:0 14px";
      b.onclick = printSelected;
      row.appendChild(b);
    }
  }

  // Key loader on left panel (after actions)
  if (!$("keyFile")) {
    const actions = $("btnResetMake")?.closest(".kd-actions");
    if (actions) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap";

      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json";
      inp.id = "keyFile";
      inp.style.maxWidth = "240px";

      const b = document.createElement("button");
      b.type = "button";
      b.className = "kd-btn secondary";
      b.textContent = "Загрузить ключ";
      b.onclick = async () => {
        const f = inp.files?.[0];
        if (!f) { status("Выбери файл ключа (JSON)."); return; }
        try {
          keyStore = JSON.parse(await f.text());
          status("Ключ загружен ✅");
        } catch {
          status("Ошибка: ключ должен быть JSON.");
        }
      };

      wrap.appendChild(inp);
      wrap.appendChild(b);
      actions.parentElement.appendChild(wrap);
    }
  }
}

/* ========= Filters ========= */
function applyClientFilters(items) {
  const q = ($("fioSearch")?.value || "").trim().toLowerCase();
  if (!q) return items.slice();
  return items.filter(it => (`${it.fio||""} ${it.cls||""} ${it.variant||""} ${it.key||""}`).toLowerCase().includes(q));
}

/* ========= Render ========= */
function renderTable(items) {
  const tbody = $("resultsTbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const it of items) {
    const tr = document.createElement("tr");
    tr.style.borderTop = "1px solid var(--line)";
    const created = (it.createdAt || "").replace("T", " ").slice(0, 16);

    tr.innerHTML = `
      <td style="padding:10px;width:44px"><input type="checkbox" data-key="${escapeHtml(it.key)}"></td>
      <td style="padding:10px">${escapeHtml(it.fio||"")}<br><span style="color:var(--muted)">${escapeHtml(it.cls||"")}</span></td>
      <td style="padding:10px">${escapeHtml(it.variant||"")}</td>
      <td style="padding:10px">${escapeHtml(created)}</td>
      <td style="padding:10px;font-size:12px;opacity:.9">${escapeHtml(it.key||"")}</td>
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

/* ========= List ========= */
async function loadList() {
  ensureExtras();
  status("Загрузка списка…");

  const variant = normalizeVariantName(($("variantFilter")?.value || "").replace(/^variant_/, ""));
  const cls = ($("classFilter")?.value || "").trim();

  const data = await apiCall("/teacher/list", { variant, cls, limit: 200 });
  lastList = Array.isArray(data.items) ? data.items : [];
  visibleList = applyClientFilters(lastList);
  renderTable(visibleList);
  status(`Загружено: ${visibleList.length}`);
}

/* ========= Get/Download ========= */
async function getResultByKey(key) {
  return apiCall("/teacher/get", { key });
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

/* ========= CSV ========= */
function toCsv(rows) {
  const cols = Array.from(rows.reduce((s, r) => (Object.keys(r||{}).forEach(k => s.add(k)), s), new Set()));
  const esc = (v) => {
    const s = String(v ?? "");
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  return [cols.join(";"), ...rows.map(r => cols.map(c => esc(r[c])).join(";"))].join("\r\n");
}
function exportCsv() {
  const rows = (visibleList||[]).map(it => ({
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
  a.download = `kodislovo_results_${$("subjectSelect")?.value||"subject"}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  status("CSV скачан ✅");
}

/* ========= Void selected ========= */
$("btnVoidSelected")?.addEventListener("click", async () => {
  try {
    const keys = Array.from($("resultsTbody").querySelectorAll("input[type='checkbox'][data-key]:checked"))
      .map(x => x.getAttribute("data-key")).filter(Boolean);
    if (!keys.length) { status("Ничего не выбрано."); return; }
    status("Аннулирование…");
    await apiCall("/teacher/void", { keys });
    status("Аннулировано ✅");
    await loadList();
  } catch (e) {
    status("Void ошибка: " + e.message);
  }
});

/* ========= Reset code create ========= */
$("btnResetMake")?.addEventListener("click", async () => {
  try {
    status("Создание reset-кода…");
    const subject = $("subjectSelect")?.value || "russian";
    const variant = ($("resetVariant")?.value || "").trim(); // ВАЖНО: без нормализации, чтобы совпало с учеником (variant_01)
    const cls = ($("resetClass")?.value || "").trim();
    const fio = ($("resetFio")?.value || "").trim();

    const r = await apiCall("/teacher/reset", { subject, variant, cls, fio });
    try { await navigator.clipboard.writeText(r.code); } catch {}
    status(`Reset-код: ${r.code} (скопирован)`);
  } catch (e) {
    status("Reset ошибка: " + e.message);
  }
});

/* ========= Timer ========= */
$("btnTimerLoad")?.addEventListener("click", async () => {
  try {
    status("Загрузка таймера…");
    const r = await apiCall("/teacher/config/get", { subject: $("subjectSelect")?.value || "russian" });
    $("timerMinutes").value = r.time_limit_minutes || 0;
    status("Таймер загружен ✅");
  } catch (e) {
    status("Timer load ошибка: " + e.message);
  }
});
$("btnTimerSave")?.addEventListener("click", async () => {
  try {
    status("Сохранение таймера…");
    await apiCall("/teacher/config/set", {
      subject: $("subjectSelect")?.value || "russian",
      time_limit_minutes: Number($("timerMinutes").value || 0)
    });
    status("Таймер сохранён ✅");
  } catch (e) {
    status("Timer save ошибка: " + e.message);
  }
});

/* ========= Autocheck ========= */
function extractStudentAnswers(result) {
  if (result && typeof result.answers === "object" && !Array.isArray(result.answers)) return result.answers;
  if (result && typeof result.userAnswers === "object" && !Array.isArray(result.userAnswers)) return result.userAnswers;

  const arr = result?.items || result?.tasks || result?.responses;
  if (Array.isArray(arr)) {
    const map = {};
    for (const x of arr) {
      const id = x?.id ?? x?.qid ?? x?.key ?? x?.taskId;
      const val = x?.answer ?? x?.value ?? x?.response ?? x?.selected;
      if (id != null) map[String(id)] = val;
    }
    return map;
  }
  return {};
}

function extractKeyAnswers(variantJson, loadedKey) {
  if (loadedKey && typeof loadedKey === "object") {
    if (loadedKey.answers && typeof loadedKey.answers === "object") return loadedKey.answers;
    if (loadedKey.key && typeof loadedKey.key === "object") return loadedKey.key;
    // assume direct map
    const ks = Object.keys(loadedKey);
    if (ks.length && ks.every(k => typeof loadedKey[k] !== "object")) return loadedKey;
  }

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

  if (variantJson && typeof variantJson.answers === "object" && !Array.isArray(variantJson.answers)) return variantJson.answers;
  return {};
}

function normAns(a) {
  if (a == null) return "";
  if (typeof a === "string") return a.trim().toLowerCase();
  if (typeof a === "number" || typeof a === "boolean") return String(a);
  if (Array.isArray(a)) return a.map(normAns).join("|");
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
    const good = normAns(given) === normAns(correct);
    if (good) ok++;
    details.push({ id, given, correct, ok: good });
  }
  return { total, ok, percent: total ? Math.round(ok / total * 100) : 0, details };
}

async function autocheck(subject, listItem, resultJson) {
  const v = listItem?.variant || "";
  const variantJson = await loadVariantJson(subject, v);
  const studentMap = extractStudentAnswers(resultJson);
  const keyMap = extractKeyAnswers(variantJson, keyStore);

  if (!Object.keys(keyMap).length) {
    throw new Error("Не найден ключ. Загрузите ключ JSON или добавьте ответы в variant JSON.");
  }
  return gradeAnswers(studentMap, keyMap);
}

/* ========= Print ========= */
function openPrintWindow({ title, subject, variantJson, resultJson, grade }) {
  const w = window.open("", "_blank");
  if (!w) { status("Popup заблокирован."); return; }

  const theme = document.documentElement.dataset.theme || "dark";
  const prefix = repoPrefixGuess();
  const css1 = `${prefix}/assets/css/control-ui.css`;
  const css2 = `/assets/css/control-ui.css`;

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
  table{width:100%;border-collapse:collapse}
  td,th{border-top:1px solid rgba(255,255,255,.12);padding:8px;text-align:left;vertical-align:top}
  @media print {.bar{display:none} body{padding:0}}
</style>
</head>
<body>
  <div class="bar"><button class="btn" onclick="window.print()">Печать / PDF</button></div>
  <h1>${escapeHtml(title)}</h1>
  <div style="opacity:.85">Предмет: ${escapeHtml(subject)}${grade ? ` • ${grade.ok}/${grade.total} (${grade.percent}%)` : ""}</div>

  <h2>Вариант</h2>
  ${variantJson ? `<pre>${escapeHtml(JSON.stringify(variantJson, null, 2))}</pre>` : `<div style="opacity:.8">Вариант не подгрузился.</div>`}

  <h2>Ответы ученика</h2>
  <pre>${escapeHtml(JSON.stringify(resultJson, null, 2))}</pre>

  ${grade ? `
    <h2>Автопроверка</h2>
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

/* ========= Table actions ========= */
$("resultsTbody")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const key = btn.dataset.get || btn.dataset.dl || btn.dataset.print || btn.dataset.check;
  if (!key) return;

  const it = (visibleList || []).find(x => x.key === key) || (lastList || []).find(x => x.key === key);
  const subject = $("subjectSelect")?.value || "russian";

  try {
    status("Загрузка результата…");
    const result = await getResultByKey(key);

    if (btn.dataset.get) {
      $("jsonViewer").value = JSON.stringify(result, null, 2);
      status("JSON открыт ✅");
      return;
    }

    if (btn.dataset.dl) {
      const fio = (it?.fio || "student").replace(/\s+/g, "_");
      const cls = (it?.cls || "").replace(/\s+/g, "_");
      const v = it?.variant || "";
      downloadJson(result, `result_${subject}_${cls}_${fio}_${v}.json`);
      status("Скачано ✅");
      return;
    }

    if (btn.dataset.check) {
      status("Автопроверка…");
      const g = await autocheck(subject, it || {}, result);
      $("jsonViewer").value = JSON.stringify({ grade: g, result }, null, 2);
      status(`Проверено ✅ ${g.ok}/${g.total} (${g.percent}%)`);
      return;
    }

    if (btn.dataset.print) {
      status("Печать…");
      let g = null;
      try { g = await autocheck(subject, it || {}, result); } catch { /* ok */ }
      const variantJson = await loadVariantJson(subject, it?.variant || "");
      const title = `${it?.fio || "Ученик"} • ${it?.cls || ""} • ${it?.variant || ""}`.trim();
      openPrintWindow({ title, subject, variantJson, resultJson: result, grade: g });
      status("Окно печати открыто ✅");
      return;
    }
  } catch (err) {
    status("Ошибка: " + err.message);
  }
});

/* ========= Print selected ========= */
async function printSelected() {
  const checked = Array.from($("resultsTbody").querySelectorAll("input[type='checkbox'][data-key]:checked"))
    .map(x => x.getAttribute("data-key")).filter(Boolean);
  if (checked.length !== 1) { status("Выбери ровно 1 работу для печати."); return; }

  const key = checked[0];
  const it = (visibleList || []).find(x => x.key === key) || (lastList || []).find(x => x.key === key);
  const subject = $("subjectSelect")?.value || "russian";

  try {
    status("Печать…");
    const result = await getResultByKey(key);
    let g = null;
    try { g = await autocheck(subject, it || {}, result); } catch { /* ok */ }
    const variantJson = await loadVariantJson(subject, it?.variant || "");
    const title = `${it?.fio || "Ученик"} • ${it?.cls || ""} • ${it?.variant || ""}`.trim();
    openPrintWindow({ title, subject, variantJson, resultJson: result, grade: g });
    status("Окно печати открыто ✅");
  } catch (e) {
    status("Печать ошибка: " + e.message);
  }
}

/* ========= Bind base buttons ========= */
$("btnList")?.addEventListener("click", () => loadList());
$("fioSearch")?.addEventListener("input", () => {
  visibleList = applyClientFilters(lastList);
  renderTable(visibleList);
  status(`Фильтр: ${visibleList.length}`);
});

/* ========= Start ========= */
(async () => {
  try {
    ensureExtras();
    status("Готово. (teacher.js загружен)");
  } catch (e) {
    status("JS ошибка: " + e.message);
    console.error(e);
  }
})();
