// teacher_panel_tabs.js
// Вкладки: Проверка (работы из бакета через Teacher API) + Сброс (reset-код) + PIN на вход.
// PIN — client-side (localStorage). Для полноценной защиты нужен серверный логин.

"use strict";

const $ = (id) => document.getElementById(id);
const status = (msg) => { const el = $("statusLine"); if (el) el.textContent = msg; };

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function repoPrefixGuess(){
  const parts = location.pathname.split("/").filter(Boolean);
  if (!parts.length) return "";
  return "/" + parts[0];
}

/* ===== Theme ===== */
function applyTheme(t){
  const theme = t === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  const toggle = $("themeToggle");
  if (toggle) toggle.checked = theme === "light";
  localStorage.setItem("kd-theme", theme);
}

/* ===== PIN gate (local) ===== */
async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
const PIN_HASH_KEY = "kd-teacher-pin-sha256";

async function ensurePinExists(){
  const existing = localStorage.getItem(PIN_HASH_KEY);
  if (existing) return;

  let p1 = prompt("Создайте PIN для учительского раздела (4-12 цифр):","");
  if (p1 === null) throw new Error("PIN setup cancelled");
  p1 = String(p1).trim();
  if (!/^\d{4,12}$/.test(p1)) { alert("PIN должен быть 4-12 цифр."); return ensurePinExists(); }

  let p2 = prompt("Повторите PIN:","");
  if (p2 === null) throw new Error("PIN setup cancelled");
  p2 = String(p2).trim();
  if (p1 !== p2) { alert("PIN не совпал. Попробуйте ещё раз."); return ensurePinExists(); }

  const h = await sha256Hex(p1);
  localStorage.setItem(PIN_HASH_KEY, h);
}

async function pinEnter(){
  const input = $("pinInput");
  const pin = String(input?.value || "").trim();
  if (!pin) return;

  const h = await sha256Hex(pin);
  const expected = localStorage.getItem(PIN_HASH_KEY) || "";
  if (h !== expected) {
    $("pinStatus").textContent = "Неверный PIN";
    input.value = "";
    input.focus();
    return;
  }

  $("pinOverlay").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("pinStatus").textContent = "";
  input.value = "";
}

async function pinReset(){
  if (!confirm("Сменить PIN в этом браузере?")) return;
  localStorage.removeItem(PIN_HASH_KEY);
  await ensurePinExists();
  $("pinStatus").textContent = "PIN обновлён";
}

/* ===== manifest + Teacher API ===== */
let manifestCache = { subject:null, manifest:null };

async function loadManifest(subject){
  if (manifestCache.manifest && manifestCache.subject === subject) return manifestCache.manifest;

  const prefix = repoPrefixGuess();
  const url1 = `${prefix}/controls/${subject}/variants/manifest.json`;
  const url2 = `/controls/${subject}/variants/manifest.json`;

  async function fetchJson(url){
    const r = await fetch(url, { cache:"no-store" });
    if (!r.ok) throw new Error(`manifest.json ${r.status}`);
    return r.json();
  }

  try{
    const m = await fetchJson(url1);
    manifestCache = { subject, manifest:m };
    return m;
  }catch{
    const m = await fetchJson(url2);
    manifestCache = { subject, manifest:m };
    return m;
  }
}

function getApiFromManifest(m){
  return {
    base: String(m?.teacher?.base_url || "").replace(/\/+$/,""),
    token: String(m?.teacher?.token || "")
  };
}

async function apiCall(subject, path, body){
  const m = await loadManifest(subject);
  const { base, token } = getApiFromManifest(m);
  if (!base || !token) throw new Error("В manifest.json не задан teacher.base_url / teacher.token");

  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type":"application/json", "X-Teacher-Token": token },
    body: JSON.stringify(body || {})
  });

  const txt = await res.text();
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

/* ===== CHECK: grading ===== */
const THRESH_5 = 87, THRESH_4 = 67, THRESH_3 = 42;

