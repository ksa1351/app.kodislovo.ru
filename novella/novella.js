(() => {
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const root = document.documentElement;
  root.dataset.theme = read('novella-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.getElementById('theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    save('novella-theme', root.dataset.theme);
  });
  const minSize = 10;
  const maxSize = 29;
  const clampSize = (value) => Math.max(minSize, Math.min(maxSize, value));
  let size = clampSize(Number(read('novella-size')) || 21);
  const setSize = () => {
    root.style.setProperty('--reading-size', `${size}px`);
    const label = document.getElementById('font-size');
    if (label) label.textContent = `${size} px`;
    const smaller = document.getElementById('smaller');
    const larger = document.getElementById('larger');
    if (smaller) smaller.disabled = size <= minSize;
    if (larger) larger.disabled = size >= maxSize;
  };
  setSize();
  for (const [id, delta] of [['smaller', -1], ['larger', 1]]) {
    document.getElementById(id)?.addEventListener('click', () => {
      size = clampSize(size + delta); setSize(); save('novella-size', size);
    });
  }
  let width = read('novella-width') === 'wide' ? 'wide' : 'column';
  const widthButton = document.getElementById('width');
  const setWidth = () => {
    root.dataset.readingWidth = width;
    widthButton?.setAttribute('aria-pressed', String(width === 'wide'));
  };
  setWidth();
  widthButton?.addEventListener('click', () => {
    width = width === 'wide' ? 'column' : 'wide';
    setWidth(); save('novella-width', width);
  });
  const current = Number(document.body.dataset.chapter);
  if (current) save('novella-chapter', current);
  const resume = document.getElementById('resume');
  const last = Number(read('novella-chapter'));
  const count = document.querySelectorAll('.chapters li').length;
  if (resume && Number.isInteger(last) && last >= 1 && last <= count) {
    resume.href = `chapter-${String(last).padStart(3, '0')}.html`;
    resume.textContent = `Продолжить с главы ${last} →`; resume.hidden = false;
  }
  document.getElementById('search')?.addEventListener('input', (event) => {
    const query = event.target.value.toLocaleLowerCase('ru').trim();
    let visible = 0;
    document.querySelectorAll('.chapters li').forEach((item) => {
      item.hidden = !item.textContent.toLocaleLowerCase('ru').includes(query);
      if (!item.hidden) visible++;
    });
    document.getElementById('empty').hidden = visible > 0;
  });
})();
