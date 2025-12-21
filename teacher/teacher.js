// teacher/teacher.js
// Kodislovo — Учительская панель (GitHub Pages)
// Функции: список работ, просмотр JSON, скачивание, удаление с бакета, выгрузка CSV,
// PDF-отчёт по выбранной работе, автопроверка по ключу (файл локально или из бакета).
//
// ВАЖНО: механизм общения с Yandex Cloud не меняем — используем manifest.teacher.base_url и manifest.teacher.token.
// Ожидается структура:
// - /controls/russian/variants/manifest.json (и варианты рядом)
// - результаты в бакете (как уже настроено у вас)
// - teacher/index.html подключает общий стиль /assets/css/control-ui.css и этот скрипт.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- helpers ----------
  function safeText(s) {
    return (s ?? "").toString().trim();
  }

  function norm(s) {
    return safeText(s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }

  function fmtDate(iso) {
    const t = safeText(iso);
    if (!t) return "";
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.toLocaleString("ru-RU");
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toCsvCell(v) {
    const s = String(v ?? "");
    if (/[",\n;]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
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

  function downloadJson(filename, obj) {
    downloadBlob(filename, new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" }));
  }

  // ---------- manifest / config ----------
  let subject = "russian";
  let manifest = null;

  let TEACHER_BASE = "";
  let TEACHER_TOKEN = "";

  // key for autocheck (answers)
  // формат ключа (пример):
  // {
  //   "variant_01": {
  //      "1": ["вследствие"],
  //      "2": ["..."]
  //   }
  // }
  // или { "answers": { "variant_01": { "1":[...]} } }
  let answerKey = null;

  // ---------- state ----------
  let items = []; // list results (rows)
  let selectedKey = null; // S3 key
  let selectedJson = null; // loaded JSON of result

  // ---------- API ----------
  async function api(path, bodyObj) {
    if (!TEACHER_BASE) throw new Error("teacher.base_url не задан в manifest.json");
    const url = TEACHER_BASE.replace(/\/+$/, "") + path;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Teacher-Token": TEACHER_TOKEN,
      },
      body: JSON.stringify(bodyObj || {}),
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

  // ---------- UI ----------
  function setStatus(msg, ok = true) {
    const el = $("uiStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = ok ? "" : "var(--bad)";
  }

  function setBusy(isBusy) {
    const btns = $$("button");
    btns.forEach((b) => (b.disabled = isBusy));
    const sp = $("uiSpinner");
    if (sp) sp.classList.toggle("kd-hidden", !isBusy);
  }

  function getFilter() {
    return {
      variant: safeText($("filterVariant")?.value),
      cls: safeText($("filterClass")?.value),
      limit: Number($("filterLimit")?.value || 50),
    };
  }

  function setPreviewJson(obj) {
    const pre = $("previewJson");
    if (!pre) return;
    pre.value = obj ? JSON.stringify(obj, null, 2) : "";
  }

  function setPreviewHtml(html) {
    const box = $("previewBox");
    if (!box) return;
    box.innerHTML = html || "";
  }

  function rowHtml(it) {
    const fio = escapeHtml(it.fio || "");
    const cls = escapeHtml(it.cls || "");
    const variant = escapeHtml(it.variant || "");
    const dt = escapeHtml(fmtDate(it.createdAt || ""));
    const key = escapeHtml(it.key || "");
    const voided = !!it.voided;

    return `
      <tr data-key="${escapeHtml(it.key)}" class="${voided ? "is-voided" : ""}">
        <td class="td-main">
          <div class="td-title">${fio || "<span class='muted'>—</span>"}</div>
          <div class="td-sub">${cls || "<span class='muted'>—</span>"}</div>
        </td>
        <td>${variant || "<span class='muted'>—</span>"}</td>
        <td>${dt || "<span class='muted'>—</span>"}</td>
        <td class="td-key"><code>${key}</code></td>
        <td class="td-actions">
          <button class="kd-btn secondary btn-small" data-act="open">Открыть</button>
          <button class="kd-btn secondary btn-small" data-act="download">Скачать</button>
          <button class="kd-btn secondary btn-small" data-act="pdf">PDF</button>
          <button class="kd-btn secondary btn-small" data-act="delete">Удалить</button>
        </td>
      </tr>
    `;
  }

  function renderTable(list) {
    const tbody = $("tblBody");
    if (!tbody) return;

    tbody.innerHTML = list.map(rowHtml).join("");

    // row actions
    tbody.onclick = async (e) => {
      const btn = e.target?.closest("button[data-act]");
      if (!btn) return;

      const tr = btn.closest("tr[data-key]");
      const key = tr?.dataset?.key;
      if (!key) return;

      const act = btn.dataset.act;

      if (act === "open") return openOne(key);
      if (act === "download") return downloadOne(key);
      if (act === "delete") return deleteOne(key);
      if (act === "pdf") return pdfOne(key);
    };
  }

  function pickSelectedCheckboxes() {
    return $$("input[name='rowPick']:checked").map((x) => x.value);
  }

  // ---------- load list ----------
  async function loadList() {
    setStatus("");
    setBusy(true);
    try {
      const f = getFilter();
      const data = await api("/teacher/list", {
        variant: f.variant || "",
        cls: f.cls || "",
        limit: f.limit || 50,
      });

      items = Array.isArray(data?.items) ? data.items : [];
      // render with checkboxes (mass operations)
      const tbody = $("tblBody");
      if (!tbody) return;

      tbody.innerHTML = items
        .map((it) => {
          const fio = escapeHtml(it.fio || "");
          const cls = escapeHtml(it.cls || "");
          const variant = escapeHtml(it.variant || "");
          const dt = escapeHtml(fmtDate(it.createdAt || ""));
          const key = escapeHtml(it.key || "");
          const voided = !!it.voided;

          return `
            <tr data-key="${escapeHtml(it.key)}" class="${voided ? "is-voided" : ""}">
              <td class="td-pick">
                <input type="checkbox" name="rowPick" value="${escapeHtml(it.key)}" />
              </td>
              <td class="td-main">
                <div class="td-title">${fio || "<span class='muted'>—</span>"}</div>
                <div class="td-sub">${cls || "<span class='muted'>—</span>"}</div>
              </td>
              <td>${variant || "<span class='muted'>—</span>"}</td>
              <td>${dt || "<span class='muted'>—</span>"}</td>
              <td class="td-key"><code>${key}</code></td>
              <td class="td-actions">
                <button class="kd-btn secondary btn-small" data-act="open">Открыть</button>
                <button class="kd-btn secondary btn-small" data-act="download">Скачать</button>
                <button class="kd-btn secondary btn-small" data-act="pdf">PDF</button>
                <button class="kd-btn secondary btn-small" data-act="delete">Удалить</button>
              </td>
            </tr>
          `;
        })
        .join("");

      tbody.onclick = async (e) => {
        const btn = e.target?.closest("button[data-act]");
        if (!btn) return;

        const tr = btn.closest("tr[data-key]");
        const key = tr?.dataset?.key;
        if (!key) return;

        const act = btn.dataset.act;
        if (act === "open") return openOne(key);
        if (act === "download") return downloadOne(key);
        if (act === "delete") return deleteOne(key);
        if (act === "pdf") return pdfOne(key);
      };

      setStatus(`Загружено: ${items.length}`);
    } catch (err) {
      console.error(err);
      setStatus("teacher api failed: " + err.message, false);
    } finally {
      setBusy(false);
    }
  }

  // ---------- open/get ----------
  async function openOne(key) {
    setStatus("");
    setBusy(true);
    try {
      const data = await api("/teacher/get", { key });
      selectedKey = key;
      selectedJson = data;
      setPreviewJson(data);

      const fio = escapeHtml(data?.student?.name || data?.identity?.fio || "");
      const cls = escapeHtml(data?.student?.class || data?.identity?.cls || "");
      const varTitle = escapeHtml(data?.variant?.title || data?.variant?.id || data?.variantId || "");
      const percent = data?.grading?.percent ?? data?.grading?.scorePercent ?? null;

      setPreviewHtml(`
        <div class="kd-task">
          <h3>Просмотр работы</h3>
          <div class="q">
            <b>ФИО:</b> ${fio || "—"}<br>
            <b>Класс:</b> ${cls || "—"}<br>
            <b>Вариант:</b> ${varTitle || "—"}<br>
            <b>Процент:</b> ${percent ?? "—"}<br>
            <b>Ключ:</b> <code>${escapeHtml(key)}</code>
          </div>
        </div>
      `);

      // render answers quick view
      const answers = data?.answers || {};
      const tasks = data?.perTask || null;
      if (tasks && Array.isArray(tasks)) {
        const lines = tasks
          .map((t) => {
            const ok = t.ok ? "✅" : "❌";
            return `${ok} №${t.id}: ${escapeHtml(String(t.student ?? ""))}`;
          })
          .join("<br>");
        setPreviewHtml(
          $("previewBox").innerHTML +
            `<div class="kd-task"><h3>Ответы</h3><div class="q">${lines || "<span class='muted'>нет</span>"}</div></div>`
        );
      } else if (answers && typeof answers === "object") {
        const lines = Object.keys(answers)
          .sort((a, b) => Number(a) - Number(b))
          .map((id) => `№${escapeHtml(id)}: ${escapeHtml(String(answers[id] ?? ""))}`)
          .join("<br>");
        setPreviewHtml(
          $("previewBox").innerHTML +
            `<div class="kd-task"><h3>Ответы</h3><div class="q">${lines || "<span class='muted'>нет</span>"}</div></div>`
        );
      }
    } catch (err) {
      console.error(err);
      setStatus("teacher api failed: " + err.message, false);
    } finally {
      setBusy(false);
    }
  }

  // ---------- download ----------
  async function downloadOne(key) {
    setStatus("");
    setBusy(true);
    try {
      const data = await api("/teacher/get", { key });
      const fio = safeText(data?.student?.name || "student").replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_");
      const cls = safeText(data?.student?.class || "class").replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_");
      const vid = safeText(data?.variant?.id || data?.variantId || "variant");
      const fn = `result_${vid}_${cls}_${fio}.json`;
      downloadJson(fn, data);
      setStatus("Файл скачан: " + fn);
    } catch (err) {
      console.error(err);
      setStatus("teacher api failed: " + err.message, false);
    } finally {
      setBusy(false);
    }
  }

  // ---------- delete (from bucket) ----------
  async function deleteOne(key) {
    if (!confirm("Удалить файл из бакета?\n\n" + key)) return;

    setStatus("");
    setBusy(true);
    try {
      await api("/teacher/delete", { key });
      setStatus("Удалено: " + key);
      // refresh list
      await loadList();
      // clear preview if it was the same
      if (selectedKey === key) {
        selectedKey = null;
        selectedJson = null;
        setPreviewJson(null);
        setPreviewHtml("");
      }
    } catch (err) {
      console.error(err);
      setStatus("teacher api failed: " + err.message, false);
    } finally {
      setBusy(false);
    }
  }

  // ---------- CSV export ----------
  function exportCsvSelected() {
    const keys = pickSelectedCheckboxes();
    if (!keys.length) {
      alert("Выберите работы галочками.");
      return;
    }

    const map = new Map(items.map((it) => [it.key, it]));
    const rows = keys
      .map((k) => map.get(k))
      .filter(Boolean)
      .map((it) => ({
        fio: it.fio || "",
        cls: it.cls || "",
        variant: it.variant || "",
        createdAt: it.createdAt || "",
        key: it.key || "",
        percent: it.percent ?? "",
        mark: it.mark ?? "",
      }));

    const header = ["fio", "cls", "variant", "createdAt", "percent", "mark", "key"];
    const csv =
      header.join(";") +
      "\n" +
      rows
        .map((r) => header.map((h) => toCsvCell(r[h])).join(";"))
        .join("\n");

    downloadBlob(`results_${subject}_${new Date().toISOString().slice(0, 10)}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
  }

  // ---------- PDF (print-to-pdf via browser) ----------
  async function pdfOne(key) {
    setStatus("");
    setBusy(true);
    try {
      const data = await api("/teacher/get", { key });

      // build printable HTML
      const fio = escapeHtml(data?.student?.name || "");
      const cls = escapeHtml(data?.student?.class || "");
      const title = escapeHtml(data?.variant?.title || data?.variant?.id || "");
      const started = escapeHtml(fmtDate(data?.startedAt || ""));
      const finished = escapeHtml(fmtDate(data?.finishedAt || ""));
      const percent = data?.grading?.percent ?? null;
      const pts = data?.grading ? `${data.grading.earnedPoints ?? ""}/${data.grading.maxPoints ?? ""}` : "";

      const perTask = Array.isArray(data?.perTask) ? data.perTask : null;
      const answers = data?.answers && typeof data.answers === "object" ? data.answers : null;

      let lines = "";
      if (perTask) {
        lines = perTask
          .map((t) => {
            const ok = t.ok ? "✔" : "✘";
            const st = escapeHtml(String(t.student ?? ""));
            const acc = Array.isArray(t.accepted) ? escapeHtml(t.accepted.join(" / ")) : "";
            return `<tr>
              <td>${escapeHtml(String(t.id))}</td>
              <td>${ok}</td>
              <td>${st}</td>
              <td>${acc}</td>
              <td>${escapeHtml(String(t.earned ?? ""))}/${escapeHtml(String(t.max ?? ""))}</td>
            </tr>`;
          })
          .join("");
      } else if (answers) {
        lines = Object.keys(answers)
          .sort((a, b) => Number(a) - Number(b))
          .map((id) => `<tr><td>${escapeHtml(id)}</td><td></td><td>${escapeHtml(String(answers[id] ?? ""))}</td><td></td><td></td></tr>`)
          .join("");
      }

      const html = `
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Отчёт</title>
<style>
  body{ font-family: system-ui,Segoe UI,Arial,sans-serif; padding: 20px; }
  h1{ margin:0 0 8px 0; font-size: 20px; }
  .meta{ margin:0 0 14px 0; color:#333; line-height:1.5; }
  .meta code{ font-size: 12px; }
  table{ width:100%; border-collapse:collapse; }
  th,td{ border:1px solid #ddd; padding:8px; font-size:13px; vertical-align:top; }
  th{ background:#f3f3f3; text-align:left; }
  .muted{ color:#666; }
</style>
</head>
<body>
  <h1>${title || "Контрольная работа"}</h1>
  <p class="meta">
    <b>ФИО:</b> ${fio || "<span class='muted'>—</span>"}<br>
    <b>Класс:</b> ${cls || "<span class='muted'>—</span>"}<br>
    <b>Начало:</b> ${started || "<span class='muted'>—</span>"}<br>
    <b>Окончание:</b> ${finished || "<span class='muted'>—</span>"}<br>
    <b>Баллы:</b> ${escapeHtml(pts)}<br>
    <b>Процент:</b> ${percent ?? "—"}<br>
    <b>Ключ (S3):</b> <code>${escapeHtml(key)}</code>
  </p>

  <table>
    <thead>
      <tr>
        <th style="width:70px">№</th>
        <th style="width:70px">OK</th>
        <th>Ответ ученика</th>
        <th>Ключ (если есть)</th>
        <th style="width:120px">Баллы</th>
      </tr>
    </thead>
    <tbody>
      ${lines || `<tr><td colspan="5" class="muted">Нет данных для отображения.</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;

      const w = window.open("", "_blank");
      if (!w) {
        alert("Браузер заблокировал окно. Разрешите всплывающие окна для сайта.");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      // пользователю: Файл → Печать → Сохранить как PDF
      setStatus("Открылся отчёт. Печать → Сохранить как PDF.");
    } catch (err) {
      console.error(err);
      setStatus("teacher api failed: " + err.message, false);
    } finally {
      setBusy(false);
    }
  }

  // ---------- AutoCheck (client-side using loaded key) ----------
  function parseKeyJson(obj) {
    if (!obj) return null;
    if (obj.answers && typeof obj.answers === "object") return obj.answers;
    return obj;
  }

  function applyAutoCheckToResult(resultJson, keyMap) {
    // expects: keyMap[variantId][taskId] = [answers...]
    const variantId = safeText(resultJson?.variant?.id || resultJson?.variantId || "");
    if (!variantId) throw new Error("Не удалось определить variantId в работе");

    const variantKey = keyMap?.[variantId] || keyMap?.[variantId.replace(/^variant_/, "variant_")] || null;
    if (!variantKey) throw new Error(`В ключе нет варианта: ${variantId}`);

    const tasks = Array.isArray(resultJson?.perTask) ? resultJson.perTask : null;
    const answers = resultJson?.answers && typeof resultJson.answers === "object" ? resultJson.answers : {};

    // если perTask нет — создадим минимум
    const taskIds = tasks ? tasks.map((t) => String(t.id)) : Object.keys(answers);

    const perTaskNew = taskIds
      .sort((a, b) => Number(a) - Number(b))
      .map((id) => {
        const student = safeText(answers[id] ?? (tasks ? tasks.find((t) => String(t.id) === id)?.student : "") ?? "");
        const acceptedRaw = variantKey[id] ?? variantKey[String(Number(id))] ?? [];
        const accepted = Array.isArray(acceptedRaw) ? acceptedRaw : [acceptedRaw];
        const ok = accepted.map(norm).includes(norm(student)) && norm(student) !== "";
        const pts = Number(tasks?.find((t) => String(t.id) === id)?.max ?? 1);
        return {
          id: Number(id),
          ok,
          student,
          accepted,
          earned: ok ? pts : 0,
          max: pts,
        };
      });

    const max = perTaskNew.reduce((s, t) => s + Number(t.max || 0), 0);
    const earned = perTaskNew.reduce((s, t) => s + Number(t.earned || 0), 0);
    const percent = max > 0 ? Math.round((earned / max) * 100) : 0;

    resultJson.perTask = perTaskNew;
    resultJson.grading = {
      ...(resultJson.grading || {}),
      maxPoints: max,
      earnedPoints: earned,
      percent,
      checkedBy: "teacher-panel-autocheck",
      checkedAt: new Date().toISOString(),
    };

    return resultJson;
  }

  async function loadKeyFromFile(file) {
    const text = await file.text();
    const obj = JSON.parse(text);
    return parseKeyJson(obj);
  }

  async function loadKeyFromBucketKey(s3Key) {
    // предполагаем: ключ хранится как JSON в бакете результатов, доступ через teacher/get
    // если вы храните ключ в другом бакете/пути — просто укажите key в поле.
    const data = await api("/teacher/get", { key: s3Key });
    return parseKeyJson(data);
  }

  async function autoCheckSelected() {
    const keys = pickSelectedCheckboxes();
    if (!keys.length) {
      alert("Выберите работы галочками.");
      return;
    }
    if (!answerKey) {
      alert("Сначала загрузите ключ (локальный файл или ключ из бакета).");
      return;
    }

    setStatus("");
    setBusy(true);
    try {
      const results = [];
      for (const k of keys) {
        const data = await api("/teacher/get", { key: k });
        const updated = applyAutoCheckToResult(data, answerKey);
        // сохраняем обратно как новый JSON? (это отдельный процесс — мы НЕ перезаписываем ученический файл здесь)
        // поэтому: скачиваем обновлённый вариант для учителя
        results.push({ key: k, updated });
      }

      // один zip мы не делаем — скачиваем одним JSON-архивом
      const pack = {
        schema: "kodislovo.teacher.autocheck.pack.v1",
        createdAt: new Date().toISOString(),
        count: results.length,
        items: results.map((x) => ({ key: x.key, result: x.updated })),
      };

      downloadJson(`autocheck_${subject}_${new Date().toISOString().slice(0, 10)}.json`, pack);
      setStatus(`Автопроверка выполнена: ${results.length} (скачан файл)`);
    } catch (err) {
      console.error(err);
      setStatus("Автопроверка: " + err.message, false);
    } finally {
      setBusy(false);
    }
  }

  // ---------- bulk delete ----------
  async function deleteSelected() {
    const keys = pickSelectedCheckboxes();
    if (!keys.length) {
      alert("Выберите работы галочками.");
      return;
    }
    if (!confirm(`Удалить из бакета ${keys.length} файл(ов)?`)) return;

    setStatus("");
    setBusy(true);
    try {
      for (const k of keys) {
        await api("/teacher/delete", { key: k });
      }
      setStatus(`Удалено: ${keys.length}`);
      await loadList();
    } catch (err) {
      console.error(err);
      setStatus("Удаление: " + err.message, false);
    } finally {
      setBusy(false);
    }
  }

  // ---------- init ----------
  async function loadManifest() {
    // teacher panel is in /teacher/, controls in root /controls/
    const url = new URL("../controls/" + encodeURIComponent(subject) + "/variants/manifest.json", window.location.href).toString();
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Не удалось загрузить manifest.json: ${url} (HTTP ${r.status})`);
    manifest = await r.json();

    TEACHER_BASE = safeText(manifest?.teacher?.base_url || "");
    TEACHER_TOKEN = safeText(manifest?.teacher?.token || "");

    if (!TEACHER_BASE || !TEACHER_TOKEN) {
      throw new Error("В manifest.json не заданы teacher.base_url или teacher.token");
    }

    // fill variant selector (optional)
    const sel = $("filterVariant");
    if (sel) {
      sel.innerHTML = `<option value="">Все варианты</option>` + (manifest.variants || [])
        .map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.title || v.id)}</option>`)
        .join("");
    }

    // header text
    $("uiSubject") && ($("uiSubject").textContent = manifest.subjectTitle || subject);
  }

  function wireUi() {
    $("btnReload")?.addEventListener("click", loadList);

    $("btnCsv")?.addEventListener("click", exportCsvSelected);
    $("btnDeleteSelected")?.addEventListener("click", deleteSelected);
    $("btnAutoCheck")?.addEventListener("click", autoCheckSelected);

    $("chkAll")?.addEventListener("change", (e) => {
      const v = !!e.target.checked;
      $$("input[name='rowPick']").forEach((x) => (x.checked = v));
    });

    // key load: local
    $("keyFile")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        answerKey = await loadKeyFromFile(f);
        setStatus("Ключ загружен (локальный файл)");
      } catch (err) {
        console.error(err);
        setStatus("Ключ: " + err.message, false);
      }
    });

    // key load: from bucket key
    $("btnKeyFromBucket")?.addEventListener("click", async () => {
      const k = safeText($("keyBucketKey")?.value);
      if (!k) {
        alert("Введите S3 key файла ключа (например: keys/russian/variant_01.json)");
        return;
      }
      setBusy(true);
      try {
        answerKey = await loadKeyFromBucketKey(k);
        setStatus("Ключ загружен (из бакета)");
      } catch (err) {
        console.error(err);
        setStatus("Ключ: " + err.message, false);
      } finally {
        setBusy(false);
      }
    });
  }

  // ---------- run ----------
  async function init() {
    // subject from query ?subject=russian
    const p = new URLSearchParams(location.search);
    subject = p.get("subject") || "russian";

    await loadManifest();
    wireUi();
    await loadList();
  }

  init().catch((err) => {
    console.error(err);
    setStatus("Ошибка запуска панели: " + err.message, false);
    alert(
      "Ошибка запуска учительской панели:\n" +
        err.message +
        "\n\nПроверь:\n" +
        "1) /controls/<subject>/variants/manifest.json доступен\n" +
        "2) в manifest.json есть teacher.base_url и teacher.token\n"
    );
  });
})();