function normText(s){
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replaceAll("ё","е")
    .replace(/[.,;:!?]+$/g,"")
    .replace(/\s+/g," ");
}
function normNums(s){
  const raw = normText(s).replace(/[^0-9]/g,"");
  return raw.split("").sort().join("");
}
function isNumericKeyStr(k){ return /^[0-9]+$/.test(String(k||"")); }

function checkOne(user, keys){
  const u0 = normText(user);
  if(!u0) return false;

  const keysArr = Array.isArray(keys) ? keys : [keys];
  const hasNumKeys = keysArr.some(isNumericKeyStr);
  if(hasNumKeys){
    const un = normNums(user);
    const kn = keysArr.map(k => normNums(k));
    return kn.includes(un);
  }else{
    const un = normText(user).replace(/\s/g,"");
    const kn = keysArr.map(k => normText(k).replace(/\s/g,""));
    return kn.includes(un);
  }
}
function gradeFromPercent(p){
  if (p >= THRESH_5) return 5;
  if (p >= THRESH_4) return 4;
  if (p >= THRESH_3) return 3;
  return 2;
}

function extractStudentAnswers(obj){
  const fio = obj?.identity?.fio || obj?.student?.name || "";
  const cls = obj?.identity?.cls || obj?.student?.class || "";
  const amap = {};

  if (Array.isArray(obj?.answers)){
    obj.answers.forEach(a => { amap[String(a.id)] = a.value ?? a.answer ?? ""; });
  } else if (obj?.answers && typeof obj.answers === "object"){
    Object.entries(obj.answers).forEach(([k,v]) => amap[String(k)] = v?.value ?? v ?? "");
  } else if (obj?.userAnswers && typeof obj.userAnswers === "object"){
    Object.entries(obj.userAnswers).forEach(([k,v]) => amap[String(k)] = v ?? "");
  }

  return { fio, cls, amap };
}

function buildReport(keyObj, studentObj, meta){
  const keyTitle = keyObj?.title || keyObj?.meta?.title || keyObj?.set || "";
  const keyAnswers = keyObj?.answers || keyObj?.ANSWER_KEY?.answers || {};
  const keyPoints  = keyObj?.points || {};
  const keysList = Object.keys(keyAnswers).sort((a,b)=>Number(a)-Number(b));

  const { fio, cls, amap } = extractStudentAnswers(studentObj);

  const items = [];
  let correct = 0, points = 0, maxPoints = 0, empty = 0;

  keysList.forEach(n => {
    const rightKeys = keyAnswers[n];
    const userRaw = amap[n] ?? "";
    const hasUser = normText(userRaw) !== "";
    if(!hasUser) empty++;

    const ok = hasUser ? checkOne(userRaw, rightKeys) : false;
    const p = Number(keyPoints[n] ?? 1);
    const got = ok ? p : 0;
    if(ok) correct++;
    points += got;
    maxPoints += p;

    items.push({ n, user: userRaw ?? "", right: Array.isArray(rightKeys) ? rightKeys : [rightKeys], ok });
  });

  const percent = maxPoints ? (points / maxPoints) * 100 : 0;

  return {
    key: meta?.key || "",
    createdAt: meta?.createdAt || "",
    variant: meta?.variant || "",
    fio, cls, keyTitle,
    total: keysList.length,
    correct,
    empty,
    points,
    maxPoints,
    percent,
    grade: gradeFromPercent(percent),
    items
  };
}

