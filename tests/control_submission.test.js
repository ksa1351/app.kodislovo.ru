const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the actual page controller, storage and HTTP handling. Only booting
// the full UI is replaced with a test seam; submit/reset functions are unchanged.
const source = fs.readFileSync(path.join(__dirname, "../control/control_core.js"), "utf8");
const boot = source.indexOf("  init().catch((err) => {");
assert.ok(boot > 0);
const instrumented = source.slice(0, boot) + `
  root.testApi = {
    submit: submitResultToCloud, reset: consumeResetCode, load: loadVariant,
    save: saveProgress, loadProgress, key: lsKey, finish: finishNow,
    configure(assignment) {
      assignmentConfig = assignment ? {variant: {meta: {title: 'Test'}, tasks: [{id: '1'}]}} : null;
      currentVariantId = 'variant-1'; currentVariantFile = 'assignment:test';
      currentVariantEntry = {id: currentVariantId};
      variantMeta = {title: 'Test'}; manifest = {subjectTitle: 'Test'};
      startedAt = '2026-10-04T10:00:00.000Z'; finishedAt = '2026-10-04T10:30:00.000Z';
      isFinished = true;
      answersMap = {'1': '42', '2': 'Собственный письменный ответ'};
      backendServicesPromise = Promise.resolve({submitUrl: 'https://api.test/submit', resetConsumeUrl: 'https://api.test/reset'});
    },
    snapshot() { return JSON.parse(JSON.stringify({submission, isFinished, answersMap, startedAt, finishedAt, lastSubmissionId})); },
    changeAnswer(value) { answersMap['2'] = value; },
    setFinished(value) { isFinished = value; },
    refresh: applyFinishedState
  };
})();`;

function storage() {
  const values = new Map();
  return {
    values, failSet: false,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { if (this.failSet) throw new Error("Storage full"); values.set(key, String(value)); },
    removeItem: (key) => values.delete(key),
  };
}

