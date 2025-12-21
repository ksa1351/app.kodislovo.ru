/* teacher/teacher.js
   Kodislovo — Teacher Panel (front-end)
   Совместим с твоим teacher/index.html (id: subject, variant, btnCfgLoad, btnRefresh, rows, jsonView и т.д.)
   Работает с Teacher API (Yandex API Gateway + Cloud Function).
*/

(function () {
  "use strict";

  // ====== CONFIG ======
  // Можно переопределить до подключения скрипта:
  // window.KODISLOVO_TEACHER = { base_url: "...", token: "..." }
  const CFG = Object.assign(
    {
      base_url: "https://d5d17sjh01l20fnemocv.3zvepvee.apigw.yandexcloud.net",
      token:
        "42095b52-9d18-423d-a8c2-bfa56e5cd03b1b9d15ca-bbba-49f9-a545-f545b3e16c1f",
    },
    window.KODISLOVO_TEACHER || {}
  );

  const THEME_KEY = "kodislovo_theme";

  const $ = (id) => document.getElementById(id);

  // ====== UI (ids как в твоём HTML) ======
  const ui = {
    // theme
    themeToggle: $("themeToggle"), // checkbox (для ползунка)
    themeWrap: document.querySelector(".toggle"), // кликаем сюда

    // left panel
    subject: $("subject"),
    variant: $("variant"),
    timerMinutes: $("timerMinutes"),
    cls: $("cls"),
    fio: $("fio"),
    btnCfgLoad: $("btnCfgLoad"),
    btnCfgSave: $("btnCfgSave"),
    btnResetCreate: $("btnResetCreate"),
    leftStatus: $("leftStatus"),

    // right panel
    btnRefresh: $("btnRefresh"),
    btnVoidSelected: $("btnVoidSelected"),
    filterClass: $("filterClass"),
    filterVariant: $("filterVariant"),
    filterFio: $("filterFio"),
    rows: $("rows"),
    rightStatus: $("rightStatus"),
    jsonView: $("jsonView"),
  };

  function safeText(v) {
    return String(v ?? "").trim();
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(where, msg, bad = false) {
    const el = where === "left" ? ui.leftStatus : ui.rightStatus;
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("ok", "bad");
    if (bad) el.classList.add("bad");
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ru-RU");
  }

  // ====== THEME ======
  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    const prefersLight =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);

    // чекбокс используем только для положения ползунка
    if (ui.themeToggle) ui.themeToggle.checked = theme === "light";
  }

  function toggleTheme() {
    const cur =
      document.documentElement.getAttribute("data-theme") ||
      document.documentElement.dataset.theme ||
      "dark";
    applyTheme(cur === "light" ? "dark" : "light");
  }

  // ====== API ======
  async function api(path, payload) {
    const url = CFG.base_url.replace(/\/+$/, "") + path;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Teacher-Token": CFG.token,
      },
      body: JSON.stringify(payload || {}),
    });

    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      const msg = data?.message || data?.error || text || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function downloadText(filename, text, mime = "application/json;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  // ====== DATA ======
  let allItems = [];
  let opened = null;

  function getCurrentSubject() {
    return safeText(ui.subject?.value) || "russian";
  }

  function getCurrentVariant() {
    return safeText(ui.variant?.value) || "";
  }

  // ====== LEFT: timer + reset ======
  async function loadTimer() {
    const subject = getCurrentSubject();
    const variant = getCurrentVariant();
    setStatus("left", "Загружаю таймер…");
    const data = await api("/teacher/config/get", { subject, variant });
    const min = Number(data?.time_limit_minutes || 0);
    if (ui.timerMinutes) ui.timerMinutes.value = String(min || 0);
    setStatus(
      "left",
      min > 0 ? `Таймер загружен: ${min} мин.` : "Таймер загружен: без лимита"
    );
  }

  async function saveTimer() {
    const subject = getCurrentSubject();
    const variant = getCurrentVariant();
    const time_limit_minutes = Math.max(
      0,
      Number(ui.timerMinutes?.value || 0)
    );

    setStatus("left", "Сохраняю таймер…");
    await api("/teacher/config/set", { subject, variant, time_limit_minutes });
    setStatus(
      "left",
      time_limit_minutes > 0
        ? `Таймер сохранён: ${time_limit_minutes} мин.`
        : "Таймер сохранён: без лимита"
    );
  }

  async function createResetCode() {
    const subject = getCurrentSubject();
    const variant = getCurrentVariant();
    const cls = safeText(ui.cls?.value);
    const fio = safeText(ui.fio?.value);

    if (!variant) {
      alert("Укажите вариант (например: variant_01).");
      return;
    }
    if (!cls || !fio) {
      alert("Для reset-кода заполните Класс и ФИО.");
      return;
    }

    setStatus("left", "Создаю reset-код…");
    const data = await api("/teacher/reset", { subject, variant, cls, fio });

    const code = data?.code || "";
    const exp = data?.expiresAt ? formatDate(data.expiresAt) : "";
    setStatus(
      "left",
      code ? `Reset-код: ${code}${exp ? ` (до ${exp})` : ""}` : "Не удалось создать reset-код",
      !code
    );
  }

  // ====== RIGHT: list / get / void / delete ======
  async function refreshList() {
    const subject = getCurrentSubject();
    const variant = getCurrentVariant(); // может быть пусто → сервер вернёт по prefix results/
    const clsFilter = safeText(ui.filterClass?.value);

    setStatus("right", "Загружаю список…");
    const data = await api("/teacher/list", {
      variant: variant || "",
      cls: clsFilter || "",
      limit: 200,
    });

    allItems = Array.isArray(data?.items) ? data.items : [];
    renderRows();
    setStatus("right", `Готово. Работ: ${allItems.length}`);
  }

  function passClientFilters(it) {
    const cls = safeText(ui.filterClass?.value).toLowerCase();
    const v = safeText(ui.filterVariant?.value).toLowerCase();
    const fio = safeText(ui.filterFio?.value).toLowerCase();

    const itCls = safeText(it.cls).toLowerCase();
    const itVar = safeText(it.variant).toLowerCase();
    const itFio = safeText(it.fio).toLowerCase();

    if (cls && itCls !== cls) return false;
    if (v && !itVar.includes(v)) return false;
    if (fio && !itFio.includes(fio)) return false;
    return true;
  }

  function renderRows() {
    if (!ui.rows) return;
    ui.rows.innerHTML = "";

    const shown = allItems.filter(passClientFilters);

    for (let i = 0; i < shown.length; i++) {
      const it = shown[i];
      const tr = document.createElement("tr");
      if (it.voided) tr.style.opacity = "0.55";

      tr.innerHTML = `
        <td style="width:42px"><input class="chk" type="checkbox" data-k="${escapeHtml(
          it.key
        )}"></td>

        <td>
          ${escapeHtml(it.fio || "")}
          ${
            it.cls
              ? `<div class="small">${escapeHtml(it.cls)}</div>`
              : ""
          }
        </td>

        <td>${escapeHtml(it.variant || "")}</td>
        <td>${escapeHtml(formatDate(it.createdAt || ""))}</td>
        <td class="k">${escapeHtml(it.key || "")}</td>

        <td>
          <div class="actions" style="justify-content:flex-end">
            <button class="aBtn" data-act="open" data-k="${escapeHtml(
              it.key
            )}">Открыть</button>
            <button class="aBtn" data-act="download" data-k="${escapeHtml(
              it.key
            )}">Скачать</button>
            <button class="aBtn" data-act="void" data-k="${escapeHtml(
              it.key
            )}">${it.voided ? "Скрыто" : "Скрыть"}</button>
            <button class="aBtn danger" data-act="delete" data-k="${escapeHtml(
              it.key
            )}">Удалить</button>
          </div>
        </td>
      `;

      ui.rows.appendChild(tr);
    }

    ui.rows.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        const key = btn.getAttribute("data-k");
        if (!key) return;

        try {
          if (act === "open") await openKey(key);
          if (act === "download") await downloadKey(key);
          if (act === "void") await voidKey(key);
          if (act === "delete") await deleteKey(key);
        } catch (e) {
          console.error(e);
          alert(String(e.message || e));
          setStatus("right", String(e.message || e), true);
        }
      });
    });
  }

  async function openKey(key) {
    setStatus("right", "Загружаю JSON…");
    const data = await api("/teacher/get", { key });
    opened = data;
    if (ui.jsonView) ui.jsonView.value = JSON.stringify(data, null, 2);
    setStatus("right", "JSON загружен.");
  }

  async function downloadKey(key) {
    // берём сам JSON чтобы нормально назвать файл
    let data = null;
    try {
      data = await api("/teacher/get", { key });
    } catch {
      data = { key };
    }

    const subject = safeText(data?.subject || getCurrentSubject());
    const vid = safeText(data?.variant?.id || data?.variantId || "");
    const cls = safeText(data?.student?.class || data?.identity?.cls || "")
      .replace(/\s+/g, "_")
      .slice(0, 40);
    const fio = safeText(data?.student?.name || data?.identity?.fio || "")
      .replace(/\s+/g, "_")
      .slice(0, 60);

    const fn = `result_${subject}_${vid || "variant"}_${cls || "class"}_${
      fio || "student"
    }.json`;

    downloadText(fn, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
  }

  async function voidKey(key) {
    if (!confirm("Скрыть работу (void)?")) return;
    await api("/teacher/void", { keys: [key] });
    setStatus("right", "Готово: работа скрыта.");
    await refreshList();
  }

  async function deleteKey(key) {
    // Если на бэке есть /teacher/delete — используем,
    // иначе fallback: void (не ломаем рабочий механизм)
    if (!confirm("Удалить работу? Если удаление недоступно — будет выполнено скрытие (void)."))
      return;

    try {
      await api("/teacher/delete", { keys: [key] });
      setStatus("right", "Удалено.");
    } catch (e) {
      console.warn("delete not available, fallback to void:", e);
      await api("/teacher/void", { keys: [key] });
      setStatus("right", "Удаление недоступно — выполнено скрытие (void).");
    }

    await refreshList();
  }

  async function voidSelected() {
    if (!ui.rows) return;
    const keys = Array.from(ui.rows.querySelectorAll('input[type="checkbox"][data-k]:checked'))
      .map((x) => x.getAttribute("data-k"))
      .filter(Boolean);

    if (!keys.length) {
      alert("Ничего не выбрано.");
      return;
    }
    if (!confirm(`Скрыть выбранные работы (${keys.length})?`)) return;

    setStatus("right", "Скрываю выбранные…");
    await api("/teacher/void", { keys });
    setStatus("right", "Готово: выбранные скрыты.");
    await refreshList();
  }

  // ====== BIND ======
  function bind() {
    // theme: переключение по клику (без “управления” чекбоксом)
    applyTheme(getPreferredTheme());

    if (ui.themeWrap) {
      ui.themeWrap.style.cursor = "pointer";
      ui.themeWrap.addEventListener("click", (e) => {
        e.preventDefault();
        toggleTheme();
      });
    }
    // страховка: если кто-то кликнул по самому input
    ui.themeToggle?.addEventListener("change", (e) => {
      // приводим к режиму “по клику”
      applyTheme(e.target.checked ? "light" : "dark");
    });

    ui.btnCfgLoad?.addEventListener("click", () => loadTimer().catch(onErr("left")));
    ui.btnCfgSave?.addEventListener("click", () => saveTimer().catch(onErr("left")));
    ui.btnResetCreate?.addEventListener("click", () => createResetCode().catch(onErr("left")));

    ui.btnRefresh?.addEventListener("click", () => refreshList().catch(onErr("right")));
    ui.btnVoidSelected?.addEventListener("click", () => voidSelected().catch(onErr("right")));

    // перерисовка по фильтрам (клиентские)
    ui.filterVariant?.addEventListener("input", () => renderRows());
    ui.filterFio?.addEventListener("input", () => renderRows());
    ui.filterClass?.addEventListener("input", () => {
      // этот фильтр влияет и на серверный list (cls), но пересерверный запрос делаем по кнопке "Обновить"
      renderRows();
    });
  }

  function onErr(where) {
    return (e) => {
      console.error(e);
      setStatus(where, String(e.message || e), true);
      alert(String(e.message || e));
    };
  }

  bind();
})();
