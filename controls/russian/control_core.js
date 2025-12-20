(() => {
"use strict";

// ====== helpers ======
const $ = (s, r = document) => r.querySelector(s);

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[m])
    );
}

function saveJSONFile(filename, dataObj) {
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], {
        type: "application/json"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
}

function mailtoSend(jsonData, email) {
    const body = encodeURIComponent(
        "Контрольная работа\n\n" +
        JSON.stringify(jsonData, null, 2)
    );

    location.href = `mailto:${email}?subject=Контрольная работа&body=${body}`;
}

// ====== main ======
try {
    const cfg = window.CONTROL_CONFIG || {};
    const dataUrl = cfg.dataUrl;
    const STORAGE_KEY = "kontrol:" + dataUrl;

    let data = null;
    let idx = 0;
    let identity = null;
    let allAnswers = {};

    function appTemplate() {
        return `
        <header>
            <div class="wrap">
                <h1 id="title">Контрольная работа</h1>
                <div id="identityLine" class="sub" style="display:none"></div>
                <div id="timerLine" class="sub" style="display:none"></div>

                <div id="topBtns" class="btnbar" style="display:none">
                    <button id="saveLocal">💾 Сохранить файл</button>
                    <button id="sendEmail">📧 Отправить на почту</button>
                </div>
            </div>
        </header>

        <main class="wrap">
            <div id="identityCard" class="card" style="display:none">
                <div class="qid">Данные ученика</div>
                <div class="qtext">Введите ФИО и класс</div>

                <div class="ansrow">
                    <input id="fio" type="text" placeholder="Фамилия Имя" />
                    <input id="cls" type="text" placeholder="Класс" style="max-width:200px" />
                    <button id="start">Начать</button>
                </div>
            </div>

            <div id="questionContainer"></div>
        </main>
        `;
    }

    function renderTask(t) {
        const value = allAnswers[t.id]?.value || "";
        return `
        <section class="card">
            <div class="qid">Задание ${t.id}</div>
            <div class="qhint">${t.hint || ""}</div>
            <div class="qtext">${t.text || ""}</div>

            <div class="ansrow">
                <input id="in-${t.id}" type="text" value="${escapeHtml(value)}"
                       placeholder="Введите ответ">
            </div>

            <div class="nav-buttons-below">
                <button id="prevBtn" class="secondary">← Предыдущее</button>
                <button id="nextBtn" class="secondary">Следующее →</button>
            </div>
        </section>`;
    }

    function updateTaskDisplay() {
        const t = data.tasks[idx];
        $("#questionContainer").innerHTML = renderTask(t);

        $("#prevBtn").onclick = () => { if (idx > 0) { saveProgress(); idx--; updateTaskDisplay(); } };
        $("#nextBtn").onclick = () => { if (idx < data.tasks.length - 1) { saveProgress(); idx++; updateTaskDisplay(); } };

        $("#in-" + t.id).addEventListener("input", saveProgress);
    }

    function saveProgress() {
        const t = data.tasks[idx];
        const el = $("#in-" + t.id);
        if (el) allAnswers[t.id] = { value: el.value };

        localStorage.setItem(STORAGE_KEY, JSON.stringify({ idx, allAnswers, identity }));
    }

    async function loadData() {
        const r = await fetch(dataUrl);
        return await r.json();
    }

    function startWork() {
        $("#identityCard").style.display = "none";
        $("#topBtns").style.display = "flex";

        $("#identityLine").style.display = "block";
        $("#identityLine").textContent =
            `Ученик: ${identity.fio}, класс: ${identity.cls}`;

        updateTaskDisplay();
    }

    async function init() {
        document.body.innerHTML = appTemplate();

        data = await loadData();
        $("#title").textContent = data.meta.title || "Контрольная работа";

        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        allAnswers = saved.allAnswers || {};
        idx = saved.idx || 0;
        identity = saved.identity || null;

        if (!identity) {
            $("#identityCard").style.display = "block";
            $("#start").onclick = () => {
                identity = {
                    fio: $("#fio").value.trim(),
                    cls: $("#cls").value.trim()
                };
                saveProgress();
                startWork();
            };
        } else {
            startWork();
        }

        // кнопка: сохранить JSON
        $("#saveLocal").onclick = () => {
            const pack = {
                meta: data.meta,
                identity,
                answers: allAnswers,
                ts: new Date().toISOString()
            };
            saveJSONFile(cfg.saveFileName || "kontrol.json", pack);
        };

        // кнопка: отправить на почту
        $("#sendEmail").onclick = () => {
            const pack = {
                meta: data.meta,
                identity,
                answers: allAnswers,
                ts: new Date().toISOString()
            };
            mailtoSend(pack, cfg.emailTo);
        };
    }

    init();

} catch (e) {
    alert("Ошибка: " + e.message);
}

})();
