(() => {
  "use strict";

  // === НАСТРОЙКА: URL API Gateway ===
  const API_BASE = "https://d5d0f59tbhjp00vl8vt4.8wihnuyr.apigw.yandexcloud.net";

  const $ = (id) => document.getElementById(id);
  const rowsEl = $("rows");

  const THEME_KEY = "kodislovo_theme";
  const TOKEN_KEY = "kodislovo_teacher_token";

  function setTheme(t){
    document.documentElement.dataset.theme = t;
    localStorage.setItem(THEME_KEY, t);
  }

  function getToken(){
    return ($("teacherToken").value || "").trim();
  }

  async function api(path, { method="GET", body=null } = {}) {
    const token = getToken();
    if (!token) throw new Error("Не задан токен учителя");

    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Teacher-Token": token
      },
      body: body ? JSON.stringify(body) : null
    });

    if (!res.ok) {
      const txt = await res.text().catch(()=> "");
      throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return await res.text();
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function csvCell(s){
    const v = String(s ?? "");
    if (/[,"\n]/.test(v)) return `"${v.replace(/"/g,'""')}"`;
    return v;
  }

  let lastList = [];

  function renderList(items){
    lastList = items || [];
    rowsEl.innerHTML = "";

    for (const it of lastList) {
      const tr = document.createElement("tr");
      tr.dataset.key = it.key;

      tr.innerHTML = `
        <td><input type="checkbox" class="chk"></td>
        <td class="mono">${escapeHtml(it.createdAt || it.ts || "")}</td>
        <td>${escapeHtml(it.fio || it.studentName || "")}</td>
        <td>${escapeHtml(it.cls || it.studentClass || "")}</td>
        <td>${escapeHtml(it.subject || "")}</td>
        <td class="mono">${escapeHtml(it.variant || it.variantId || "")}</td>
        <td>
          <span class="tag ${it.voided ? "bad" : "ok"}">
            ${it.voided ? "VOID" : (it.percent != null ? `${it.percent}%` : "ok")}
          </span>
        </td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn secondary" data-act="open">Открыть</button>
          <button class="btn danger" data-act="void">VOID</button>
        </td>
      `;

      tr.querySelector('[data-act="open"]').onclick = () => openWork(it.key);
      tr.querySelector('[data-act="void"]').onclick = () => voidWorks([it.key]);

      rowsEl.appendChild(tr);
    }
  }

  function selectedKeys(){
    return Array.from(rowsEl.querySelectorAll("tr"))
      .filter(tr => tr.querySelector(".chk")?.checked)
      .map(tr => tr.dataset.key)
      .filter(Boolean);
  }

  async function loadList(){
    $("apiStatus").textContent = "загрузка…";
    const subject = $("fSubject").value;
    const variant = ($("fVariant").value || "").trim();
    const cls = ($("fClass").value || "").trim();
    const limit = Number($("fLimit").value || 50);

    const data = await api("/teacher/list", {
      method: "POST",
      body: { subject, variant, cls, limit }
    });

    renderList(data.items || []);
    $("apiStatus").textContent = "ok ✅";
  }

  async function openWork(key){
    $("apiStatus").textContent = "чтение…";
    const data = await api("/teacher/get", { method: "POST", body: { key } });

    $("modal").classList.add("open");
    $("modalTitle").textContent = "Работа: " + key;

    const meta = [];
    meta.push(`<span class="pill">ФИО: <b>${escapeHtml(data.student?.name || data.identity?.fio || "")}</b></span>`);
    meta.push(`<span class="pill">Класс: <b>${escapeHtml(data.student?.class || data.identity?.cls || "")}</b></span>`);
    meta.push(`<span class="pill">Предмет: <b>${escapeHtml(data.subject || "")}</b></span>`);
    meta.push(`<span class="pill">Вариант: <b class="mono">${escapeHtml(data.variant?.id || data.variantId || data.meta?.variant || "")}</b></span>`);
    meta.push(`<span class="pill">Итог: <b>${escapeHtml(data.grading?.earnedPoints ?? "")}/${escapeHtml(data.grading?.maxPoints ?? "")}</b> · <b>${escapeHtml(data.grading?.percent ?? "")}%</b> · <b>${escapeHtml(data.grading?.mark ?? "")}</b></span>`);
    $("modalMeta").innerHTML = meta.join("");

    $("modalPre").textContent = JSON.stringify(data, null, 2);
    $("apiStatus").textContent = "ok ✅";
  }

  async function voidWorks(keys){
    if (!keys.length) return alert("Не выбрано ни одной работы");
    if (!confirm(`Аннулировать (VOID) выбранные работы: ${keys.length}?`)) return;

    $("apiStatus").textContent = "void…";
    await api("/teacher/void", { method: "POST", body: { keys } });
    await loadList();
  }

  function exportCsv(){
    if (!lastList.length) return alert("Список пуст");

    const header = ["createdAt","fio","cls","subject","variant","percent","mark","key","voided"];
    const lines = [header.join(",")];

    for (const it of lastList) {
      const row = [
        it.createdAt || "",
        it.fio || "",
        it.cls || "",
        it.subject || "",
        it.variant || "",
        it.percent ?? "",
        it.mark ?? "",
        it.key || "",
        it.voided ? "1" : "0"
      ].map(csvCell);
      lines.push(row.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kodislovo_results_${$("fSubject").value}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  async function cfgLoad(){
    $("apiStatus").textContent = "config…";
    const subject = $("cfgSubject").value;
    const variant = ($("cfgVariant").value || "").trim();

    const data = await api("/teacher/config/get", { method: "POST", body: { subject, variant } });
    $("cfgTimer").value = Number(data?.time_limit_minutes || 0);
    $("apiStatus").textContent = "ok ✅";
  }

  async function cfgSave(){
    $("apiStatus").textContent = "config save…";
    const subject = $("cfgSubject").value;
    const variant = ($("cfgVariant").value || "").trim();
    const time_limit_minutes = Math.max(0, Number($("cfgTimer").value || 0));

    await api("/teacher/config/set", {
      method: "POST",
      body: { subject, variant, time_limit_minutes }
    });
    $("apiStatus").textContent = "сохранено ✅";
  }

  async function makeReset(){
    const fio = ($("rFio").value || "").trim();
    const cls = ($("rClass").value || "").trim();
    const variant = ($("rVariant").value || "").trim();
    const subject = $("cfgSubject").value;

    if (!fio || !cls || !variant) return alert("Заполни ФИО, класс и вариант");

    $("apiStatus").textContent = "reset…";
    const data = await api("/teacher/reset", {
      method: "POST",
      body: { subject, fio, cls, variant }
    });

    $("resetOut").innerHTML = `
      <div class="pill">Код сброса: <b class="mono">${escapeHtml(data.code || "")}</b></div>
      <div class="pill">Действует до: <b class="mono">${escapeHtml(data.expiresAt || "")}</b></div>
    `;
    $("apiStatus").textContent = "ok ✅";
  }

  function init(){
    $("apiUrl").textContent = API_BASE;

    // theme
    const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
    $("themeSel").value = savedTheme;
    setTheme(savedTheme);
    $("themeSel").onchange = () => setTheme($("themeSel").value);

    // token remember
    $("teacherToken").value = localStorage.getItem(TOKEN_KEY) || "";
    $("teacherToken").addEventListener("input", () => {
      localStorage.setItem(TOKEN_KEY, $("teacherToken").value);
    });

    $("btnList").onclick = () => loadList().catch(e => alert(e.message));
    $("btnExportCsv").onclick = exportCsv;
    $("btnVoidSelected").onclick = () => voidWorks(selectedKeys()).catch(e => alert(e.message));

    $("chkAll").onchange = (e) => {
      const on = e.target.checked;
      rowsEl.querySelectorAll(".chk").forEach(ch => ch.checked = on);
    };

    $("btnCfgLoad").onclick = () => cfgLoad().catch(e => alert(e.message));
    $("btnCfgSave").onclick = () => cfgSave().catch(e => alert(e.message));
    $("btnReset").onclick = () => makeReset().catch(e => alert(e.message));

    $("modalClose").onclick = () => $("modal").classList.remove("open");
    $("modal").onclick = (e) => { if (e.target.id === "modal") $("modal").classList.remove("open"); };
  }

  init();
})();

