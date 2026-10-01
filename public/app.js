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
const zoomOutBtn = document.getElementById('zoomOut');
const zoomInBtn = document.getElementById('zoomIn');
const zoomDisplay = document.getElementById('zoomDisplay');
const presetsRow = document.getElementById('presetsRow');
const presetStatusHint = document.getElementById('presetStatusHint');

let timeScale = 1.0;
let sessions = [];
let currentSession = null;
let chartInstances = [];
let activePresetIndex = null;

function setMessage(text, isError = false) {
  if (!uploadMessage) return;
  uploadMessage.textContent = text;
  uploadMessage.style.color = isError ? '#f87171' : '#38bdf8';
}

function showPresetHint(text, type = 'normal') {
  if (!presetStatusHint) return;
  presetStatusHint.textContent = text;
  presetStatusHint.className = 'presets-hint';
  if (type === 'success') presetStatusHint.classList.add('success');
  else if (type === 'warning' || type === 'error') presetStatusHint.classList.add('warning');
}

function addChartFilename(wrapper) {
  if (!currentSession) return;
  const filename = document.createElement('div');
  filename.className = 'chart-filename';
  filename.textContent = currentSession.filename;
  wrapper.appendChild(filename);
}

// ----------------- PRESETS (5 SLOTS) -----------------
function getPresets() {
  try {
    return JSON.parse(localStorage.getItem('bimmerlink_presets') || '{}');
  } catch (e) {
    return {};
  }
}

function savePresets(presets) {
  localStorage.setItem('bimmerlink_presets', JSON.stringify(presets));
}

function renderPresets() {
  if (!presetsRow) return;
  presetsRow.innerHTML = '';
  const presets = getPresets();

  for (let i = 1; i <= 5; i++) {
    const saved = presets[i];
    const hasData = Array.isArray(saved) && saved.length > 0;

    const pill = document.createElement('div');
    pill.className = 'preset-pill' + (activePresetIndex === i ? ' active' : '');

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'preset-apply-btn';
    applyBtn.innerHTML = `Пресет ${i}${hasData ? ` <span class="preset-badge">${saved.length}</span>` : ''}`;
    applyBtn.title = hasData ? `Применить: ${saved.join(', ')}` : 'Пресет пуст. Выберите параметры и нажмите 💾';
    applyBtn.addEventListener('click', () => applyPreset(i));
    pill.appendChild(applyBtn);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'preset-save-btn';
    saveBtn.textContent = '💾';
    saveBtn.title = `Сохранить текущие выбранные параметры в Пресет ${i}`;
    saveBtn.addEventListener('click', () => savePreset(i));
    pill.appendChild(saveBtn);

    if (hasData) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'preset-clear-btn';
      clearBtn.textContent = '×';
      clearBtn.title = `Очистить Пресет ${i}`;
      clearBtn.addEventListener('click', (e) => clearPreset(i, e));
      pill.appendChild(clearBtn);
    }

    presetsRow.appendChild(pill);
  }
}

function applyPreset(index) {
  if (!currentSession) {
    showPresetHint('Сначала откройте запись из архива.', 'warning');
    return;
  }
  const presets = getPresets();
  const savedNames = presets[index];
  if (!savedNames || !savedNames.length) {
    showPresetHint(`Пресет ${index} пуст. Отметьте нужные параметры галочками и нажмите 💾`, 'warning');
    return;
  }

  const checkboxes = metricControls.querySelectorAll('input[type="checkbox"]');
  let matched = 0;
  checkboxes.forEach((cb) => {
    const colIndex = Number(cb.value);
    const colName = currentSession.columns[colIndex];
    if (savedNames.includes(colName)) {
      cb.checked = true;
      matched++;
    } else {
      cb.checked = false;
    }
  });

  activePresetIndex = index;
  renderPresets();
  createCharts();

  if (matched === 0) {
    showPresetHint(`В текущем логе нет параметров из Пресета ${index}.`, 'warning');
  } else {
    showPresetHint(`Применен Пресет ${index}: выбрано ${matched} из ${savedNames.length} пар.`, 'success');
  }
}

function savePreset(index) {
  if (!currentSession) {
    showPresetHint('Сначала откройте запись из архива.', 'warning');
    return;
  }
  const checkedBoxes = Array.from(metricControls.querySelectorAll('input[type="checkbox"]:checked'));
  if (checkedBoxes.length === 0) {
    showPresetHint('Выберите хотя бы один параметр галочкой.', 'warning');
    return;
  }

  const selectedNames = checkedBoxes.map((cb) => currentSession.columns[Number(cb.value)]);
  const presets = getPresets();
  presets[index] = selectedNames;
  savePresets(presets);

  activePresetIndex = index;
  renderPresets();
  showPresetHint(`✅ Сохранено в Пресет ${index} (${selectedNames.length} параметров)`, 'success');
}

