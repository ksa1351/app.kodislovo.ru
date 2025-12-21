(() => {
  "use strict";

  // ====== НАСТРОЙКИ (впиши свои) ======
  const BASE_URL = "https://d5d17sjh01l20fnemocv.3zvepvee.apigw.yandexcloud.net"; // <-- сюда реальный base URL шлюза
  const TEACHER_TOKEN = "42095b52-9d18-423d-a8c2-bfa56e5cd03b1b9d15ca-bbba-49f9-a545-f545b3e16c1f"; // <-- секретный токен учителя (как SUBMIT_TOKEN, но отдельный)

  // ====== UI helpers ======
  const $ = (id) => document.getElementById(id);
  const THEME_KEY = "kodislovo_theme";

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    const t = $("themeToggle");
    if (t) t.checked = theme === "light";
  }
  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  }

  function status(el, msg, kind = "") {
    if (!el) return;
    el.className = "status" + (kind ? " " + kind : "");
    el.textContent = msg || "";
  }

  async function api(path, payload) {
    const url = BASE_URL.replace(/\/+$/,"") + path;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Teacher-Token": TEACHER_TOKEN,
      },
      body: JSON.stringify(payload || {}),
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!r.ok) {
      const m = data?.error || data?.message || text || `HTTP ${r.status}`;
      throw new Error(m);
    }
    return data;
  }

  function safe(s){ return (s ?? "").toString().trim(); }
  function fmtDate(iso){
    if(!iso) return "";
    try{
      const d = new Date(iso);
      return d.toLocaleString("ru-RU");
    }catch{ return iso; }
  }

  // ====== table render ======
  function renderRows(items) {
    const tbody = $("rows");
    if (!tbody) return;
    tbody.innerHTML = "";

    for (const it of (items || [])) {
      const tr = document.createElement("tr");

      const td0 = document.createElement("td");
      td0.innerHTML = `<input class="chk" type="checkbox" data-key="${it.key}">`;
      tr.appendChild(td0);

      const td1 = document.createElement("td");
      td1.innerHTML = `<div><b>${it.fio || ""}</b></div><div class="small">${it.cls || ""}</div>`;
      tr.appendChild(td1);

      const td2 = document.createElement("td");
      td2.textContent = it.variant || "";
      tr.appendChild(td2);

      const td3 = document.createElement("td");
      td3.textContent = fmtDate(it.createdAt || it.ts || it.date);
      tr.appendChild(td3);

      const td4 = document.createElement("td");
      td4.innerHTML = `<div class="k">${it.key}</div>`;
      tr.appendChild(td4);

      const td5 = document.createElement("td");
      td5.className = "actions";
      const bOpen = document.createElement("button");
      bOpen.className = "aBtn";
      bOpen.textContent = "Открыть";
      bOpen.onclick = () => openOne(it.key);

      const bVoid = document.createElement("button");
      bVoid.className = "aBtn danger";
      bVoid.textContent = "Аннулировать";
      bVoid.onclick = () => voidKeys([it.key]);

      td5.appendChild(bOpen);
      td5.appendChild(bVoid);
      tr.appendChild(td5);

      tbody.appendChild(tr);
    }
  }

  function selectedKeys() {
    return Array.from(document.querySelectorAll('input.chk[type="checkbox"]:checked'))
      .map(x => x.getAttribute("data-key"))
      .filter(Boolean);
  }

  // ====== actions ======
  async function refreshList() {
    const right = $("rightStatus");
    status(right, "Загружаю список…");

    const subject = $("subject")?.value || "russian";
    const fCls = safe($("filterClass")?.value);
    const fVar = safe($("filterVariant")?.value);
    const fFio = safe($("filterFio")?.value);

    const data = await api("/teacher/list", {
      subject,
      filter: { cls: fCls || null, variant: fVar || null, fio: fFio || null },
      limit: 200
    });

    renderRows(data.items || []);
    status(right, `Готово: ${data.items?.length || 0} работ`, "ok");
  }

  async function openOne(key) {
    const right = $("rightStatus");
    status(right, "Открываю…");

    const subject = $("subject")?.value || "russian";
    const data = await api("/teacher/get", { subject, key });

    $("jsonView").value = JSON.stringify(data.result || data, null, 2);
    status(right, "Открыто", "ok");
  }

  async function voidKeys(keys) {
    if (!keys || !keys.length) return;

    const right = $("rightStatus");
    status(right, "Аннулирую…");

    const subject = $("subject")?.value || "russian";
    const data = await api("/teacher/void", { subject, keys });

    status(right, `Аннулировано: ${data.voided || keys.length}`, "ok");
    await refreshList();
  }

  async function cfgLoad() {
    const left = $("leftStatus");
    status(left, "Загружаю таймер…");

    const subject = $("subject")?.value || "russian";
    const variant = safe($("variant")?.value) || null;

    const data = await api("/teacher/config/get", { subject, variant });
    $("timerMinutes").value = (data?.minutes ?? 0);

    status(left, "Таймер загружен", "ok");
  }

  async function cfgSave() {
    const left = $("leftStatus");
    status(left, "Сохраняю таймер…");

    const subject = $("subject")?.value || "russian";
    const variant = safe($("variant")?.value) || null;
    const minutes = Number($("timerMinutes")?.value || 0);

    const data = await api("/teacher/config/set", { subject, variant, minutes });
    status(left, `Сохранено. minutes=${data?.minutes ?? minutes}`, "ok");
  }

  async function resetCreate() {
    const left = $("leftStatus");
    status(left, "Создаю reset-код…");

    const subject = $("subject")?.value || "russian";
    const variant = safe($("variant")?.value) || null;
    const fio = safe($("fio")?.value);
    const cls = safe($("cls")?.value);

    if (!fio || !cls) {
      status(left, "Нужно заполнить ФИО и класс для reset-кода.", "bad");
      return;
    }

    const data = await api("/teacher/reset", { subject, variant, fio, cls });

    const code = data.code || data.resetCode || "";
    const hint =
      `Reset-код создан: ${code}\n` +
      `Срок: ${data.ttlMinutes ? data.ttlMinutes + " мин." : "по настройке"}\n\n` +
      `Как использовать:\n` +
      `1) Дай код ученику\n` +
      `2) Ученик вводит код в форме контрольной (мы добавим поле) ИЛИ открывает ссылку:\n` +
      `   .../control/control.html?subject=${encodeURIComponent(subject)}&reset=${encodeURIComponent(code)}\n`;

    status(left, hint, "ok");
  }

  // ===== init =====
  async function init() {
    // theme
    setTheme(getPreferredTheme());
    $("themeToggle")?.addEventListener("change", (e) => setTheme(e.target.checked ? "light" : "dark"));

    // buttons
    $("btnRefresh").onclick = () => refreshList().catch(err => status($("rightStatus"), err.message, "bad"));
    $("btnVoidSelected").onclick = () => voidKeys(selectedKeys()).catch(err => status($("rightStatus"), err.message, "bad"));

    $("btnCfgLoad").onclick = () => cfgLoad().catch(err => status($("leftStatus"), err.message, "bad"));
    $("btnCfgSave").onclick = () => cfgSave().catch(err => status($("leftStatus"), err.message, "bad"));
    $("btnResetCreate").onclick = () => resetCreate().catch(err => status($("leftStatus"), err.message, "bad"));

    // auto refresh
    await refreshList().catch(err => status($("rightStatus"), err.message, "bad"));
  }

  init();
})();
