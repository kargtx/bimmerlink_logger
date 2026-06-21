const uploadForm = document.getElementById('uploadForm');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const uploadMessage = document.getElementById('uploadMessage');
const metricControls = document.getElementById('metricControls');
const chartArea = document.getElementById('chartArea');
const maxValuesContainer = document.getElementById('maxValues');
const displayModeInputs = document.getElementsByName('displayMode');
const toggleHistoryBtn = document.getElementById('toggleHistory');
const historyListEl = document.getElementById('historyList');
const timeScaleInput = document.getElementById('timeScale');

let sessions = [];
let currentSession = null;
let chartInstances = [];

async function fetchSessions() {
  const response = await fetch('/api/sessions');
  const json = await response.json();
  sessions = json.sessions;
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  historyCount.textContent = `Всего записей: ${sessions.length}`;

  if (sessions.length === 0) {
    historyList.innerHTML = '<p class="message">Пока нет загруженных логов.</p>';
    return;
  }

  sessions.forEach((session) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div>
        <strong>${session.name}</strong>
        <div class="muted-text">${session.filename} · ${new Date(session.createdAt).toLocaleString()}</div>
      </div>
      <div>
        <button type="button" class="open-btn">Открыть</button>
        <button type="button" class="delete-btn">Удалить</button>
      </div>
    `;
    item.querySelector('.open-btn').addEventListener('click', () => loadSession(session.id));
    item.querySelector('.delete-btn').addEventListener('click', () => deleteSession(session.id));
    historyList.appendChild(item);
  });
}

function setMessage(text, isError = false) {
  uploadMessage.textContent = text;
  uploadMessage.style.color = isError ? '#f87171' : '#a5f3fc';
}

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(uploadForm);
  setMessage('Загрузка...');

  try {
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Ошибка загрузки');
    }
    setMessage('Файл сохранен в истории.');
    uploadForm.reset();
    await fetchSessions();
    await loadSession(result.id);
  } catch (error) {
    setMessage(error.message, true);
  }
});

async function loadSession(sessionId) {
  const response = await fetch(`/api/session/${sessionId}`);
  if (!response.ok) {
    setMessage('Не удалось загрузить запись.', true);
    return;
  }
  currentSession = await response.json();
  renderMetricControls();
  renderMaxValues();
  createCharts();
}

async function deleteSession(sessionId) {
  if (!confirm('Вы уверены, что хотите удалить эту запись?')) return;
  try {
    const res = await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Ошибка удаления');
    setMessage('Запись удалена.');
    await fetchSessions();
    // if current session deleted, clear view
    if (currentSession && currentSession.id === sessionId) {
      currentSession = null;
      renderMetricControls();
      renderMaxValues();
      createCharts();
    }
  } catch (err) {
    setMessage(err.message, true);
  }
}

function renderMetricControls() {
  if (!currentSession) {
    metricControls.innerHTML = '';
    return;
  }

  const columns = currentSession.columns.slice(1);
  metricControls.innerHTML = columns.map((name, index) => `
    <label>
      <input type="checkbox" value="${index + 1}" ${index < 2 ? 'checked' : ''} />
      ${name}
    </label>
  `).join('');

  metricControls.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', createCharts);
  });

  displayModeInputs.forEach((input) => {
    input.addEventListener('change', createCharts);
  });
  // time scale control
  if (timeScaleInput) {
    timeScaleInput.removeEventListener('input', createCharts);
    timeScaleInput.addEventListener('input', createCharts);
  }
}

function renderMaxValues() {
  if (!currentSession) {
    maxValuesContainer.innerHTML = '';
    return;
  }
  maxValuesContainer.innerHTML = '';
  const rows = currentSession.columns.slice(1).map((name, index) => {
    const maxValue = currentSession.maxValues[index + 1];
    return `
      <div class="max-row">
        <span>${name}</span>
        <span>${maxValue === null ? 'Нет данных' : maxValue}</span>
        <span>max</span>
      </div>
    `;
  });
  maxValuesContainer.innerHTML = rows.join('');
}

function getSelectedMetrics() {
  if (!currentSession) {
    return [];
  }
  return Array.from(metricControls.querySelectorAll('input[type="checkbox"]:checked')).map((input) => Number(input.value));
}

function getDisplayMode() {
  return Array.from(displayModeInputs).find((input) => input.checked)?.value || 'together';
}

function createCharts() {
  if (!currentSession) {
    chartArea.innerHTML = '<p class="message">Выберите запись из истории, чтобы увидеть графики.</p>';
    return;
  }

  const selected = getSelectedMetrics();
  if (selected.length === 0) {
    chartArea.innerHTML = '<p class="message">Выберите хотя бы один параметр для отображения.</p>';
    return;
  }

  chartInstances.forEach((chart) => chart.destroy());
  chartInstances = [];
  chartArea.innerHTML = '';

  const labels = currentSession.data.map((row) => row[0]);
  const displayMode = getDisplayMode();
  const timeScale = timeScaleInput ? Number(timeScaleInput.value) : 1;

  const palette = [
    '#60a5fa', '#fbbf24', '#34d399', '#f472b6', '#a78bfa', '#38bdf8', '#f59e0b', '#22c55e', '#fb7185'
  ];

  if (displayMode === 'together') {
    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'chart-wrapper';
    const canvas = document.createElement('canvas');
    canvasWrapper.appendChild(canvas);
    chartArea.appendChild(canvasWrapper);
    // adjust canvas width according to time scale and data length
    const basePerPoint = 6; // px per data point at scale=1
    const targetWidth = Math.max(800, Math.round(labels.length * basePerPoint * timeScale));
    canvas.width = targetWidth;
    canvas.style.width = targetWidth + 'px';
    // make chart not auto-resize so canvas width is respected
    const datasets = selected.map((columnIndex, index) => ({
      label: currentSession.columns[columnIndex],
      data: currentSession.data.map((row) => row[columnIndex]),
      borderColor: palette[index % palette.length],
      backgroundColor: `${palette[index % palette.length]}33`,
      tension: 0.25,
      pointRadius: 0,
      borderWidth: 2
    }));

    const chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: false,
        interaction: { mode: 'index', intersect: false },
        stacked: false,
        plugins: {
          legend: { position: 'top', labels: { color: '#cbd5e1' } },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { title: { display: true, text: currentSession.columns[0], color: '#cbd5e1' }, ticks: { color: '#cbd5e1' } },
          y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(148,163,184,0.14)' } }
        }
      }
    });

    chartInstances.push(chart);
    return;
  }

  selected.forEach((columnIndex, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    const title = document.createElement('h3');
    title.textContent = currentSession.columns[columnIndex];
    title.style.margin = '0 0 10px';
    title.style.fontSize = '1rem';
    title.style.color = '#e2e8f0';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(title);
    wrapper.appendChild(canvas);
    chartArea.appendChild(wrapper);

    // adjust canvas width per metric
    const perPoint = 6;
    const w = Math.max(700, Math.round(labels.length * perPoint * timeScale));
    canvas.width = w;
    canvas.style.width = w + 'px';

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: currentSession.columns[columnIndex],
          data: currentSession.data.map((row) => row[columnIndex]),
          borderColor: palette[index % palette.length],
          backgroundColor: `${palette[index % palette.length]}33`,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        responsive: false,
        plugins: {
          legend: { display: false },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { title: { display: true, text: currentSession.columns[0], color: '#cbd5e1' }, ticks: { color: '#cbd5e1' } },
          y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(148,163,184,0.14)' } }
        }
      }
    });

    chartInstances.push(chart);
  });
}

// toggle archive visibility
if (toggleHistoryBtn && historyListEl) {
  toggleHistoryBtn.addEventListener('click', () => {
    historyListEl.classList.toggle('collapsed');
  });
}

fetchSessions();