function clearPreset(index, e) {
  if (e) e.stopPropagation();
  const presets = getPresets();
  if (presets[index]) {
    delete presets[index];
    savePresets(presets);
    if (activePresetIndex === index) activePresetIndex = null;
    renderPresets();
    showPresetHint(`Пресет ${index} очищен.`);
  }
}

// ----------------- SESSIONS & ARCHIVE -----------------
async function fetchSessions() {
  try {
    const response = await fetch('/api/sessions');
    if (!response.ok) {
      const text = await response.text();
      console.error('Server returned error:', text);
      return;
    }
    const json = await response.json();
    sessions = json.sessions || [];
    renderHistory();
  } catch (err) {
    console.error('Failed to fetch sessions:', err);
  }
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

// ----------------- UPLOAD -----------------
if (uploadForm) {
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMessage('');
    const formData = new FormData(uploadForm);
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Ошибка загрузки файла.');
      }
      setMessage('Файл сохранен в истории.');
      uploadForm.reset();
      await fetchSessions();
      await loadSession(result.id);
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

// ----------------- LOAD & DELETE SESSION -----------------
async function loadSession(sessionId) {
  try {
    const response = await fetch(`/api/session/${sessionId}`);
    if (!response.ok) {
      setMessage('Не удалось загрузить запись.', true);
      return;
    }
    currentSession = await response.json();
    activePresetIndex = null;
    renderMetricControls();
    renderMaxValues();
    renderPresets();
    createCharts();
    showPresetHint('Лог открыт. Выберите параметры или примените пресет.');
  } catch (err) {
    console.error('Error loading session:', err);
    setMessage('Ошибка загрузки записи.', true);
  }
}

async function deleteSession(sessionId) {
  if (!confirm('Вы уверены, что хотите удалить эту запись?')) return;
  try {
    const res = await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Ошибка удаления');
    setMessage('Запись удалена.');
    await fetchSessions();
    if (currentSession && currentSession.id === sessionId) {
      currentSession = null;
      activePresetIndex = null;
      renderMetricControls();
      renderMaxValues();
      renderPresets();
      createCharts();
    }
  } catch (err) {
    setMessage(err.message, true);
  }
}

// ----------------- METRICS & CHARTS -----------------
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
    checkbox.addEventListener('change', () => {
      activePresetIndex = null;
      renderPresets();
      createCharts();
    });
  });
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
  if (!currentSession) return [];
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

  const palette = [
    '#60a5fa', '#fbbf24', '#34d399', '#f472b6', '#a78bfa', '#38bdf8', '#f59e0b', '#22c55e', '#fb7185'
  ];

  if (displayMode === 'together') {
    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'chart-wrapper';
    addChartFilename(canvasWrapper);
    const canvas = document.createElement('canvas');
    canvasWrapper.appendChild(canvas);
    chartArea.appendChild(canvasWrapper);

    const basePerPoint = 6;
    const targetWidth = Math.max(800, Math.round(labels.length * basePerPoint * timeScale));
    canvas.width = targetWidth;
    canvas.style.width = targetWidth + 'px';
    const fixedHeight = 320;
    canvas.height = fixedHeight;
    canvas.style.height = fixedHeight + 'px';

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
    addChartFilename(wrapper);
    const title = document.createElement('h3');
    title.textContent = currentSession.columns[columnIndex];
    title.style.margin = '0 0 10px';
    title.style.fontSize = '1rem';
    title.style.color = '#e2e8f0';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(title);
    wrapper.appendChild(canvas);
    chartArea.appendChild(wrapper);

    const perPoint = 6;
    const w = Math.max(700, Math.round(labels.length * perPoint * timeScale));
    canvas.width = w;
    canvas.style.width = w + 'px';
    const fixedHeight = 320;
    canvas.height = fixedHeight;
    canvas.style.height = fixedHeight + 'px';

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

// ----------------- LISTENERS -----------------
displayModeInputs.forEach((input) => {
  input.addEventListener('change', createCharts);
});

if (zoomInBtn && zoomOutBtn && zoomDisplay) {
  const updateDisplay = () => { zoomDisplay.textContent = timeScale.toFixed(2) + 'x'; };
  zoomInBtn.addEventListener('click', () => {
    timeScale = Math.min(5, +(Math.round((timeScale + 0.25) * 100) / 100));
    updateDisplay();
    createCharts();
  });
  zoomOutBtn.addEventListener('click', () => {
    timeScale = Math.max(0.5, +(Math.round((timeScale - 0.25) * 100) / 100));
    updateDisplay();
    createCharts();
  });
  updateDisplay();
}

if (toggleHistoryBtn && historyListEl) {
  toggleHistoryBtn.addEventListener('click', () => {
    historyListEl.classList.toggle('collapsed');
  });
}

// Initial setup
renderPresets();
fetchSessions();