/* ===== CSV ===== */
function safeStr(x){ return (x === null || x === undefined) ? "" : String(x); }
function makeCSV(rows){
  const esc = (v) => `"${safeStr(v).replaceAll('"','""')}"`;
  return rows.map(r => r.map(esc).join(';')).join('\n');
}
function downloadText(text, filename, mime){
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/* ===== PRINT / PDF ===== */
function buildPrintHtml(){
  if (!reports.length) return "<h2>Нет данных для печати</h2>";
  const head = `<h1>Отчёт проверки</h1><div style="margin:6px 0 18px;color:#555">Проверено: ${reports.length}</div>`;
  const cards = reports.map(r=>{
    const rows = (r.items||[]).map(it=>{
      const u = normText(it.user) ? safeStr(it.user) : "—";
      const right = (it.right||[]).join(" / ");
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd"><b>${escapeHtml(it.n)}</b></td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd">${escapeHtml(u)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;color:#555">${escapeHtml(right)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd">${it.ok ? "верно" : "ошибка"}</td>
      </tr>`;
    }).join("");
    return `<div style="page-break-inside:avoid;border:1px solid #ddd;border-radius:12px;padding:12px;margin:0 0 14px">
      <div style="font-weight:800">${escapeHtml(r.fio||"—")} (${escapeHtml(r.cls||"—")})</div>
      <div style="color:#555;margin-top:4px">Баллы: <b>${r.points}/${r.maxPoints}</b> • ${r.percent.toFixed(1)}% • оценка <b>${r.grade}</b> • вариант: ${escapeHtml(r.variant||"")}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999;width:46px">№</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999">Ответ</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999">Ключ</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999;width:70px">Статус</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");
  return head + cards;
}
function printReports(){
  const w = window.open("", "_blank");
  if (!w) { alert("Браузер заблокировал окно печати."); return; }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Печать</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111}
      h1{margin:0 0 8px}
      @media print{ body{margin:10mm} }
    </style>
  </head><body>${buildPrintHtml()}</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
  w.focus();
  w.print();
}

/* ===== state ===== */
let keyObj = null;
let listItems = [];
let visibleItems = [];
let reports = [];
let lastCSV = null;

function normalizeVariantDigits(v){
  const s = String(v || "").trim();
  const m = s.match(/(\d+)/);
  if (!m) return "";
  const n = m[1];
  return n.length === 1 ? `0${n}` : n;
}

function applyFilters(items){
  const q = ($("fioSearch").value || "").trim().toLowerCase();
  if (!q) return items.slice();
  return items.filter(it => (`${it.fio||""} ${it.cls||""} ${it.variant||""} ${it.key||""}`).toLowerCase().includes(q));
}

function renderList(){
  const w = $("listWrap");
  if (!visibleItems.length){
    w.innerHTML = '<div class="sub">Пока нет работ по фильтрам.</div>';
    return;
  }
  const rows = visibleItems.map(it => {
    const created = (it.createdAt || "").replace("T"," ").slice(0,16);
    return `
      <tr>
        <td style="width:44px"><input type="checkbox" class="pick" data-key="${escapeHtml(it.key)}"></td>
        <td><b>${escapeHtml(it.fio || "—")}</b><div class="sub">${escapeHtml(it.cls || "")}</div></td>
        <td>${escapeHtml(it.variant || "")}</td>
        <td>${escapeHtml(created)}</td>
        <td class="sub"><code>${escapeHtml(it.key)}</code></td>
      </tr>
    `;
  }).join("");
  w.innerHTML = `
    <table>
      <thead><tr><th></th><th>Ученик</th><th>Вариант</th><th>Дата</th><th>Ключ (S3)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function updateButtons(){
  const anyChecked = document.querySelectorAll(".pick:checked").length > 0;
  const btnCheck = $("btnCheckSelected");
  const btnCSV = $("btnCSV");
  const btnPrint = $("btnPrint");
  if (btnCheck) btnCheck.disabled = !(keyObj && anyChecked);
  if (btnCSV) btnCSV.disabled = !(lastCSV && lastCSV.length);
  if (btnPrint) btnPrint.disabled = !(reports && reports.length);
}

async function loadKey(){
  const f = $("keyFile").files?.[0];
  keyObj = null;
  if (!f){ status("Выберите файл ключа (JSON)."); updateButtons(); return; }
  try{
    keyObj = JSON.parse(await f.text());
    const v = keyObj?.variant || keyObj?.meta?.variant || "";
    const s = keyObj?.subject || keyObj?.meta?.subject || "";
    $("keyInfo").innerHTML = `Загружен ключ: <b>${escapeHtml(v || "—")}</b> • предмет: <b>${escapeHtml(s || "—")}</b>`;
    status("Ключ загружен ✅");
  }catch(e){
    alert("Не удалось прочитать ключ (JSON).\n\n" + e.message);
    $("keyFile").value = "";
    keyObj = null;
    $("keyInfo").textContent = "";
  }
  updateButtons();
}

async function loadList(){
  status("Загрузка списка…");
  const subject = $("subjectSelect").value || "russian";
  const variantDigits = normalizeVariantDigits($("variantFilter").value);
  const cls = ($("classFilter").value || "").trim();

  const data = await apiCall(subject, "/teacher/list", { variant: variantDigits, cls, limit: 200 });
  listItems = Array.isArray(data.items) ? data.items : [];
  visibleItems = applyFilters(listItems);
  renderList();
  status(`Загружено: ${visibleItems.length}`);
  $("checkAll").checked = false;
  updateButtons();
}

function renderSummary(){
  const w = $("summary");
  if (!reports.length){
    w.innerHTML = "Пока нет проверок.";
    return;
  }
  const avg = reports.reduce((s,r)=>s + (r.percent||0),0) / reports.length;
  const g = gradeFromPercent(avg);
  w.innerHTML = `
    <div class="row" style="gap:12px">
      <div class="pill">Проверено: <b>${reports.length}</b></div>
      <div class="pill">Средний %: <b>${avg.toFixed(1)}%</b></div>
      <div class="pill">Средняя оценка: <b>${g}</b></div>
      <div class="pill">Ключ: <b>${escapeHtml(reports[0].keyTitle || "—")}</b></div>
    </div>
  `;
}

function renderDetails(){
  const w = $("detailsWrap");
  if(!reports.length){
    w.innerHTML = '<div class="sub">Пока нет результатов.</div>';
    return;
  }
  w.innerHTML = reports.map(r => {
    const head = `${safeStr(r.fio)||"—"} (${safeStr(r.cls)||"—"}) — ${r.points}/${r.maxPoints} · ${r.percent.toFixed(1)}% · оценка ${r.grade}`;
    const rows = (r.items || []).map(it => {
      const u = normText(it.user) ? safeStr(it.user) : "—";
      const right = (it.right || []).join(" / ");
      return `<tr>
        <td><b>${escapeHtml(it.n)}</b></td>
        <td>${escapeHtml(u)}</td>
        <td class="sub">${escapeHtml(right)}</td>
        <td>${it.ok ? '<span class="ok">верно</span>' : '<span class="bad">ошибка</span>'}</td>
      </tr>`;
    }).join("");
    return `
      <details>
        <summary>${escapeHtml(head)}</summary>
        <div class="sub" style="margin-top:8px">S3: <code>${escapeHtml(r.key)}</code></div>
        ${rows ? `
          <table style="margin-top:10px">
            <thead><tr><th style="width:60px">№</th><th>Ответ</th><th>Ключ</th><th style="width:110px">Статус</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        ` : ''}
      </details>
    `;
  }).join("");
}

function buildCSV(){
  const rows = [["ФИО","Класс","Баллы","Макс","Процент","Оценка","Верно","Всего","Пусто","Вариант","Дата","Ключ(S3)"]];
  reports.forEach(r => {
    rows.push([
      safeStr(r.fio), safeStr(r.cls),
      r.points, r.maxPoints,
      (r.percent ?? 0).toFixed(1),
      r.grade, r.correct, r.total, r.empty,
      safeStr(r.variant), safeStr(r.createdAt), safeStr(r.key)
    ]);
  });
  return makeCSV(rows);
}

async function checkSelected(){
  const subject = $("subjectSelect").value || "russian";
  const keys = Array.from(document.querySelectorAll(".pick:checked")).map(x => x.getAttribute("data-key")).filter(Boolean);
  if (!keyObj){ status("Сначала загрузите ключ."); return; }
  if (!keys.length){ status("Ничего не выбрано."); return; }

  status(`Загрузка ${keys.length} работ…`);
  reports = [];

  for (const k of keys){
    try{
      const meta = listItems.find(x => x.key === k) || { key:k };
      const obj = await apiCall(subject, "/teacher/get", { key: k });
      reports.push(buildReport(keyObj, obj, meta));
    }catch{
      reports.push({
        key: k, createdAt:"", variant:"",
        fio:"", cls:"",
        keyTitle: keyObj?.title || keyObj?.meta?.title || keyObj?.set || "",
        total:0, correct:0, empty:0, points:0, maxPoints:0, percent:0, grade:2,
        items: []
      });
    }
  }

  reports.sort((a,b)=> (a.cls||"").localeCompare(b.cls||"","ru") || (a.fio||"").localeCompare(b.fio||"","ru"));
  renderSummary();
  renderDetails();
  lastCSV = buildCSV();
  updateButtons();
  status(`Проверено: ${reports.length} ✅`);
}

function onCSV(){
  if (!lastCSV) return;
  const subject = $("subjectSelect").value || "subject";
  const d = new Date().toISOString().slice(0,10);
  downloadText(lastCSV, `bucket_report_${subject}_${d}.csv`, "text/csv;charset=utf-8");
}

function clearCheck(){
  listItems = [];
  visibleItems = [];
  reports = [];
  lastCSV = null;

  $("variantFilter").value = "";
  $("classFilter").value = "";
  $("fioSearch").value = "";
  $("checkAll").checked = false;

  $("listWrap").innerHTML = "";
  $("summary").innerHTML = "";
  $("detailsWrap").innerHTML = "";
  status("Очищено.");
  updateButtons();
}

/* ===== RESET ===== */
let lastReset = null;
const RESET_HISTORY_KEY = "kd-reset-history-v1";

function getResetHistory(){
  try { return JSON.parse(localStorage.getItem(RESET_HISTORY_KEY) || "[]"); } catch { return []; }
}
function setResetHistory(arr){
  localStorage.setItem(RESET_HISTORY_KEY, JSON.stringify(arr.slice(0, 50)));
}
function renderResetHistory(){
  const arr = getResetHistory();
  if (!arr.length){ $("resetHistory").innerHTML = "<span class='sub'>Пока пусто.</span>"; return; }

  $("resetHistory").innerHTML = arr.map(x => {
    const t = (x.createdAt || "").replace("T"," ").slice(0,16);
    return `<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.08)">
      <b>${escapeHtml(x.fio || "—")}</b> <span class="sub">${escapeHtml(x.cls || "")}</span>
      <div class="sub">вариант: <b>${escapeHtml(x.variant || "")}</b> • ${escapeHtml(x.subject || "")} • ${escapeHtml(t)}</div>
      <div class="sub">код: <code>${escapeHtml(x.code || "")}</code></div>
    </div>`;
  }).join("");
}

function controlLink(subject, variant, code){
  const base = location.origin + repoPrefixGuess();
  return `${base}/control/control.html?subject=${encodeURIComponent(subject)}&variant=${encodeURIComponent(variant)}&reset=${encodeURIComponent(code)}`;
}

async function makeReset(){
  const subject = $("resetSubject").value || "russian";
  const variant = ($("resetVariant").value || "").trim(); // важное: variant_01
  const cls = ($("resetClass").value || "").trim();
  const fio = ($("resetFio").value || "").trim();

  if (!subject || !variant || !cls || !fio){
    $("resetOut").innerHTML = "<span class='bad'>Заполните: предмет, вариант (variant_01), класс, ФИО.</span>";
    return;
  }

  $("resetOut").textContent = "Создание кода…";
  const r = await apiCall(subject, "/teacher/reset", { subject, variant, cls, fio });

  lastReset = { subject, variant, cls, fio, code:r.code, expiresAt:r.expiresAt, key:r.key, createdAt: new Date().toISOString() };

  const link = controlLink(subject, variant, r.code);

  $("resetOut").innerHTML = `
    <div class="pill">Код: <b>${escapeHtml(r.code)}</b></div>
    <div class="sub" style="margin-top:8px">Действует до: <b>${escapeHtml(r.expiresAt || "")}</b></div>
    <div class="sub" style="margin-top:6px">S3: <code>${escapeHtml(r.key || "")}</code></div>
    <div class="sub" style="margin-top:6px">Ссылка: <code>${escapeHtml(link)}</code></div>
  `;

  $("btnCopyReset").disabled = false;
  $("btnCopyResetLink").disabled = false;

  const hist = getResetHistory();
  hist.unshift(lastReset);
  setResetHistory(hist);
  renderResetHistory();

  try { await navigator.clipboard.writeText(r.code); } catch {}
}
async function copyReset(){
  if (!lastReset?.code) return;
  try { await navigator.clipboard.writeText(lastReset.code); } catch {}
}
async function copyResetLink(){
  if (!lastReset?.code) return;
  const link = controlLink(lastReset.subject, lastReset.variant, lastReset.code);
  try { await navigator.clipboard.writeText(link); } catch {}
}
function clearResetHistory(){
  if (!confirm("Очистить локальный журнал reset-кодов?")) return;
  localStorage.removeItem(RESET_HISTORY_KEY);
  renderResetHistory();
}

/* ===== Tabs ===== */
function setTab(name){
  const isCheck = name === "check";
  $("tabCheck").setAttribute("aria-selected", isCheck ? "true":"false");
  $("tabReset").setAttribute("aria-selected", isCheck ? "false":"true");
  $("panelCheck").classList.toggle("hidden", !isCheck);
  $("panelReset").classList.toggle("hidden", isCheck);
  if (!isCheck) $("resetSubject").value = $("subjectSelect").value || "russian";
}

/* ===== Init ===== */
async function init(){
  applyTheme(localStorage.getItem("kd-theme") || "dark");
  $("themeToggle").addEventListener("change", (e)=>applyTheme(e.target.checked ? "light":"dark"));

  $("tabCheck").addEventListener("click", ()=>setTab("check"));
  $("tabReset").addEventListener("click", ()=>setTab("reset"));

  $("btnLoadKey").addEventListener("click", ()=>loadKey().catch(e=>status("Ошибка ключа: " + e.message)));
  $("btnLoadList").addEventListener("click", ()=>loadList().catch(e=>status("Ошибка list: " + e.message)));
  $("btnCheckSelected").addEventListener("click", ()=>checkSelected().catch(e=>status("Ошибка проверки: " + e.message)));
  $("btnCSV").addEventListener("click", onCSV);
  $("btnClearCheck").addEventListener("click", clearCheck);
  $("btnPrint").addEventListener("click", ()=>printReports());

  $("fioSearch").addEventListener("input", () => {
    visibleItems = applyFilters(listItems);
    renderList();
    $("checkAll").checked = false;
    updateButtons();
  });

  $("checkAll").addEventListener("change", (e) => {
    document.querySelectorAll(".pick").forEach(cb => cb.checked = e.target.checked);
    updateButtons();
  });

  document.addEventListener("change", (e) => {
    if (e.target && e.target.classList.contains("pick")) updateButtons();
  });

  $("btnMakeReset").addEventListener("click", ()=>makeReset().catch(e=>{$("resetOut").innerHTML = "<span class='bad'>Ошибка: " + escapeHtml(e.message) + "</span>";}));
  $("btnCopyReset").addEventListener("click", ()=>copyReset());
  $("btnCopyResetLink").addEventListener("click", ()=>copyResetLink());
  $("btnResetHistoryClear").addEventListener("click", clearResetHistory);
  renderResetHistory();

  await ensurePinExists();
  $("btnPinEnter").addEventListener("click", ()=>pinEnter().catch(()=>{}));
  $("btnPinReset").addEventListener("click", ()=>pinReset().catch(()=>{}));
  $("pinInput").addEventListener("keydown", (e)=>{ if (e.key === "Enter") $("btnPinEnter").click(); });
  $("pinInput").focus();

  setTab("check");
  status("Готово. Загрузите ключ → Обновите список → Выберите работы → Проверить выбранные.");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ()=>init().catch(console.error));
else init().catch(console.error);