function harness({disk = storage(), assignment = "work-1", reply, confirm = true, immediateTimeout = false} = {}) {
  const calls = [], alerts = [];
  const elements = new Map();
  const ids = ["studentName", "studentClass", "btnSubmit", "btnFinish", "btnReset", "resetCode", "submissionStatus", "successScore", "successMessage", "successTitle", "successStudent", "successVariant", "submitSuccessOverlay"];
  for (const id of ids) elements.set(id, {
    value: id === "studentName" ? "Тестовый ученик" : id === "studentClass" ? "9В" : id === "resetCode" ? "abcdef123456" : "",
    textContent: "", disabled: false, _kdBound: false,
    classList: {remove() {}, add() {}, toggle() {}}, addEventListener() {},
  });
  const context = {
    document: {getElementById: (id) => elements.get(id) || null, querySelectorAll: () => []},
    location: {search: assignment ? `?assignment=${assignment}` : "", origin: "https://site.test", pathname: "/project/control/control.html"},
    navigator: {userAgent: "test"}, localStorage: disk,
    URL, URLSearchParams, AbortController,
    crypto: require("node:crypto").webcrypto,
    setTimeout: immediateTimeout ? (cb) => setTimeout(cb, 0) : setTimeout,
    clearTimeout, setInterval, clearInterval,
    alert: (message) => alerts.push(message), confirm: () => confirm,
    console: {error() {}, warn() {}},
    fetch: async (url, options) => {
      calls.push({url, body: options?.body, headers: options?.headers});
      const result = reply ? await reply(url, options, calls.length) : {submissionId: "server-1", gradedBy: "server", grading: {earnedPoints: 1, maxPoints: 2}};
      return {ok: true, status: 200, text: async () => JSON.stringify(result)};
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(instrumented, context, {filename: "control_core.js"});
  context.testApi.configure(Boolean(assignment));
  return {api: context.testApi, disk, elements, calls, alerts};
}

test("confirmed submission retains answers and receipt across reload; no second POST", async () => {
  const h = harness();
  await h.api.submit();
  const saved = JSON.parse(h.disk.getItem(h.api.key()));
  assert.equal(saved.answers["2"], "Собственный письменный ответ");
  assert.equal(saved.submission.state, "accepted");
  assert.equal(saved.submission.receipt.submissionId, "server-1");
  assert.equal(h.elements.get("btnSubmit").disabled, true);
  const reloaded = harness({disk: h.disk});
  await reloaded.api.load({id: "variant-1"});
  reloaded.api.refresh();
  await reloaded.api.submit();
  assert.equal(reloaded.api.snapshot().lastSubmissionId, "server-1");
  assert.equal(reloaded.api.snapshot().answersMap["2"], "Собственный письменный ответ");
  assert.equal(reloaded.calls.length, 0);
  assert.equal(reloaded.elements.get("btnSubmit").disabled, true);
});

test("receipt without grading means accepted, not zero or a failed submission", async () => {
  const h = harness({reply: async () => ({submissionId: "pending-grade"})});
  await h.api.submit();
  assert.equal(h.api.snapshot().submission.state, "accepted");
  assert.equal(h.api.snapshot().submission.receipt.score, null);
  assert.match(h.elements.get("successScore").textContent, /Оценка пока не получена/);
  await h.api.submit();
  assert.equal(h.calls.length, 1);
});

test("invalid grades with receipt retain accepted work without fabricating score", async () => {
  for (const grading of [{earnedPoints: null, maxPoints: 10}, {earnedPoints: "", maxPoints: 10}, {earnedPoints: -1, maxPoints: 10}, {earnedPoints: 11, maxPoints: 10}]) {
    const h = harness({reply: async () => ({submissionId: "server-id", gradedBy: "server", grading})});
    await h.api.submit();
    assert.equal(h.api.snapshot().submission.receipt.score, null);
    assert.ok(h.disk.getItem(h.api.key()));
  }
});

test("network failure then reload retries the identical payload and idempotency key", async () => {
  const h = harness({reply: async () => { throw new Error("Network lost"); }});
  await h.api.submit();
  assert.equal(h.api.snapshot().submission.state, "pending");
  assert.match(h.elements.get("submissionStatus").textContent, /не подтверждён/);
  assert.equal(h.elements.get("btnSubmit").disabled, false);
  const reloaded = harness({disk: h.disk});
  await reloaded.api.load({id: "variant-1"});
  reloaded.api.changeAnswer("Changed in memory must not change the frozen submission");
  await reloaded.api.submit();
  assert.equal(reloaded.calls[0].body, h.calls[0].body);
  assert.equal(reloaded.calls[0].headers["Idempotency-Key"], h.calls[0].headers["Idempotency-Key"]);
});

test("empty/malformed or explicit error acknowledgements do not delete draft or rotate key", async () => {
  for (const response of [null, {}, {ok: true}, {submissionId: "", gradedBy: "server", grading: {earnedPoints: 0, maxPoints: 10}}, {submissionId: "x", ok: false}, {submissionId: "x", error: "Rejected"}]) {
    const h = harness({reply: async () => response});
    await h.api.submit();
    await h.api.submit();
    assert.equal(h.api.snapshot().submission.state, "pending");
    assert.equal(h.calls[0].body, h.calls[1].body);
    assert.equal(h.calls[0].headers["Idempotency-Key"], h.calls[1].headers["Idempotency-Key"]);
    assert.ok(JSON.parse(h.disk.getItem(h.api.key())).answers["2"]);
  }
});

test("double click and reset during an in-flight submission cannot start another operation", async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const h = harness({reply: () => response});
  const sending = h.api.submit();
  await Promise.resolve();
  await h.api.submit();
  await h.api.reset();
  assert.equal(h.elements.get("btnReset").disabled, true);
  release({submissionId: "one"});
  await sending;
  assert.equal(h.calls.length, 1);
});

test("storage failure before POST blocks sending and warns without losing in-memory answer", async () => {
  const h = harness(); h.disk.failSet = true;
  await h.api.submit();
  assert.equal(h.calls.length, 0);
  assert.equal(h.api.snapshot().answersMap["2"], "Собственный письменный ответ");
  assert.match(h.alerts.at(-1), /Не удалось сохранить/);
});

test("storage failure after acceptance keeps receipt in memory and prevents resubmit", async () => {
  let h;
  h = harness({reply: async () => { h.disk.failSet = true; return {submissionId: "accepted"}; }});
  await h.api.submit(); await h.api.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.api.snapshot().submission.state, "accepted");
  assert.match(h.elements.get("submissionStatus").textContent, /сохранить не удалось/);
  // Pending disk snapshot still has exactly the original key if storage failed.
  assert.equal(JSON.parse(h.disk.getItem(h.api.key())).submission.idempotencyKey, h.calls[0].headers["Idempotency-Key"]);
});

