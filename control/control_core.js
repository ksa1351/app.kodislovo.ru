<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Контрольная — Кодислово</title>

  <!-- Единый стиль -->
  <link rel="stylesheet" href="../assets/css/control-ui.css" />
</head>

<body>
  <!-- верхняя липкая панель -->
  <div class="kd-topbar">
    <div class="kd-wrap">
      <div class="kd-row">
        <div class="kd-theme">
          <span class="kd-switch">
            <input id="themeToggle" type="checkbox" />
            <span id="themeLabel">Тёмная</span>
          </span>
          <span style="opacity:.85">⏱ <span id="uiTimer">без лимита</span></span>
        </div>

        <div id="statusLine" class="kd-theme" aria-live="polite"></div>
      </div>
    </div>
  </div>

  <div class="kd-wrap">
    <!-- шапка -->
    <header class="kd-header">
      <h1 class="kd-title" id="workTitle">Контрольная работа</h1>
      <p class="kd-subtitle" id="workSubtitle">
        Заполните ФИО и класс. Выполняйте задания по одному, переходите кнопками «Предыдущее/Следующее».
      </p>
    </header>

    <!-- панель ученика + вариант -->
    <section class="kd-panel">
      <div class="kd-grid">
        <div class="kd-field">
          <label for="studentName">ФИО</label>
          <input id="studentName" class="kd-input" type="text" placeholder="Иванов Иван" autocomplete="name" />
        </div>

        <div class="kd-field">
          <label for="studentClass">Класс</label>
          <input id="studentClass" class="kd-input" type="text" placeholder="10А" autocomplete="off" />
        </div>

        <div class="kd-field" style="grid-column:1 / -1">
          <label for="variantSelect">Вариант</label>
          <select id="variantSelect" class="kd-select"></select>
        </div>
      </div>

      <!-- действия (в один ряд, одинаковая ширина) -->
      <div class="kd-actions">
        <button id="btnFinish" class="kd-btn" type="button">Завершить</button>
        <button id="btnDownload" class="kd-btn secondary" type="button" disabled>Сохранить работу</button>
        <button id="btnEmail" class="kd-btn secondary" type="button" disabled>Отправить</button>
      </div>
    </section>

    <!-- сцена: текст + одно задание -->
    <main class="kd-stage">
      <!-- текст (если есть для диапазона) -->
      <section id="textBox" class="kd-textbox kd-hidden">
        <div id="textContent"></div>
      </section>

      <!-- одно задание -->
      <section class="kd-task" id="taskCard">
        <h3 id="taskTitle">Задание</h3>

        <div id="taskHint" class="hint kd-hidden"></div>
        <div id="taskText" class="q"></div>

        <input
          id="taskAnswer"
          class="kd-answer"
          type="text"
          placeholder="Введите ответ…"
          autocomplete="off"
          spellcheck="false"
        />

        <div class="kd-nav">
          <button id="btnPrev" class="kd-btn secondary" type="button">← Предыдущее</button>
          <button id="btnNext" class="kd-btn secondary" type="button">Следующее →</button>
        </div>
      </section>
    </main>
  </div>

  <script src="./control_core.js"></script>
</body>
</html>
