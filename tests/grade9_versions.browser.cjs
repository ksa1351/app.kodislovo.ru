// Run with PLAYWRIGHT_MODULE pointing to Playwright, or install it locally.
// Uses a local server and mocked receipts; never sends pupil data to Google.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel: process.env.BROWSER_CHANNEL || 'msedge', headless:true});
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const posted = [];
    let failNext = false;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (url.hostname !== 'script.google.com') return route.abort();
      const payload = JSON.parse(new URLSearchParams(route.request().postData()).get('payload'));
      posted.push(payload);
      if (failNext) { failNext = false; return route.abort(); }
      return route.fulfill({contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:JSON.stringify({
        schemaVersion:'kodislovo.collector-receipt.v1', status:'accepted', journal:'teacher',
        sourceSubmissionId:payload.submission_id, submissionId:'local-' + payload.submission_id,
      })});
    });
    const base = `http://127.0.0.1:${server.address().port}/assignments/2026-09-18/`;
    const send = async () => {
      await page.locator('#send-to-teacher').click();
      await page.waitForFunction(() => !document.getElementById('send-to-teacher').disabled);
    };
    const selection = async ids => page.evaluate(ids => {
      document.querySelectorAll('.sent').forEach(button => {
        if ((button.getAttribute('aria-pressed') === 'true') !== ids.includes(button.dataset.id)) button.click();
      });
    }, ids);

    await page.goto(base + '9v-times-change-v2.html');
    await page.evaluate(() => {
      localStorage.setItem('kr_9v_vremena_menyayutsya_v1', JSON.stringify({student:'OLD DRAFT', selected:['s11']}));
      localStorage.setItem('task_9v-suffixes.html', JSON.stringify({student:'OLD DRAFT', fields:{w1:'old'}}));
    });
    await page.reload();
    assert.equal(await page.locator('#student').inputValue(), '');
    await page.locator('#student').fill('LOCAL QA');
    for (const ids of [[], ['s11','s12','s13','s14','s21','s22','s23','s24','s31','s32','s33','s34'], ['s11','s12','s13','s14','s21','s31']]) {
      await selection(ids);
      await page.locator('#check-main').click();
      const feedback = await page.locator('#main-feedback').textContent();
      await send();
      assert.equal(await page.locator('#collector-status').textContent(), feedback);
      assert.equal(posted.length, 0, 'Invalid selection must never be submitted');
    }
    const correct = ['s12','s14','s21','s23','s31','s34'];
    await selection(correct);
    await page.locator('#compressed').fill('LOCAL OPEN ANSWER');
    await page.reload();
    assert.equal(await page.locator('.sent[aria-pressed="true"]').count(), 6);
    assert.equal(await page.locator('#compressed').inputValue(), 'LOCAL OPEN ANSWER');
    await page.locator('#check-main').click();
    assert.match(await page.locator('#main-feedback').textContent(), /^6 из 6/);
    failNext = true;
    await send();
    assert.match(await page.locator('#collector-status').textContent(), /Подтверждение не получено/);
    await page.reload();
    await send();
    assert.equal(posted.length, 2);
    assert.deepEqual(posted[0], posted[1], 'Retry preserves exact ID, answers and score');
    assert.equal(posted[1].code, '9V_KR_01_V2');
    assert.equal(posted[1].auto_score, 6);
    assert.equal(posted[1].auto_max, 6);
    assert.match(posted[1].open_text, /LOCAL OPEN ANSWER/);
    await send();
    assert.equal(posted.length, 2, 'Confirmed result is not duplicated');
    await selection(['s11','s14','s21','s23','s31','s34']);
    await send();
    assert.equal(posted.at(-1).auto_score, 5);
    assert.notEqual(posted.at(-1).submission_id, posted[1].submission_id);

    await page.goto(base + '9v-suffixes-v2.html');
    assert.equal(await page.locator('#student').inputValue(), '');
    await page.locator('#student').fill('LOCAL QA');
    await page.evaluate(() => {
      for (const [name, spec] of Object.entries(answerKey)) {
        document.querySelectorAll('[name="' + name + '"]').forEach(el => {
          if (el.type === 'checkbox') el.checked = spec.answer.includes(el.value);
          else if (el.type === 'radio') el.checked = el.value === spec.answer;
          else el.value = spec.answer;
          el.dispatchEvent(new Event('change', {bubbles:true}));
        });
      }
    });
    await page.locator('[name="open"]').fill('LOCAL THREE EXPLANATIONS');
    await page.reload();
    await page.getByRole('button', {name:'Завершить и проверить', exact:true}).click();
    assert.match(await page.locator('#result').textContent(), /17 из 17/);
    assert.match(await page.locator('#open-rubric').textContent(), /по 1 баллу/);
    await send();
    const suffix = posted.at(-1);
    assert.equal(suffix.code, '9V_RUS_06_V2');
    assert.equal(suffix.auto_score, 17);
    assert.equal(suffix.auto_max, 17);
    assert.equal(suffix.open_max, 3);
    assert.match(suffix.open_text, /LOCAL THREE EXPLANATIONS/);
    await page.locator('#student').fill('SECOND LOCAL QA');
    await send();
    assert.notEqual(posted.at(-1).submission_id, suffix.submission_id, 'Different students have separate receipts');
    const old = await page.evaluate(() => [localStorage.getItem('kr_9v_vremena_menyayutsya_v1'), localStorage.getItem('task_9v-suffixes.html')]);
    assert(old.every(value => JSON.parse(value).student === 'OLD DRAFT'));

    for (const name of ['9v-suffixes-v2', '9v-times-change-v2']) {
      await page.goto(base + name + '.html');
      for (const width of [360,768,1366]) {
        await page.setViewportSize({width, height:900});
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflow at ' + width);
      }
      if (process.env.QA_OUTPUT) {
        fs.mkdirSync(process.env.QA_OUTPUT, {recursive:true});
        await page.setViewportSize({width:768, height:900});
        await page.screenshot({path:path.join(process.env.QA_OUTPUT, name + '.png'), fullPage:true});
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: selection gates, scores, drafts, retry, receipts, student IDs, and 360/768/1366 layouts. No production writes.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