test("authorized reset archives the old work and gives the next attempt a new key", async () => {
  const h = harness({reply: async url => url.endsWith("/reset") ? {ok: true} : {submissionId: "first"}});
  await h.api.submit();
  const oldKey = h.api.snapshot().submission.idempotencyKey;
  await h.api.reset();
  assert.equal(h.api.snapshot().submission, null);
  assert.equal(h.api.snapshot().isFinished, false);
  const archives = [...h.disk.values.entries()].filter(([key]) => key.startsWith("kodislovo_control:archive:"));
  assert.equal(archives.length, 1);
  assert.equal(JSON.parse(archives[0][1]).submission.receipt.submissionId, "first");
  h.api.changeAnswer("New answer"); h.api.finish(false);
  await h.api.submit();
  assert.notEqual(h.api.snapshot().submission.idempotencyKey, oldKey);
});

test("failed reset leaves the accepted receipt and answers intact", async () => {
  const h = harness({reply: async url => { if (url.endsWith("/reset")) throw new Error("Reset rejected"); return {submissionId: "one"}; }});
  await h.api.submit(); await h.api.reset();
  assert.equal(h.api.snapshot().submission.state, "accepted");
  assert.equal(JSON.parse(h.disk.getItem(h.api.key())).answers["2"], "Собственный письменный ответ");
});

test("assignments of the same variant use different storage entries", async () => {
  const h = harness(); await h.api.submit();
  const other = harness({disk: h.disk, assignment: "work-2"});
  assert.notEqual(other.api.key(), h.api.key());
  assert.equal(other.api.loadProgress(), null);
});

test("legacy draft recovery requires a choice and preserves the original", async () => {
  const disk = storage();
  const key = "kodislovo_control:russian:variant-1";
  disk.setItem(key, JSON.stringify({student: {name: "Тест", class: "9В"}, answers: {"1": "old"}, isFinished: true}));
  assert.equal(harness({disk, confirm: false}).api.loadProgress(), null);
  const h = harness({disk});
  await h.api.load({id: "variant-1"});
  assert.equal(h.api.snapshot().answersMap["1"], "old");
  assert.ok(disk.getItem(key));
  assert.ok(disk.getItem(h.api.key()));
});

test("existing non-assignment contract accepts a valid server score, not null as zero", async () => {
  const h = harness({assignment: "", reply: async () => ({gradedBy: "server", grading: {earnedPoints: 0, maxPoints: 2}})});
  await h.api.submit();
  assert.equal(h.api.snapshot().submission.state, "accepted");
  assert.equal(h.api.snapshot().submission.receipt.score.earned, 0);
  assert.equal(h.calls[0].headers["Idempotency-Key"], undefined);
});

test("timed-out POST retains its snapshot and unlocks retry", async () => {
  const h = harness({immediateTimeout: true, reply: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
  })});
  await h.api.submit();
  assert.equal(h.api.snapshot().submission.state, "pending");
  assert.equal(h.elements.get("btnSubmit").disabled, false);
  assert.ok(h.disk.getItem(h.api.key()));
});

test("student identity remains editable after timed finish until the submission is frozen", () => {
  const h = harness();
  h.elements.get("studentName").value = "";
  h.api.refresh();
  assert.equal(h.elements.get("studentName").disabled, false);
});
