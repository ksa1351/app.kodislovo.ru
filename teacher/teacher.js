/* teacher.js — Kodislovo Teacher Panel (matches teacher/index.html)
   Requires: ../assets/css/control-ui.css already linked in HTML.

   HTML ids used (see teacher/index.html):
   - themeToggle, themeLabel
   - subjectSelect
   - timerMinutes, btnTimerLoad, btnTimerSave
   - resetVariant, resetClass, resetFio, btnResetMake
   - btnList, btnVoidSelected
   - classFilter, variantFilter, fioSearch
   - resultsTbody, jsonViewer, statusLine
*/

(() => {
  "use strict";

  const THEME_KEY = "kodislovo_teacher_theme";
  const $ = (id) => document.getElementById(id);

  function safeText(v){ return (v ?? "").toString().trim(); }
  function nowIso(){ return new Date().toISOString(); }

  function projectRoot() {
    const seg = (location.pathname.split("/").filter(Boolean)[0] || "");
    return seg ? `/${seg}/` : "/";
  }
  function variantsBase(subject) {
    return `${location.origin}${projectRoot()}controls/${encodeURIComponent(subject)}/variants/`;
  }

  async function fetchJson(url){
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if(!r.ok){
      const msg = (json && (json.message||json.error)) ? (json.message||json.error) : text || `HTTP ${r.status}`;
      const e = new Error(msg);
      e.status = r.status; e.body = json || text;
      throw e;
    }
    return json;
  }

  async function apiCall(baseUrl, path, { method="GET", params=null, body=null, token="" } = {}){
    const base = String(baseUrl||"").replace(/\/+$/,"");
    if(!base) throw new Error("teacher.base_url не задан");
    if(!token) throw new Error("teacher.token не задан");

    const u = new URL(base + (path.startsWith("/")?path:`/${path}`));
    if(params){
      for(const [k,v] of Object.entries(params)){
        if(v!==undefined && v!==null && String(v)!=="") u.searchParams.set(k, String(v));
      }
    }

    const headers = {
      "Accept": "application/json",
      "X-Teacher-Token": token,
      "Authorization": `Bearer ${token}`,
    };
    if(body!==null) headers["Content-Type"]="application/json;charset=utf-8";

    const r = await fetch(u.toString(), {
      method,
      headers,
      body: body!==null ? JSON.stringify(body) : undefined
    });

    const text = await r.text();
    let json=null; try{ json = text ? JSON.parse(text) : null; }catch{ json=text; }

    if(!r.ok){
      const msg = (json && (json.message||json.error)) ? (json.message||json.error) : (typeof json==="string"?json:"") || `HTTP ${r.status}`;
      const e = new Error(msg);
      e.status=r.status; e.body=json;
      throw e;
    }
    return json;
  }

  function setStatus(msg, kind="info"){
    const el = $("statusLine");
    if(!el) return;
    el.textContent = msg;
    el.style.borderColor = kind==="error" ? "rgba(255,91,110,.55)" : "var(--line)";
    el.style.color = kind==="error" ? "var(--bad)" : "var(--muted)";
  }

  // ---------- theme ----------
  function getTheme(){
    const t = localStorage.getItem(THEME_KEY);
    if(t==="dark"||t==="light") return t;
    const cur = document.documentElement.getAttribute("data-theme");
    if(cur==="dark"||cur==="light") return cur;
    return "dark";
  }
  function applyTheme(t){
    const theme = (t==="light") ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    if($("themeLabel")) $("themeLabel").textContent = theme==="light" ? "Светлая" : "Тёмная";
    const chk = $("themeToggle");
    if(chk) chk.checked = (theme==="light");
  }
  function toggleTheme(){
    const cur = getTheme();
    applyTheme(cur==="dark" ? "light" : "dark");
  }

  // ---------- download helpers ----------
  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function downloadJson(obj, filename){
    const blob = new Blob([JSON.stringify(obj, null, 2)], {type:"application/json;charset=utf-8"});
    downloadBlob(blob, filename);
  }

  function toCsv(rows){
    const cols = Array.from(rows.reduce((s,r)=>{Object.keys(r||{}).forEach(k=>s.add(k)); return s;}, new Set()));
    const esc = (v) => {
      const s = safeText(v);
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const header = cols.map(esc).join(";");
    const lines = rows.map(r=>cols.map(c=>esc(r?.[c])).join(";"));
    return [header, ...lines].join("\r\n");
  }

  function isoToLocal(iso){
    if(!iso) return "";
    const d = new Date(iso);
    if(Number.isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleString();
  }

  // ---------- state ----------
  const state = {
    subject: "russian",
    manifest: null,
    teacherBaseUrl: "",
    teacherToken: "",
    items: [],
    filtered: []
  };

  function normalizeItem(x){
    const key = x?.key || x?.id || x?.objectKey || x?.storageKey || "";
    const fio = x?.fio || x?.studentName || x?.student?.name || x?.name || "";
    const cls = x?.class || x?.klass || x?.studentClass || x?.student?.class || "";
    const variant = x?.variantId || x?.variant?.id || x?.variant || x?.variant_id || "";
    const created = x?.createdAt || x?.created_at || x?.submittedAt || x?.submitted_at || x?.ts || "";
    const voided = !!(x?.voided || x?.isVoided || x?.deleted || x?.archived);
    return { ...x, __key:key, __fio:fio, __class:cls, __variant:variant, __created:created, __voided:voided };
  }

  function getFilters(){
    return {
      cls: safeText($("classFilter")?.value),
      variant: safeText($("variantFilter")?.value),
      q: safeText($("fioSearch")?.value),
    };
  }

  function applyFilter(){
    const {cls, variant, q} = getFilters();
    const ql = q.toLowerCase();
    state.filtered = (state.items||[]).filter(it=>{
      if(cls && safeText(it.__class).toLowerCase() !== cls.toLowerCase()) return false;
      if(variant && safeText(it.__variant).toLowerCase() !== variant.toLowerCase()) return false;
      if(ql){
        const hay = `${it.__fio} ${it.__class} ${it.__variant} ${it.__key}`.toLowerCase();
        if(!hay.includes(ql)) return false;
      }
      return true;
    });
  }

  function renderList(){
    const tbody = $("resultsTbody");
    if(!tbody) return;

    applyFilter();
    const items = state.filtered || [];
    tbody.innerHTML = "";

    if(!items.length){
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6" style="padding:12px;color:var(--muted)">Нет результатов</td>`;
      tbody.appendChild(tr);
      return;
    }

    for(const it of items){
      const tr = document.createElement("tr");
      tr.dataset.key = it.__key || "";
      tr.style.borderTop = "1px solid var(--line)";

      tr.innerHTML = `
        <td style="padding:10px;width:44px">
          <input type="checkbox" class="rowCheck" data-key="${escapeHtml(it.__key)}" ${it.__voided?"disabled":""}>
        </td>
        <td style="padding:10px">
          <div style="font-weight:700">${escapeHtml(it.__fio || "—")}</div>
          <div style="color:var(--muted);font-size:13px">${escapeHtml(it.__class || "")}</div>
        </td>
        <td style="padding:10px">${escapeHtml(it.__variant || "")}</td>
        <td style="padding:10px">${escapeHtml(isoToLocal(it.__created))}</td>
        <td style="padding:10px;font-family:ui-monospace,Consolas,monospace;font-size:12px;opacity:.9">${escapeHtml(it.__key)}</td>
        <td style="padding:10px;white-space:nowrap">
          <button class="kd-btn secondary" style="height:36px;border-radius:12px;padding:0 12px;width:auto" data-act="get">Открыть</button>
          <button class="kd-btn secondary" style="height:36px;border-radius:12px;padding:0 12px;width:auto" data-act="download">JSON</button>
          <button class="kd-btn secondary" style="height:36px;border-radius:12px;padding:0 12px;width:auto;border:1px solid rgba(255,91,110,.55);color:var(--bad);background:transparent" data-act="void">Void</button>
          <button class="kd-btn secondary" style="height:36px;border-radius:12px;padding:0 12px;width:auto" data-act="print">PDF</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(s){
    return safeText(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  async function loadManifest(){
    const base = variantsBase(state.subject);
    const m = await fetchJson(base + "manifest.json");
    state.manifest = m;
    state.teacherBaseUrl = m?.teacher?.base_url || "";
    state.teacherToken = m?.teacher?.token || "";
    return m;
  }

  async function loadList(){
    setStatus("Загрузка списка…");
    const {cls, variant, q} = getFilters();
    const data = await apiCall(state.teacherBaseUrl, "/teacher/list", {
      params: { subject: state.subject, cls, class: cls, variant, q },
      token: state.teacherToken
    });

    const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.results) ? data.results : [];
    state.items = arr.map(normalizeItem).sort((a,b)=>{
      const ta = new Date(a.__created||0).getTime();
      const tb = new Date(b.__created||0).getTime();
      return (tb||0)-(ta||0);
    });

    renderList();
    setStatus(`Загружено: ${state.items.length}`, "ok");
  }

  async function getResult(key){
    const data = await apiCall(state.teacherBaseUrl, "/teacher/get", {
      params: { key, subject: state.subject },
      token: state.teacherToken
    });
    return data;
  }

  async function voidResult(key){
    await apiCall(state.teacherBaseUrl, "/teacher/void", {
      method: "POST",
      body: { key, subject: state.subject },
      token: state.teacherToken
    });
  }

  async function voidSelected(){
    const checks = Array.from(document.querySelectorAll(".rowCheck:checked"));
    const keys = checks.map(c=>c.dataset.key).filter(Boolean);
    if(!keys.length){ alert("Ничего не выбрано."); return; }

    if(!confirm(`Аннулировать выбранные (${keys.length})?`)) return;

    setStatus("Аннулирую…");
    let ok=0, bad=0;
    for(const k of keys){
      try{ await voidResult(k); ok++; }
      catch(e){ console.error(e); bad++; }
    }
    await loadList();
    setStatus(`Готово. void: ${ok}, ошибок: ${bad}`, bad? "error":"ok");
  }

  function openPrintWindow(result){
    const w = window.open("", "_blank");
    if(!w){ alert("Разрешите всплывающие окна для печати."); return; }
    const theme = document.documentElement.getAttribute("data-theme") || "dark";
    const cssHref1 = `${projectRoot()}assets/css/control-ui.css`;
    const cssHref2 = `/assets/css/control-ui.css`;
    const title = `Кодислово — ${safeText(result?.student?.name || result?.student?.fio || "")} — ${safeText(result?.variant?.id || result?.variantId || "")}`.trim() || "Кодислово — результат";
    w.document.open();
    w.document.write(`<!doctype html>
<html lang="ru" data-theme="${escapeHtml(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${cssHref1}">
<link rel="stylesheet" href="${cssHref2}">
<style>
  body{padding:16px}
  h1{margin:0 0 10px}
  pre{white-space:pre-wrap;word-break:break-word;border:1px solid var(--line);border-radius:16px;padding:12px;background:rgba(255,255,255,.04)}
  .toolbar{position:sticky;top:0;background:rgba(0,0,0,.25);backdrop-filter:blur(8px);padding:10px;border:1px solid var(--line);border-radius:16px;margin-bottom:12px}
  .btn{height:40px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:inherit;font-weight:700;padding:0 14px;cursor:pointer}
  @media print {.toolbar{display:none} body{padding:0}}
</style>
</head>
<body>
  <div class="toolbar"><button class="btn" onclick="window.print()">Печать / Сохранить в PDF</button></div>
  <h1>${escapeHtml(title)}</h1>
  <pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
</body>
</html>`);
    w.document.close();
  }

  async function loadTimer(){
    setStatus("Загружаю таймер…");
    const cfg = await apiCall(state.teacherBaseUrl, "/teacher/config/get", {
      params: { subject: state.subject },
      token: state.teacherToken
    });
    const minutes = Number(cfg?.timerMinutes ?? cfg?.timer_minutes ?? cfg?.timer ?? 0);
    if($("timerMinutes")) $("timerMinutes").value = Number.isFinite(minutes) ? String(minutes) : "";
    setStatus("Таймер загружен.", "ok");
  }

  async function saveTimer(){
    const minutes = Number(safeText($("timerMinutes")?.value) || 0);
    setStatus("Сохраняю таймер…");
    await apiCall(state.teacherBaseUrl, "/teacher/config/set", {
      method: "POST",
      body: { subject: state.subject, timerMinutes: minutes },
      token: state.teacherToken
    });
    setStatus("Таймер сохранён.", "ok");
  }

  async function makeResetCode(){
    const variant = safeText($("resetVariant")?.value) || safeText(state.manifest?.variants?.[0]?.id) || "variant_01";
    const cls = safeText($("resetClass")?.value);
    const fio = safeText($("resetFio")?.value);
    if(!cls || !fio){
      alert("Заполните класс и ФИО для reset-кода.");
      return;
    }
    setStatus("Делаю reset-код…");
    const data = await apiCall(state.teacherBaseUrl, "/teacher/reset", {
      method: "POST",
      body: { subject: state.subject, variant, cls, fio, createdAt: nowIso() },
      token: state.teacherToken
    });
    const code = data?.code || data?.resetCode || data?.token || "";
    if(code){
      setStatus(`Reset-код: ${code}`, "ok");
      // удобно сразу скопировать
      try{ await navigator.clipboard.writeText(String(code)); }catch{}
      alert(`Reset-код создан:\n\n${code}\n\n(код скопирован в буфер, если браузер разрешил)`);
    }else{
      setStatus("Reset-код создан (ответ без поля code).", "ok");
      $("jsonViewer").value = JSON.stringify(data, null, 2);
    }
  }

  function bind(){
    // theme
    applyTheme(getTheme());
    const t = $("themeToggle");
    if(t && !t._kdBound){
      t._kdBound = true;
      t.addEventListener("click", (e)=>{ e.preventDefault(); toggleTheme(); });
    }
    // allow clicking the whole theme box too
    const themeBox = t?.closest(".kd-theme");
    if(themeBox && !themeBox._kdBound){
      themeBox._kdBound = true;
      themeBox.addEventListener("click", (e)=>{
        if(e.target && e.target.tagName === "INPUT") return;
        toggleTheme();
      });
    }

    // subject select
    const subjSel = $("subjectSelect");
    if(subjSel && !subjSel._kdBound){
      subjSel._kdBound = true;
      subjSel.addEventListener("change", async ()=>{
        state.subject = subjSel.value || "russian";
        await boot(); // reload manifest+list+timer
      });
    }

    // list + filters
    $("btnList")?.addEventListener("click", ()=>loadList());
    ["classFilter","variantFilter","fioSearch"].forEach(id=>{
      const el = $(id);
      if(el && !el._kdBound){
        el._kdBound = true;
        el.addEventListener("input", ()=>renderList());
      }
    });

    $("btnVoidSelected")?.addEventListener("click", ()=>voidSelected());

    // timer
    $("btnTimerLoad")?.addEventListener("click", ()=>loadTimer());
    $("btnTimerSave")?.addEventListener("click", ()=>saveTimer());

    // reset
    $("btnResetMake")?.addEventListener("click", ()=>makeResetCode());

    // table actions (delegation)
    $("resultsTbody")?.addEventListener("click", async (e)=>{
      const btn = e.target?.closest?.("button[data-act]");
      if(!btn) return;
      const tr = e.target?.closest?.("tr[data-key]");
      const key = tr?.dataset?.key || "";
      if(!key) return;

      try{
        if(btn.dataset.act==="get"){
          setStatus("Загружаю результат…");
          const res = await getResult(key);
          $("jsonViewer").value = JSON.stringify(res, null, 2);
          setStatus("Готово.", "ok");
        }
        if(btn.dataset.act==="download"){
          setStatus("Скачиваю JSON…");
          const res = await getResult(key);
          const fio = safeText(res?.student?.name || res?.student?.fio || "");
          const variant = safeText(res?.variant?.id || res?.variantId || "");
          downloadJson(res, `result_${state.subject}_${fio.replace(/\s+/g,"_")}_${variant}_${key.slice(0,16)}.json`);
          setStatus("Скачано.", "ok");
        }
        if(btn.dataset.act==="void"){
          if(!confirm("Аннулировать (void) эту работу?")) return;
          setStatus("Аннулирую…");
          await voidResult(key);
          await loadList();
          setStatus("Void выполнен.", "ok");
        }
        if(btn.dataset.act==="print"){
          const res = await getResult(key);
          openPrintWindow(res);
        }
      }catch(err){
        console.error(err);
        setStatus(`Ошибка: ${err.message}`, "error");
        alert("Ошибка:\n\n" + String(err.message || err));
      }
    });

    // CSV export shortcut: Ctrl+S? (optional) – not added to UI
  }

  async function boot(){
    try{
      setStatus("Загружаю manifest…");
      await loadManifest();
      setStatus("Manifest загружен. Обновляю список…", "ok");
      // seed resetVariant default
      if($("resetVariant") && !$("resetVariant").value){
        $("resetVariant").value = safeText(state.manifest?.variants?.[0]?.id) || "variant_01";
      }
      await loadList();
    }catch(err){
      console.error(err);
      setStatus(`Ошибка запуска: ${err.message}`, "error");
      alert("Ошибка teacher panel:\n\n" + err.message);
    }
  }

  // init
  state.subject = safeText($("subjectSelect")?.value) || "russian";
  bind();
  boot();

})();
