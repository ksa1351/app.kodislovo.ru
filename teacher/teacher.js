/* teacher/teacher.js
   Kodislovo — Teacher Panel (front-end)
   Работает с Teacher API (Yandex API Gateway + Cloud Function) и общими стилями /assets/css/control-ui.css

   ✅ Список работ (list)
   ✅ Просмотр JSON (get)
   ✅ Скачать JSON (download)
   ✅ “Удалить”:
      - если в API есть /teacher/delete → удалит физически
      - иначе fallback: /teacher/void (скрыть/пометить как удалённое)
   ✅ CSV выгрузка
   ✅ PDF (вариант + ответы ученика) через печать (window.print)
   ✅ Автопроверка ключом:
      - ключ загрузить с компьютера (JSON)
      - или ключ лежит в бакете (через teacher/get по ключу бакета)
*/

(function () {
  "use strict";

  // ===== CONFIG (можно переопределить до подключения скрипта через window.KODISLOVO_TEACHER = {...}) =====
  const DEFAULTS = {
    base_url: "https://d5d17sjh01l20fnemocv.3zvepvee.apigw.yandexcloud.net",
    token: "42095b52-9d18-423d-a8c2-bfa56e5cd03b1b9d15ca-bbba-49f9-a545-f545b3e16c1f",
    // controls лежит в корне сайта, teacher/ рядом → берём относительный путь
    controls_root: "../controls", // ../controls/<subject>/variants/<file>
  };

  const CFG = Object.assign({}, DEFAULTS, window.KODISLOVO_TEACHER || {});

  // ===== helpers =====
  const THEME_KEY = "kodislovo_theme";
  const $ = (id) => document.getElementById(id);

  function getHeaderCaseInsensitive(headers, name) {
    if (!headers) return "";
    const lower = name.toLowerCase();
    for (const k of Object.keys(headers)) {
      if (String(k).toLowerCase() === lower) return headers[k];
    }
    return "";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeText(s) {
    return String(s ?? "").trim();
  }

  function normalizeAnswer(s) {
    return safeText(s)
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ru-RU");
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);

    const label = $("themeLabel");
    if (label) label.textContent = theme === "light" ? "Светлая" : "Тёмная";
  }

  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "light" ? "dark" : "light");
  }

  function controlsVariantUrl(subject, file) {
    // teacher/index.html → ../controls/<subject>/variants/<file>
    return new URL(`${CFG.controls_root}/${encodeURIComponent(subject)}/variants/${file}`, window.location.href).toString();
  }

  async function fetchJson(url, opts = {}) {
    const r = await fetch(url, Object.assign({ cache: "no-store" }, opts));
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
    if (!r.ok) {
      const msg = data?.message || data?.error || txt || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

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
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!r.ok) {
      const msg = data?.message || data?.error || (text || `HTTP ${r.status}`);
      throw new Error(msg);
    }
    return data;
  }

  function downloadBlob(filename, blob) {
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

  function toCsv(rows) {
    const esc = (v) => {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = rows.map((r) => r.map(esc).join(","));
    return lines.join("\n");
  }

  // ===== state =====
  let currentSubject = "russian";
  let currentVariant = "variant_01";
  let currentItems = [];  // list items from API
  let openedJson = null;  // currently viewed result JSON
  let keyJson = null;     // answer key JSON (for auto-check)
  let manifestCache = new Map(); // subject -> manifest

  // ===== UI refs =====
  const ui = {
    subject: $("tSubject"),
    variant: $("tVariant"),
    cls: $("tClass"),
    fio: $("tFio"),
    timeMin: $("tTimeMin"),
    btnLoadTimer: $("btnLoadTimer"),
    btnSaveTimer: $("btnSaveTimer"),
    btnResetCode: $("btnMakeReset"),
    resetOut: $("resetOut"),

    btnList: $("btnList"),
    status: $("tStatus"),

    tableBody: $("tBody"),
    count: $("tCount"),

    jsonBox: $("jsonBox"),
    btnDownloadJson: $("btnDownloadJson"),
    btnVoid: $("btnVoid"),
    btnDelete: $("btnDelete"),

    btnCsv: $("btnCsv"),
    btnPdf: $("btnPdf"),

    keyFile: $("keyFile"),
    keyS3Key: $("keyS3Key"),
    btnLoadKeyFromS3: $("btnLoadKeyFromS3"),
    btnClearKey: $("btnClearKey"),
    keyStatus: $("keyStatus"),
    btnAutoCheck: $("btnAutoCheck"),
  };

  function setStatus(msg, isBad = false) {
    if (!ui.status) return;
    ui.status.textContent = msg;
    ui.status.style.color = isBad ? "var(--bad)" : "var(--muted)";
  }

  // ===== teacher actions =====
  async function loadTimer() {
    const subject = safeText(ui.subject?.value) || currentSubject;
    const variant = safeText(ui.variant?.value) || currentVariant;
    const data = await api("/teacher/config/get", { subject, variant });
    const min = Number(data?.time_limit_minutes || 0);
    if (ui.timeMin) ui.timeMin.value = String(min || 0);
    setStatus(min > 0 ? `Таймер загружен: ${min} мин.` : "Таймер загружен: без лимита");
  }

  async function saveTimer() {
    const subject = safeText(ui.subject?.value) || currentSubject;
    const variant = safeText(ui.variant?.value) || currentVariant;
    const time_limit_minutes = Math.max(0, Number(ui.timeMin?.value || 0));
    await api("/teacher/config/set", { subject, variant, time_limit_minutes });
    setStatus(time_limit_minutes > 0 ? `Таймер сохранён: ${time_limit_minutes} мин.` : "Таймер сохранён: без лимита");
  }

  async function makeReset() {
    const subject = safeText(ui.subject?.value) || currentSubject;
    const variant = safeText(ui.variant?.value) || currentVariant;
    const cls = safeText(ui.cls?.value);
    const fio = safeText(ui.fio?.value);

    if (!cls || !fio) {
      alert("Для reset-кода заполните Класс и ФИО.");
      return;
    }

    const data = await api("/teacher/reset", { subject, variant, cls, fio });
    const code = data?.code || "";
    const exp = data?.expiresAt ? formatDate(data.expiresAt) : "";
    if (ui.resetOut) ui.resetOut.value = code ? `${code}${exp ? ` (до ${exp})` : ""}` : "";
    setStatus(code ? "Reset-код создан." : "Reset-код не создан.", !code);
  }

  async function listResults() {
    const subject = safeText(ui.subject?.value) || currentSubject;
    const variant = safeText(ui.variant?.value) || currentVariant;
    const cls = safeText(ui.cls?.value);

    currentSubject = subject;
    currentVariant = variant;

    setStatus("Загружаю список…");
    const data = await api("/teacher/list", {
      variant,
      cls: cls || "",
      limit: 200,
    });

    currentItems = Array.isArray(data?.items) ? data.items : [];
    renderTable();
    setStatus(`Загружено: ${currentItems.length}`);
  }

  function renderTable() {
    if (!ui.tableBody) return;
    ui.tableBody.innerHTML = "";

    if (ui.count) ui.count.textContent = String(currentItems.length);

    currentItems.forEach((it, idx) => {
      const tr = document.createElement("tr");
      tr.className = "kd-tr";

      const fio = escapeHtml(it.fio || "");
      const cls = escapeHtml(it.cls || "");
      const variant = escapeHtml(it.variant || "");
      const date = escapeHtml(formatDate(it.createdAt || ""));
      const key = escapeHtml(it.key || "");
      const voided = !!it.voided;

      tr.innerHTML = `
        <td>${fio}${cls ? `<div class="muted">${cls}</div>` : ""}</td>
        <td>${variant}</td>
        <td>${date}</td>
        <td class="muted" style="word-break:break-all">${key}</td>
        <td>
          <div class="kd-row" style="gap:8px; justify-content:flex-end;">
            <button class="kd-btn secondary" data-act="open" data-idx="${idx}" type="button">Открыть</button>
            <button class="kd-btn secondary" data-act="download" data-idx="${idx}" type="button">Скачать</button>
            <button class="kd-btn secondary" data-act="void" data-idx="${idx}" type="button">${voided ? "Скрыто" : "Скрыть"}</button>
            <button class="kd-btn secondary" data-act="delete" data-idx="${idx}" type="button">Удалить</button>
          </div>
        </td>
      `;

      if (voided) {
        tr.style.opacity = "0.55";
      }

      ui.tableBody.appendChild(tr);
    });

    ui.tableBody.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        const idx = Number(btn.getAttribute("data-idx") || "0");
        const item = currentItems[idx];
        if (!item) return;

        try {
          if (act === "open") await openItem(item);
          if (act === "download") await downloadItem(item);
          if (act === "void") await voidItem(item);
          if (act === "delete") await deleteItem(item);
        } catch (e) {
          console.error(e);
          alert(String(e.message || e));
        }
      });
    });
  }

  async function openItem(item) {
    setStatus("Загружаю JSON…");
    const data = await api("/teacher/get", { key: item.key });
    openedJson = data;

    if (ui.jsonBox) {
      ui.jsonBox.value = JSON.stringify(data, null, 2);
    }

    // enable buttons
    if (ui.btnDownloadJson) ui.btnDownloadJson.disabled = false;
    if (ui.btnPdf) ui.btnPdf.disabled = false;
    if (ui.btnAutoCheck) ui.btnAutoCheck.disabled = !keyJson;

    setStatus("JSON загружен.");
  }

  async function downloadItem(item) {
    // сначала попробуем получить json (чтобы имя было норм)
    let data = null;
    try { data = await api("/teacher/get", { key: item.key }); } catch {}
    const cls = safeText(data?.student?.class || item.cls || "class").replace(/\s+/g, "_");
    const fio = safeText(data?.student?.name || item.fio || "student").replace(/\s+/g, "_");
    const vid = safeText(data?.variant?.id || item.variant || "variant");
    const fn = `result_${currentSubject}_${vid}_${cls}_${fio}.json`;

    const blob = new Blob([JSON.stringify(data || { key: item.key }, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(fn, blob);
  }

  async function voidItem(item) {
    if (item.voided) return;
    if (!confirm("Скрыть работу (пометить как void)? Она не удалится физически, но исчезнет из проверки.")) return;
    await api("/teacher/void", { keys: [item.key] });
    setStatus("Работа помечена как скрытая.");
    await listResults();
  }

  async function deleteItem(item) {
    // Попытка “жёсткого” удаления, если в функции добавлен endpoint /teacher/delete.
    // Если нет — fallback: void.
    if (!confirm("Удалить работу? Если endpoint /teacher/delete не настроен, будет выполнено скрытие (void).")) return;

    try {
      await api("/teacher/delete", { keys: [item.key] }); // может отсутствовать
      setStatus("Работа удалена.");
    } catch (e) {
      // fallback
      console.warn("Hard delete failed, fallback to void:", e);
      await api("/teacher/void", { keys: [item.key] });
      setStatus("Удаление недоступно — выполнено скрытие (void).");
    }

    await listResults();
  }

  // ===== CSV =====
  function exportCsv() {
    const rows = [];
    rows.push(["fio", "class", "subject", "variant", "createdAt", "percent", "mark", "key", "voided"]);
    for (const it of currentItems) {
      rows.push([
        it.fio || "",
        it.cls || "",
        it.subject || currentSubject,
        it.variant || "",
        it.createdAt || "",
        it.percent ?? "",
        it.mark ?? "",
        it.key || "",
        it.voided ? "1" : "0",
      ]);
    }
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(`kodislovo_${currentSubject}_${currentVariant}_results.csv`, blob);
  }

  // ===== PDF (печать) =====
  async function getManifest(subject) {
    if (manifestCache.has(subject)) return manifestCache.get(subject);
    const url = new URL(`${CFG.controls_root}/${encodeURIComponent(subject)}/variants/manifest.json`, window.location.href).toString();
    const mf = await fetchJson(url);
    manifestCache.set(subject, mf);
    return mf;
  }

  async function getVariantJson(subject, variantId) {
    const mf = await getManifest(subject);
    const v = (mf.variants || []).find(x => x.id === variantId) || (mf.variants || [])[0];
    if (!v) throw new Error("В manifest.json нет variants");
    const url = controlsVariantUrl(subject, v.file);
    return await fetchJson(url);
  }

  function buildPrintableHtml(resultJson, variantJson, gradeInfo = null) {
    const studentName = escapeHtml(resultJson?.student?.name || "");
    const studentClass = escapeHtml(resultJson?.student?.class || "");
    const title = escapeHtml(resultJson?.variant?.title || variantJson?.meta?.title || "Контрольная");
    const subtitle = escapeHtml(resultJson?.variant?.subtitle || variantJson?.meta?.subtitle || "");
    const createdAt = escapeHtml(formatDate(resultJson?.finishedAt || resultJson?.createdAt || ""));

    const answers = resultJson?.answers || {};
    const tasks = variantJson?.tasks || [];

    const taskHtml = tasks.map((t) => {
      const id = String(t.id);
      const q = t.text || "";
      const hint = t.hint || "";
      const student = answers[id] ?? "";

      let checkLine = "";
      if (gradeInfo && gradeInfo.perTask) {
        const pt = gradeInfo.perTask.find(x => String(x.id) === id);
        if (pt) {
          checkLine = `
            <div style="margin-top:6px; font-size:13px;">
              <b>${pt.ok ? "✅ Верно" : "❌ Неверно"}</b>
              <span style="color:#666;">(${pt.earned}/${pt.max})</span>
              ${pt.ok ? "" : `<div style="color:#666;margin-top:2px;">Ключ: ${escapeHtml((pt.accepted || []).join(" | "))}</div>`}
            </div>
          `;
        }
      }

      return `
        <div style="border:1px solid #ddd; border-radius:12px; padding:12px; margin:10px 0;">
          <div style="font-weight:700;">Задание ${escapeHtml(id)}</div>
          ${hint ? `<div style="color:#666;font-size:13px;margin-top:4px;">${escapeHtml(hint)}</div>` : ""}
          <div style="margin-top:8px; white-space:pre-wrap;">${q}</div>
          <div style="margin-top:10px;"><b>Ответ ученика:</b> ${escapeHtml(student)}</div>
          ${checkLine}
        </div>
      `;
    }).join("\n");

    const gradeBlock = gradeInfo
      ? `<div style="margin:10px 0; padding:10px; border-radius:10px; background:#f6f7ff; border:1px solid #dde;">
          <b>Автопроверка:</b> ${gradeInfo.earned}/${gradeInfo.max} (${gradeInfo.percent}%)
        </div>`
      : "";

    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Печать — ${title}</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:24px;color:#111}
  h1{margin:0 0 6px 0}
  .muted{color:#666}
  .row{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0}
  .pill{border:1px solid #ddd;border-radius:999px;padding:6px 10px;font-size:13px}
  @media print{ body{margin:0} }
</style>
</head>
<body>
  <h1>${title}</h1>
  ${subtitle ? `<div class="muted">${subtitle}</div>` : ""}
  <div class="row">
    <div class="pill"><b>ФИО:</b> ${studentName}</div>
    <div class="pill"><b>Класс:</b> ${studentClass}</div>
    <div class="pill"><b>Дата:</b> ${createdAt}</div>
    <div class="pill"><b>Вариант:</b> ${escapeHtml(resultJson?.variant?.id || "")}</div>
  </div>
  ${gradeBlock}
  <hr>
  ${taskHtml}
</body>
</html>`;
  }

  async function exportPdf() {
    if (!openedJson) {
      alert("Сначала откройте работу (кнопка «Открыть»).");
      return;
    }
    const subject = safeText(openedJson?.subject || currentSubject) || currentSubject;
    const variantId = safeText(openedJson?.variant?.id || openedJson?.variantId || currentVariant) || currentVariant;

    const variantJson = await getVariantJson(subject, variantId);

    // если есть keyJson — добавим автопроверку в PDF
    const gradeInfo = keyJson ? autoGrade(openedJson, keyJson) : null;

    const html = buildPrintableHtml(openedJson, variantJson, gradeInfo);

    const w = window.open("", "_blank");
    if (!w) {
      alert("Браузер заблокировал всплывающее окно. Разрешите pop-up для печати PDF.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();

    setTimeout(() => {
      try { w.print(); } catch {}
    }, 300);
  }

  // ===== Autograde =====
  function buildKeyIndex(key) {
    // Ожидаем формат ключа:
    // { subject:"russian", variantId:"variant_01", answers: { "1":["в"], "2":["поэтому"] ... } }
    // или: { answers: { "1": ["..."] } }
    const ans = key?.answers || key?.key || key?.accepted || null;
    if (!ans || typeof ans !== "object") return null;
    return ans;
  }

  function autoGrade(resultJson, key) {
    const idx = buildKeyIndex(key);
    if (!idx) throw new Error("Ключ не распознан (нет объекта answers).");

    const answers = resultJson?.answers || {};
    let earned = 0;
    let max = 0;
    const perTask = [];

    // если есть variant JSON с points — можно расширить, но здесь 1 балл по умолчанию
    const ids = Object.keys(idx);

    for (const id of ids) {
      const accepted = Array.isArray(idx[id]) ? idx[id] : [idx[id]];
      const pts = 1;
      max += pts;

      const studentRaw = answers[id] ?? "";
      const a = normalizeAnswer(studentRaw);
      const ok = accepted.map(normalizeAnswer).includes(a) && a.length > 0;
      earned += ok ? pts : 0;

      perTask.push({
        id,
        ok,
        earned: ok ? pts : 0,
        max: pts,
        student: safeText(studentRaw),
        accepted: accepted.slice(0),
      });
    }

    const percent = max ? Math.round((earned / max) * 100) : 0;
    return { earned, max, percent, perTask };
  }

  function setKeyStatus(msg, bad = false) {
    if (!ui.keyStatus) return;
    ui.keyStatus.textContent = msg;
    ui.keyStatus.style.color = bad ? "var(--bad)" : "var(--muted)";
  }

  async function loadKeyFromLocal(file) {
    const text = await file.text();
    const json = JSON.parse(text);
    keyJson = json;
    setKeyStatus("Ключ загружен (локально).");
    if (ui.btnAutoCheck) ui.btnAutoCheck.disabled = !openedJson;
  }

  async function loadKeyFromS3() {
    const s3key = safeText(ui.keyS3Key?.value);
    if (!s3key) {
      alert("Укажите S3 key (например: keys/russian/variant_01.json)");
      return;
    }
    const json = await api("/teacher/get", { key: s3key });
    keyJson = json;
    setKeyStatus("Ключ загружен (из бакета).");
    if (ui.btnAutoCheck) ui.btnAutoCheck.disabled = !openedJson;
  }

  function clearKey() {
    keyJson = null;
    setKeyStatus("Ключ не загружен.");
    if (ui.btnAutoCheck) ui.btnAutoCheck.disabled = true;
  }

  function runAutoCheck() {
    if (!openedJson) {
      alert("Сначала откройте работу.");
      return;
    }
    if (!keyJson) {
      alert("Сначала загрузите ключ.");
      return;
    }
    const g = autoGrade(openedJson, keyJson);

    // подсветим в jsonBox (добавим блок grading)
    const cloned = JSON.parse(JSON.stringify(openedJson));
    cloned.autograding = {
      earned: g.earned,
      max: g.max,
      percent: g.percent,
      perTask: g.perTask,
      checkedAt: new Date().toISOString(),
    };
    if (ui.jsonBox) ui.jsonBox.value = JSON.stringify(cloned, null, 2);

    alert(`Автопроверка: ${g.earned}/${g.max} (${g.percent}%).`);
  }

  // ===== open JSON buttons =====
  function downloadOpenedJson() {
    if (!openedJson) return;
    const cls = safeText(openedJson?.student?.class || "class").replace(/\s+/g, "_");
    const fio = safeText(openedJson?.student?.name || "student").replace(/\s+/g, "_");
    const vid = safeText(openedJson?.variant?.id || openedJson?.variantId || currentVariant);
    const fn = `result_${currentSubject}_${vid}_${cls}_${fio}.json`;
    const blob = new Blob([JSON.stringify(openedJson, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(fn, blob);
  }

  // ===== init =====
  function bind() {
    // theme: одним нажатием (не чекбокс)
    setTheme(getPreferredTheme());
    const themeBtn = $("themeBtn"); // если есть
    const themeWrap = $("themeWrap"); // если есть
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
    else if (themeWrap) themeWrap.addEventListener("click", toggleTheme);
    else {
      // fallback: кликаем по label если есть
      $("themeLabel")?.addEventListener("click", toggleTheme);
    }

    ui.btnLoadTimer?.addEventListener("click", () => loadTimer().catch(errHandler));
    ui.btnSaveTimer?.addEventListener("click", () => saveTimer().catch(errHandler));
    ui.btnResetCode?.addEventListener("click", () => makeReset().catch(errHandler));

    ui.btnList?.addEventListener("click", () => listResults().catch(errHandler));

    ui.btnDownloadJson?.addEventListener("click", downloadOpenedJson);

    ui.btnCsv?.addEventListener("click", exportCsv);
    ui.btnPdf?.addEventListener("click", () => exportPdf().catch(errHandler));

    // ключ
    ui.keyFile?.addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { await loadKeyFromLocal(f); } catch (e2) { errHandler(e2); }
      e.target.value = "";
    });
    ui.btnLoadKeyFromS3?.addEventListener("click", () => loadKeyFromS3().catch(errHandler));
    ui.btnClearKey?.addEventListener("click", clearKey);
    ui.btnAutoCheck?.addEventListener("click", () => { try { runAutoCheck(); } catch (e) { errHandler(e); } });

    // defaults
    if (ui.subject && !ui.subject.value) ui.subject.value = currentSubject;
    if (ui.variant && !ui.variant.value) ui.variant.value = currentVariant;

    if (ui.btnDownloadJson) ui.btnDownloadJson.disabled = true;
    if (ui.btnPdf) ui.btnPdf.disabled = true;
    if (ui.btnAutoCheck) ui.btnAutoCheck.disabled = true;
    clearKey();
  }

  function errHandler(e) {
    console.error(e);
    setStatus(String(e.message || e), true);
    alert(String(e.message || e));
  }

  bind();
})();
