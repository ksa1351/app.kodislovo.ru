const TOTAL_STEPS = 12;

const TASKS = Array.from({ length: TOTAL_STEPS }, (_, i) => ({
  id: i + 1,
  question: `Пример задания №${i + 1}: введите слово "ответ${i + 1}"`,
  answer: `ответ${i + 1}`,
}));

const mapEl = document.getElementById('map');
const stepCounterEl = document.getElementById('stepCounter');
const statusLabelEl = document.getElementById('statusLabel');
const startBtnEl = document.getElementById('startBtn');

const taskModalEl = document.getElementById('taskModal');
const taskTextEl = document.getElementById('taskText');
const answerInputEl = document.getElementById('answerInput');
const feedbackEl = document.getElementById('feedback');
const checkBtnEl = document.getElementById('checkBtn');

const finishModalEl = document.getElementById('finishModal');
const restartBtnEl = document.getElementById('restartBtn');

let gameStarted = false;
let currentStep = 1;
let activeNote = null;

function updateHud() {
  stepCounterEl.textContent = `${Math.min(currentStep, TOTAL_STEPS)} / ${TOTAL_STEPS}`;
}

function openTaskModal() {
  const task = TASKS[currentStep - 1];
  taskTextEl.textContent = task.question;
  answerInputEl.value = '';
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback';
  taskModalEl.classList.remove('hidden');
  answerInputEl.focus();
}

function closeTaskModal() {
  taskModalEl.classList.add('hidden');
}

function showFinish() {
  finishModalEl.classList.remove('hidden');
  statusLabelEl.textContent = 'Клад найден!';
}

function randomPointInMap() {
  const rect = mapEl.getBoundingClientRect();
  const margin = 24;
  return {
    x: margin + Math.random() * (rect.width - margin * 2),
    y: margin + Math.random() * (rect.height - margin * 2),
  };
}

function clearNote() {
  if (activeNote) {
    activeNote.remove();
    activeNote = null;
  }
}

function spawnNextNote() {
  clearNote();
  const point = randomPointInMap();
  const note = document.createElement('div');
  note.className = 'note';
  note.style.left = `${point.x}px`;
  note.style.top = `${point.y}px`;
  note.setAttribute('aria-label', 'Найдена записка');
  note.setAttribute('title', 'Записка');
  mapEl.appendChild(note);
  activeNote = note;

  note.addEventListener('mouseenter', () => {
    statusLabelEl.textContent = `Записка #${currentStep} найдена`;
    openTaskModal();
  }, { once: true });

  statusLabelEl.textContent = `Ищите записку #${currentStep}`;
}

function checkAnswer() {
  const task = TASKS[currentStep - 1];
  const userAnswer = answerInputEl.value.trim().toLowerCase();

  if (userAnswer !== task.answer.toLowerCase()) {
    feedbackEl.textContent = 'Пока неверно. Попробуй ещё!';
    feedbackEl.className = 'feedback bad';
    return;
  }

  feedbackEl.textContent = 'Верно!';
  feedbackEl.className = 'feedback ok';

  currentStep += 1;
  updateHud();
  closeTaskModal();
  clearNote();

  if (currentStep > TOTAL_STEPS) {
    showFinish();
    return;
  }

  spawnNextNote();
}

function startGame() {
  gameStarted = true;
  currentStep = 1;
  finishModalEl.classList.add('hidden');
  updateHud();
  spawnNextNote();
  startBtnEl.textContent = 'Перезапустить';
}

startBtnEl.addEventListener('click', startGame);
checkBtnEl.addEventListener('click', checkAnswer);
answerInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') checkAnswer();
});
restartBtnEl.addEventListener('click', startGame);

mapEl.addEventListener('mousemove', () => {
  if (gameStarted && activeNote) {
    statusLabelEl.textContent = `Ищите записку #${currentStep}`;
  }
});
