(function (root) {
  'use strict';
  const PREFIX = 'kodislovo.lesson-receipt.v1:';
  const active = new Map();

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = canonical(value[key]); return out;
      }, Object.create(null));
    }
    return value;
  }
  function fingerprint(payload) {
    const value = { ...payload };
    delete value.submission_id; delete value.client_time;
    return JSON.stringify(canonical(value));
  }
  function accepted(receipt, payload) {
    return receipt && receipt.schemaVersion === 'kodislovo.collector-receipt.v1' &&
      receipt.status === 'accepted' && receipt.journal === 'teacher' &&
      receipt.sourceSubmissionId === payload.submission_id &&
      typeof receipt.submissionId === 'string' && receipt.submissionId.length > 0;
  }
  function message(receipt) {
    return receipt.usedSavedAnswers
      ? 'Ранее отправленная версия работы сохранена в кабинете учителя. Изменения после первой отправки в неё не входят.'
      : 'Работа сохранена в кабинете учителя. Можно закрыть страницу.';
  }

  async function submit(url, input) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
      throw new Error('Адрес приёмника не настроен.');
    }
    const candidate = JSON.parse(JSON.stringify(input));
    candidate.lesson_day ||= '18.09.2026';
    const key = PREFIX + JSON.stringify([url, candidate.lesson_day, candidate.code,
      String(candidate.klass).trim(), String(candidate.student).trim().toLowerCase()]);
    if (active.has(key)) return active.get(key);
    const promise = sendStored(url, key, candidate, input);
    active.set(key, promise);
    try { return await promise; } finally { active.delete(key); }
  }

  async function sendStored(url, key, candidate, input) {
    let state;
    try {
      const raw = root.localStorage.getItem(key);
      state = raw ? JSON.parse(raw) : null;
      if (state && (!state.payload || !['pending', 'accepted'].includes(state.status))) {
        throw new Error('Invalid local receipt');
      }
    } catch (_) {
      throw new Error('Не удалось прочитать сохранённую отправку. Данные не отправлены; не очищайте хранилище браузера.');
    }
    const changed = state && fingerprint(state.payload) !== fingerprint(candidate);
    if (state && state.status === 'accepted' && !accepted(state.receipt, state.payload)) {
      throw new Error('Сохранённое подтверждение повреждено. Данные не отправлены.');
    }
    if (!state || (state.status === 'accepted' && changed)) {
      state = { status: 'pending', payload: candidate };
      try { root.localStorage.setItem(key, JSON.stringify(state)); }
      catch (_) { throw new Error('Браузер не может сохранить отправку. Разрешите локальное хранилище и повторите.'); }
    }
    // A retry always uses the exact first payload, including its ID and answers.
    const usedSavedAnswers = fingerprint(state.payload) !== fingerprint(candidate);
    Object.assign(input, JSON.parse(JSON.stringify(state.payload)));
    if (state.status === 'accepted') return { ...state.receipt, usedSavedAnswers };
    if (root.KodislovoLessonAccess) await root.KodislovoLessonAccess.check();
    const controller = new root.AbortController();
    const timer = root.setTimeout(() => controller.abort(), 45000);
    let receipt;
    try {
      const response = await root.fetch(url, {
        method: 'POST', credentials: 'omit', redirect: 'follow',
        body: new root.URLSearchParams({ payload: JSON.stringify(state.payload) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Приёмник временно недоступен. Повторите отправку.');
      try { receipt = await response.json(); }
      catch (_) { throw new Error('Приёмник не подтвердил сохранение. Повторите отправку с этой страницы.'); }
      if (!accepted(receipt, state.payload)) {
        if (receipt && receipt.status === 'error' && receipt.sourceSubmissionId === state.payload.submission_id) {
          throw new Error(receipt.message || 'Не удалось сохранить работу. Повторите отправку.');
        }
        throw new Error('Сохранение в кабинете ещё не подтверждено. Повторите отправку с этой страницы.');
      }
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) {
        throw new Error('Подтверждение не получено. Ответы сохранены на устройстве; повторите отправку с этой страницы.');
      }
      throw error;
    } finally { root.clearTimeout(timer); }
    state = { ...state, status: 'accepted', receipt };
    // If this fails, the already persisted pending payload remains retryable.
    try { root.localStorage.setItem(key, JSON.stringify(state)); } catch (_) {}
    return { ...receipt, usedSavedAnswers };
  }
  root.KodislovoLessonSubmitter = { submit, message };
})(globalThis);
