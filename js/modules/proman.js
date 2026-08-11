(function (global) {
  'use strict';

  const STORAGE_KEY = 'psm-proman-state-v1';
  const PAGE_SIZE = 40;
  const PLANT_CONFIG = {
    britagem: { label: 'PROMAN BRITAGEM', sheet: 'PROMAN - BRT' },
    fabrica: { label: 'PROMAN FÁBRICA', sheet: 'PROMAN - FAB' }
  };
  const BACKLOG_STATUS_VALUES = ['NO PRAZO', 'EM ANDAMENTO', 'PENDENTE', 'ATRASADA'];
  const BACKLOG_STATUS_SET = new Set(BACKLOG_STATUS_VALUES);
  const $ = selector => document.querySelector(selector);
  const normalize = value => String(value ?? '').trim();
  const upper = value => normalize(value).toLocaleUpperCase('pt-BR');
  const plain = value => upper(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const filterValues = value => [...new Set((Array.isArray(value) ? value : normalize(value) ? [value] : []).map(normalize).filter(Boolean))];
  const emptyPlant = () => ({ records: [], fileName: '', importedAt: '', filters: { search: '', status: [], year: [] }, page: 1 });
  const state = {
    activePlant: 'britagem',
    plants: { britagem: emptyPlant(), fabrica: emptyPlant() },
    backlogFilters: { plant: [], search: '', status: [], type: [] },
    charts: {}
  };
  let panelSearchTimer = 0;
  let backlogSearchTimer = 0;

  function schedulePanelSearch(plantKey, delay = 360) {
    global.clearTimeout(panelSearchTimer);
    panelSearchTimer = global.setTimeout(() => {
      panelSearchTimer = 0;
      if (state.activePlant !== plantKey) return;
      save();
      const records = filteredRecords();
      renderKpis(records);
      renderCharts(records);
      renderTable(records);
    }, delay);
  }

  function scheduleBacklogSearch(delay = 360) {
    global.clearTimeout(backlogSearchTimer);
    backlogSearchTimer = global.setTimeout(() => {
      backlogSearchTimer = 0;
      save();
      renderBacklog();
    }, delay);
  }

  function escapeHtml(value) {
    return normalize(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function parseExcelDate(value) {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && global.XLSX?.SSF?.parse_date_code) {
      const parsed = global.XLSX.SSF.parse_date_code(value);
      if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
    const text = normalize(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const br = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (br) return `${br[3].length === 2 ? `20${br[3]}` : br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '—';
    const [year, month, day] = value.split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  function recordId(record, index) {
    return `${record.date}|${record.tag}|${record.what}|${record.os}|${index}`;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) restoreProjectData(saved, false);
    } catch (error) {
      console.warn('Não foi possível restaurar os dados PROMAN.', error);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getProjectData()));
    } catch (error) {
      console.warn('Não foi possível salvar os dados PROMAN.', error);
    }
  }

  function getProjectData() {
    return {
      activePlant: state.activePlant,
      backlogFilters: { ...state.backlogFilters },
      plants: {
        britagem: { ...state.plants.britagem, page: 1 },
        fabrica: { ...state.plants.fabrica, page: 1 }
      }
    };
  }

  function restoreProjectData(payload, shouldRender = true) {
    if (!payload || typeof payload !== 'object') return;
    state.activePlant = payload.activePlant === 'fabrica' ? 'fabrica' : 'britagem';
    const savedBacklogFilters = payload.backlogFilters || {};
    state.backlogFilters = {
      plant: filterValues(savedBacklogFilters.plant).map(value => value === 'fabrica' ? 'fabrica' : 'britagem'),
      search: normalize(savedBacklogFilters.search),
      status: filterValues(savedBacklogFilters.status).map(upper),
      type: filterValues(savedBacklogFilters.type).map(upper)
    };
    Object.keys(PLANT_CONFIG).forEach(key => {
      const source = payload.plants?.[key] || {};
      state.plants[key] = {
        ...emptyPlant(),
        ...source,
        records: Array.isArray(source.records) ? source.records.map(record => ({
          ...record,
          plant: key,
          source: record.source === 'manual' ? 'manual' : 'imported',
          activityType: upper(record.activityType || 'NÃO'),
          status: automaticStatus(record.deadline, record.status)
        })) : [],
        filters: {
          search: normalize(source.filters?.search),
          status: filterValues(source.filters?.status).map(upper),
          year: filterValues(source.filters?.year)
        },
        page: 1
      };
    });
    save();
    if (shouldRender) render();
  }

  function findDataSheet(workbook, expectedName) {
    const exact = workbook.SheetNames.find(name => plain(name) === plain(expectedName));
    if (exact) return exact;
    let best = null;
    workbook.SheetNames.forEach(name => {
      const rows = global.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true });
      const headerIndex = rows.slice(0, 12).findIndex(row => row.some(cell => plain(cell) === 'STATUS') && row.some(cell => plain(cell) === 'TAG'));
      if (headerIndex >= 0 && (!best || rows.length > best.rows.length)) best = { name, rows, headerIndex };
    });
    return best?.name || workbook.SheetNames[0];
  }

  function headerIndexFor(rows) {
    return rows.slice(0, 15).findIndex(row => row.some(cell => plain(cell) === 'STATUS') && row.some(cell => plain(cell) === 'TAG'));
  }

  function indexOfHeader(headers, candidates) {
    return headers.findIndex(header => candidates.some(candidate => header === candidate || header.includes(candidate)));
  }

  function parseWorkbook(workbook, plantKey) {
    const sheetName = findDataSheet(workbook, PLANT_CONFIG[plantKey].sheet);
    const rows = global.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    const headerIndex = headerIndexFor(rows);
    if (headerIndex < 0) throw new Error('Não encontrei as colunas DATA, TAG e STATUS na planilha PROMAN.');
    const headers = rows[headerIndex].map(plain);
    const indexes = {
      date: indexOfHeader(headers, ['DATA']),
      tag: indexOfHeader(headers, ['TAG']),
      what: indexOfHeader(headers, ['O QUE', 'ATIVIDADE']),
      who: indexOfHeader(headers, ['QUEM', 'RESPONSAVEL']),
      deadline: indexOfHeader(headers, ['PRAZO']),
      status: indexOfHeader(headers, ['STATUS']),
      activityType: indexOfHeader(headers, ['TIPO DE ATIVIDADE', 'TIPO ATIVIDADE', 'TIPO']),
      os: indexOfHeader(headers, ['NOTA/OS', 'NOTA / OS', 'ORDEM']),
      notes: indexOfHeader(headers, ['OBSERVACOES', 'OBSERVACAO'])
    };
    return rows.slice(headerIndex + 1).map((row, index) => {
      const record = {
        date: parseExcelDate(row[indexes.date]),
        tag: upper(row[indexes.tag]),
        what: upper(row[indexes.what]),
        who: upper(row[indexes.who]),
        deadline: parseExcelDate(row[indexes.deadline]),
        status: upper(row[indexes.status]) || 'SEM STATUS',
        activityType: indexes.activityType >= 0 ? upper(row[indexes.activityType]) || 'NÃO' : 'NÃO',
        os: upper(row[indexes.os]),
        notes: normalize(row[indexes.notes]),
        plant: plantKey,
        source: 'imported'
      };
      record.id = recordId(record, index);
      return record;
    }).filter(record => record.date || record.tag || record.what || record.who || record.os || record.notes);
  }

  async function importWorkbook(file, plantKey = state.activePlant) {
    if (!global.XLSX) throw new Error('O leitor de planilhas não foi carregado.');
    const targetPlant = plantKey === 'fabrica' ? 'fabrica' : 'britagem';
    const data = await file.arrayBuffer();
    const workbook = global.XLSX.read(data, { type: 'array', cellDates: true });
    const records = parseWorkbook(workbook, targetPlant);
    const plant = state.plants[targetPlant];
    const manualRecords = plant.records.filter(record => record.source === 'manual');
    plant.records = [...records, ...manualRecords];
    plant.fileName = file.name;
    plant.importedAt = new Date().toISOString();
    plant.filters = { search: '', status: [], year: [] };
    plant.page = 1;
    state.activePlant = targetPlant;
    save();
    render();
    global.dispatchEvent(new CustomEvent('psm:proman-changed'));
    const preserved = manualRecords.length ? ` · ${manualRecords.length.toLocaleString('pt-BR')} adicionada(s) manualmente preservada(s)` : '';
    global.dispatchEvent(new CustomEvent('psm:toast', { detail: `${records.length.toLocaleString('pt-BR')} ações importadas e enviadas ao Backlog${preserved}` }));
  }

  function currentPlant() { return state.plants[state.activePlant]; }

  function dailyActivityId(plantKey, recordIdValue) { return `proman:${plantKey}:${recordIdValue}`; }

  function getDailyActivities() {
    refreshAutomaticStatuses();
    return Object.keys(PLANT_CONFIG).flatMap(plantKey => state.plants[plantKey].records
      .filter(record => !isCompleted(record) && !isCanceled(record))
      .map(record => ({
        id: dailyActivityId(plantKey, record.id),
        promanRecordId: record.id,
        isProman: true,
        promanPlant: plantKey,
        promanType: upper(record.activityType || 'NÃO'),
        ordem: record.os || record.tag || 'PROMAN',
        descricao: record.what || 'ATIVIDADE PROMAN',
        area: PLANT_CONFIG[plantKey].label.replace('PROMAN ', ''),
        oficina: 'PROMAN',
        equipamento: record.tag,
        responsavel: record.who,
        date: record.date,
        qpp: 'Rotina',
        tipoOrdem: 'NÃO SISTEMÁTICA',
        hh: 0,
        maoObra: 0,
        realizado: record.realizado === true || isCompleted(record)
      })));
  }

  function setDailyCompleted(dailyId, completed) {
    for (const plantKey of Object.keys(PLANT_CONFIG)) {
      const record = state.plants[plantKey].records.find(item => dailyActivityId(plantKey, item.id) === dailyId);
      if (!record) continue;
      record.realizado = Boolean(completed);
      save();
      render();
      global.dispatchEvent(new CustomEvent('psm:proman-changed'));
      return true;
    }
    return false;
  }

  function filteredRecords() {
    const plant = currentPlant();
    const search = plain(plant.filters.search);
    const selectedStatuses = new Set(filterValues(plant.filters.status).map(upper));
    const selectedYears = new Set(filterValues(plant.filters.year));
    return plant.records.filter(record => {
      if (selectedStatuses.size && !selectedStatuses.has(upper(record.status))) return false;
      if (selectedYears.size && !selectedYears.has(normalize(record.date).slice(0, 4))) return false;
      if (search && !plain(Object.values(record).join(' ')).includes(search)) return false;
      return true;
    });
  }

  function allBacklogRecords() {
    return Object.keys(PLANT_CONFIG).flatMap(plantKey => state.plants[plantKey].records
      .map(record => ({ ...record, plant: plantKey })));
  }

  function filteredBacklogRecords() {
    const filters = state.backlogFilters;
    const search = plain(filters.search);
    const selectedPlants = new Set(filterValues(filters.plant));
    const selectedStatuses = new Set(filterValues(filters.status).map(upper));
    const selectedTypes = new Set(filterValues(filters.type).map(upper));
    return allBacklogRecords().filter(record => {
      if (selectedPlants.size && !selectedPlants.has(record.plant)) return false;
      if (selectedStatuses.size && !selectedStatuses.has(upper(record.status))) return false;
      if (selectedTypes.size && !selectedTypes.has(upper(record.activityType || 'NÃO'))) return false;
      if (search && !plain([record.tag, record.what, record.who, record.os, record.notes].join(' ')).includes(search)) return false;
      return true;
    }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.tag || '').localeCompare(b.tag || '', 'pt-BR'));
  }

  function todayIso() { return new Date().toISOString().slice(0, 10); }

  function automaticStatus(deadline, status) {
    const current = upper(status) || 'NO PRAZO';
    if (/CONCLU|CANCEL/.test(current) || !deadline) return current;
    if (!BACKLOG_STATUS_SET.has(plain(current))) return current;
    if (deadline < todayIso()) return 'ATRASADA';
    return current === 'ATRASADA' ? 'NO PRAZO' : current;
  }

  function refreshAutomaticStatuses() {
    let changed = false;
    Object.values(state.plants).forEach(plant => plant.records.forEach(record => {
      const next = automaticStatus(record.deadline, record.status);
      if (next !== record.status) { record.status = next; changed = true; }
    }));
    if (changed) save();
  }

  function syncActivityDeadlineStatus() {
    const deadline = $('#promanActivityDeadline');
    const status = $('#promanActivityStatus');
    if (!deadline || !status) return;
    deadline.readOnly = false;
    deadline.disabled = false;
    status.value = automaticStatus(deadline.value, status.value);
  }

  function resetActivityForm(record = null) {
    const form = $('#promanActivityForm');
    if (!form) return;
    form.reset();
    $('#promanActivityId').value = record?.id || '';
    $('#promanActivityPlant').value = record?.plant || state.activePlant;
    $('#promanActivityDate').value = record?.date || todayIso();
    $('#promanActivityTag').value = record?.tag || '';
    $('#promanActivityWhat').value = record?.what || '';
    $('#promanActivityWho').value = record?.who || '';
    $('#promanActivityDeadline').value = record?.deadline || record?.date || '';
    $('#promanActivityStatus').value = record?.status || 'NO PRAZO';
    $('#promanActivityType').value = upper(record?.activityType || 'NÃO');
    $('#promanActivityOs').value = record?.os || '';
    $('#promanActivityNotes').value = record?.notes || '';
    $('#promanFormTitle').textContent = record ? 'EDITAR ATIVIDADE' : 'ADICIONAR ATIVIDADE';
    syncActivityDeadlineStatus();
  }

  function openActivityForm(record = null) {
    if (document.body.dataset.appMode === 'viewer') return;
    document.querySelector('[data-view="promanAdd"]')?.click();
    resetActivityForm(record);
    setTimeout(() => $('#promanActivityTag')?.focus(), 0);
  }

  function findPromanRecord(id) {
    for (const plantKey of Object.keys(PLANT_CONFIG)) {
      const index = state.plants[plantKey].records.findIndex(record => record.id === id);
      if (index >= 0) return { plantKey, index, record: state.plants[plantKey].records[index] };
    }
    return null;
  }

  function submitManualActivity(event) {
    event.preventDefault();
    if (document.body.dataset.appMode === 'viewer') return;
    const id = normalize($('#promanActivityId').value);
    const existing = id ? findPromanRecord(id) : null;
    const plantKey = $('#promanActivityPlant').value === 'fabrica' ? 'fabrica' : 'britagem';
    const record = {
      id: existing?.record.id || `proman-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: $('#promanActivityDate').value,
      tag: upper($('#promanActivityTag').value),
      what: upper($('#promanActivityWhat').value),
      who: upper($('#promanActivityWho').value),
      deadline: $('#promanActivityDeadline').value,
      status: automaticStatus($('#promanActivityDeadline').value, $('#promanActivityStatus').value),
      activityType: upper($('#promanActivityType').value) || 'NÃO',
      os: upper($('#promanActivityOs').value),
      notes: normalize($('#promanActivityNotes').value),
      plant: plantKey,
      source: existing?.record.source || 'manual',
      createdAt: existing?.record.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (existing) state.plants[existing.plantKey].records.splice(existing.index, 1);
    state.plants[plantKey].records.push(record);
    state.activePlant = plantKey;
    save();
    render();
    renderBacklog();
    global.dispatchEvent(new CustomEvent('psm:proman-changed'));
    resetActivityForm();
    document.querySelector('[data-view="promanBacklog"]')?.click();
    global.dispatchEvent(new CustomEvent('psm:toast', { detail: existing ? 'Atividade PROMAN atualizada' : 'Atividade PROMAN adicionada ao backlog' }));
  }

  function renderBacklog() {
    if (!$('#promanBacklogBody')) return;
    const filters = state.backlogFilters;
    $('#promanBacklogSearch').value = filters.search;
    const allRecords = allBacklogRecords();
    const statuses = [...new Set(allRecords.map(record => record.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const types = [...new Set(allRecords.map(record => record.activityType || 'NÃO').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    renderMultiSelect('promanBacklogPlant', [{ value: 'britagem', label: 'BRITAGEM' }, { value: 'fabrica', label: 'FÁBRICA' }], filters.plant, 'TODAS');
    renderMultiSelect('promanBacklogStatus', statuses, filters.status, 'TODOS OS STATUS');
    renderMultiSelect('promanBacklogType', types, filters.type, 'TODOS OS TIPOS');
    const records = filteredBacklogRecords();
    $('#promanBacklogTotal').textContent = records.length.toLocaleString('pt-BR');
    $('#promanBacklogOpen').textContent = records.filter(record => !isCompleted(record) && !isCanceled(record)).length.toLocaleString('pt-BR');
    $('#promanBacklogOverdue').textContent = records.filter(isOverdue).length.toLocaleString('pt-BR');
    $('#promanBacklogBody').innerHTML = records.length ? records.map((record, index) => `<tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(PLANT_CONFIG[record.plant].label.replace('PROMAN ', ''))}</strong></td>
      <td>${escapeHtml(formatDate(record.date))}</td>
      <td><strong>${escapeHtml(record.tag || '—')}</strong></td>
      <td class="proman-what">${escapeHtml(record.what || '—')}</td>
      <td>${escapeHtml(record.who || '—')}</td>
      <td>${escapeHtml(formatDate(record.deadline))}</td>
      <td><span class="proman-status ${statusClass(record.status)}">${escapeHtml(record.status)}</span></td>
      <td><span class="proman-activity-type">${escapeHtml(record.activityType || 'NÃO')}</span></td>
      <td>${escapeHtml(record.os || '—')}</td>
      <td class="proman-notes">${escapeHtml(record.notes || '—')}</td>
      <td><div class="proman-row-actions"><button type="button" data-proman-edit="${escapeHtml(record.id)}">EDITAR</button><button type="button" class="danger ghost" data-proman-delete="${escapeHtml(record.id)}">EXCLUIR</button></div></td>
    </tr>`).join('') : '<tr><td colspan="12" class="proman-empty">NENHUMA ATIVIDADE IMPORTADA OU MANUAL COM STATUS DE BACKLOG FOI ENCONTRADA.</td></tr>';
  }

  function groupCount(records, getter) {
    return records.reduce((groups, record) => {
      const key = getter(record) || 'NÃO INFORMADO';
      groups[key] = (groups[key] || 0) + 1;
      return groups;
    }, {});
  }

  function isCompleted(record) { return /CONCLU/.test(record.status); }
  function isCanceled(record) { return /CANCEL/.test(record.status); }
  function isOverdue(record) {
    if (isCompleted(record) || isCanceled(record) || !record.deadline) return false;
    return record.status.includes('ATRAS') || record.deadline < new Date().toISOString().slice(0, 10);
  }

  function renderMultiSelect(containerId, values, selected, allLabel) {
    const container = $(`#${containerId}`);
    if (!container) return;
    const items = values.map(item => typeof item === 'object' ? item : { value: item, label: item });
    const available = new Set(items.map(item => normalize(item.value)));
    const active = filterValues(selected).filter(value => available.has(normalize(value)));
    const activeSet = new Set(active.map(normalize));
    const button = container.querySelector('.proman-multi-button');
    const allInput = container.querySelector('[data-proman-all]');
    const options = container.querySelector('.proman-multi-options');
    if (button) button.textContent = active.length ? active.length === 1 ? items.find(item => normalize(item.value) === active[0])?.label || active[0] : `${active.length} SELECIONADOS` : allLabel;
    if (allInput) allInput.checked = !active.length;
    if (options) options.innerHTML = items.map(item => `<label class="proman-multi-option"><input type="checkbox" value="${escapeHtml(item.value)}" ${activeSet.has(normalize(item.value)) ? 'checked' : ''}><span>${escapeHtml(item.label)}</span></label>`).join('');
  }

  function renderImportStatus() {
    Object.keys(PLANT_CONFIG).forEach(plantKey => {
      const suffix = plantKey === 'fabrica' ? 'Fabrica' : 'Britagem';
      const target = $(`#promanImport${suffix}Status`);
      if (!target) return;
      const plant = state.plants[plantKey];
      const imported = plant.records.filter(record => record.source === 'imported');
      target.textContent = plant.fileName
        ? `${imported.length.toLocaleString('pt-BR')} IMPORTADAS · ${imported.length.toLocaleString('pt-BR')} NO BACKLOG · ${plant.fileName}`
        : 'NENHUMA PLANILHA IMPORTADA';
    });
  }

  function renderHeader() {
    const plant = currentPlant();
    document.querySelectorAll('[data-proman-tab]').forEach(button => {
      const active = button.dataset.promanTab === state.activePlant;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('#promanSearch').value = plant.filters.search;
    const statuses = [...new Set(plant.records.map(record => record.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const years = [...new Set(plant.records.map(record => record.date.slice(0, 4)).filter(year => /^\d{4}$/.test(year)))].sort((a, b) => b.localeCompare(a));
    renderMultiSelect('promanStatusFilter', statuses, plant.filters.status, 'TODOS OS STATUS');
    renderMultiSelect('promanYearFilter', years, plant.filters.year, 'TODOS OS ANOS');
    renderImportStatus();
  }

  function renderKpis(records) {
    const completed = records.filter(isCompleted).length;
    const overdue = records.filter(isOverdue).length;
    const open = records.filter(record => !isCompleted(record) && !isCanceled(record)).length;
    const withOs = records.filter(record => record.os).length;
    const pct = value => records.length ? Math.round(value / records.length * 100) : 0;
    $('#promanKpiTotal').textContent = records.length.toLocaleString('pt-BR');
    $('#promanKpiCompleted').textContent = completed.toLocaleString('pt-BR');
    $('#promanKpiCompletedPct').textContent = `${pct(completed)}% DO TOTAL`;
    $('#promanKpiOpen').textContent = open.toLocaleString('pt-BR');
    $('#promanKpiOverdue').textContent = overdue.toLocaleString('pt-BR');
    $('#promanKpiWithOs').textContent = withOs.toLocaleString('pt-BR');
    $('#promanKpiWithOsPct').textContent = `${pct(withOs)}% DO TOTAL`;
  }

  const promanLabelPlugin = {
    id: 'promanValueLabels',
    afterDatasetsDraw(chart) {
      if (!['bar', 'line'].includes(chart.config.type)) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '700 10px Inter, Segoe UI, sans-serif';
      ctx.fillStyle = document.documentElement.classList.contains('light') ? '#063568' : '#ffffff';
      ctx.textAlign = 'center';
      chart.data.datasets.forEach((dataset, dataSetIndex) => {
        chart.getDatasetMeta(dataSetIndex).data.forEach((element, index) => {
          const value = Number(dataset.data[index]) || 0;
          if (!value) return;
          const position = element.tooltipPosition();
          ctx.fillText(value.toLocaleString('pt-BR'), position.x, Math.max(12, position.y - 7));
        });
      });
      ctx.restore();
    }
  };

  function destroyChart(key) {
    if (state.charts[key]) state.charts[key].destroy();
    delete state.charts[key];
  }

  function createChart(key, canvas, config) {
    destroyChart(key);
    if (!global.Chart || !canvas) return;
    state.charts[key] = new global.Chart(canvas, { ...config, plugins: [...(config.plugins || []), promanLabelPlugin] });
  }

  function commonOptions(horizontal = false) {
    const dark = !document.documentElement.classList.contains('light');
    const textColor = dark ? '#d9ebfb' : '#315a7e';
    const gridColor = dark ? 'rgba(180,214,244,.12)' : 'rgba(0,79,158,.12)';
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#003f84', borderColor: '#98ca3d', borderWidth: 1 } },
      scales: {
        x: { beginAtZero: true, ticks: { color: textColor, font: { size: 10, weight: '600' } }, grid: { color: gridColor } },
        y: { beginAtZero: true, ticks: { color: textColor, font: { size: 10, weight: '600' } }, grid: { color: gridColor } }
      }
    };
  }

  function renderCharts(records) {
    const statusGroups = Object.entries(groupCount(records, record => record.status)).sort((a, b) => b[1] - a[1]);
    createChart('status', $('#promanStatusChart'), {
      type: 'doughnut',
      data: { labels: statusGroups.map(item => item[0]), datasets: [{ data: statusGroups.map(item => item[1]), backgroundColor: ['#98ca3d', '#008acb', '#ffb400', '#ef5b5b', '#7d8da1', '#4dbd74'], borderColor: '#ffffff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { display: true, position: 'bottom', labels: { color: document.documentElement.classList.contains('light') ? '#315a7e' : '#d9ebfb', boxWidth: 10, font: { size: 10, weight: '700' } } } } }
    });

    const monthGroups = Object.entries(groupCount(records.filter(record => record.date), record => record.date.slice(0, 7))).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
    createChart('monthly', $('#promanMonthlyChart'), {
      type: 'line',
      data: { labels: monthGroups.map(([month]) => month.split('-').reverse().join('/')), datasets: [{ label: 'AÇÕES', data: monthGroups.map(item => item[1]), borderColor: '#98ca3d', backgroundColor: 'rgba(152,202,61,.18)', fill: true, tension: .28, pointBackgroundColor: '#ffffff', pointBorderColor: '#008acb', pointRadius: 3 }] },
      options: commonOptions(false)
    });

    const ownerGroups = {};
    records.forEach(record => normalize(record.who).split(/\s*(?:\/|;|,|\bE\b)\s*/i).filter(Boolean).forEach(owner => { const key = upper(owner); ownerGroups[key] = (ownerGroups[key] || 0) + 1; }));
    const owners = Object.entries(ownerGroups).sort((a, b) => b[1] - a[1]).slice(0, 10);
    createChart('owners', $('#promanOwnersChart'), {
      type: 'bar',
      data: { labels: owners.map(item => item[0]), datasets: [{ data: owners.map(item => item[1]), backgroundColor: owners.map((_, index) => index === 0 ? '#98ca3d' : '#008acb'), borderRadius: 5 }] },
      options: commonOptions(true)
    });

    const tagGroups = Object.entries(groupCount(records, record => (record.tag.match(/^[A-Z0-9]{2}/) || ['SEM TAG'])[0])).sort((a, b) => b[1] - a[1]).slice(0, 12);
    createChart('tags', $('#promanTagsChart'), {
      type: 'bar',
      data: { labels: tagGroups.map(item => item[0]), datasets: [{ data: tagGroups.map(item => item[1]), backgroundColor: tagGroups.map((_, index) => index % 2 ? '#98ca3d' : '#0056a6'), borderRadius: 5 }] },
      options: commonOptions(false)
    });
  }

  function statusClass(status) {
    if (/CONCLU/.test(status)) return 'is-completed';
    if (/CANCEL/.test(status)) return 'is-canceled';
    if (/ATRAS/.test(status)) return 'is-overdue';
    if (/PRAZO/.test(status)) return 'is-on-time';
    return '';
  }

  function renderTable(records) {
    const plant = currentPlant();
    const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    plant.page = Math.min(Math.max(1, plant.page), pages);
    const start = (plant.page - 1) * PAGE_SIZE;
    const pageRows = records.slice(start, start + PAGE_SIZE);
    $('#promanTableCount').textContent = `${records.length.toLocaleString('pt-BR')} REGISTROS`;
    $('#promanPageInfo').textContent = `PÁGINA ${plant.page} DE ${pages}`;
    $('#promanPrevPage').disabled = plant.page <= 1;
    $('#promanNextPage').disabled = plant.page >= pages;
    $('#promanTableBody').innerHTML = pageRows.length ? pageRows.map(record => `<tr>
      <td>${escapeHtml(formatDate(record.date))}</td>
      <td><strong>${escapeHtml(record.tag || '—')}</strong></td>
      <td class="proman-what">${escapeHtml(record.what || '—')}</td>
      <td>${escapeHtml(record.who || '—')}</td>
      <td>${escapeHtml(formatDate(record.deadline))}</td>
      <td><span class="proman-status ${statusClass(record.status)}">${escapeHtml(record.status)}</span></td>
      <td><span class="proman-activity-type">${escapeHtml(record.activityType || 'NÃO')}</span></td>
      <td>${escapeHtml(record.os || '—')}</td>
      <td class="proman-notes">${escapeHtml(record.notes || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="proman-empty">IMPORTE UMA PLANILHA PROMAN OU AJUSTE OS FILTROS PARA VISUALIZAR AS AÇÕES.</td></tr>';
  }

  function render() {
    if (!$('#promanView')) return;
    refreshAutomaticStatuses();
    renderHeader();
    const records = filteredRecords();
    renderKpis(records);
    renderCharts(records);
    renderTable(records);
    renderBacklog();
  }

  function setPlant(key) {
    if (!PLANT_CONFIG[key]) return;
    state.activePlant = key;
    currentPlant().page = 1;
    save();
    render();
  }

  function exportCurrentPlant(plantKey = state.activePlant) {
    if (!global.XLSX) return;
    const targetPlant = plantKey === 'fabrica' ? 'fabrica' : 'britagem';
    const records = state.plants[targetPlant].records;
    if (!records.length) return;
    const rows = records.map(record => ({
      DATA: formatDate(record.date), TAG: record.tag, 'O QUE': record.what, QUEM: record.who,
      PRAZO: formatDate(record.deadline), STATUS: record.status, 'TIPO DE ATIVIDADE': record.activityType || 'NÃO', 'NOTA/OS': record.os, OBSERVAÇÕES: record.notes
    }));
    const workbook = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(workbook, global.XLSX.utils.json_to_sheet(rows), targetPlant === 'britagem' ? 'PROMAN - BRT' : 'PROMAN - FAB');
    global.XLSX.writeFile(workbook, `${PLANT_CONFIG[targetPlant].label.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportBacklog() {
    if (!global.XLSX) return;
    const records = filteredBacklogRecords();
    if (!records.length) {
      global.dispatchEvent(new CustomEvent('psm:toast', { detail: 'Nenhuma atividade no Backlog PROMAN para exportar' }));
      return;
    }
    const rows = records.map((record, index) => ({
      '#': index + 1,
      UNIDADE: PLANT_CONFIG[record.plant].label.replace('PROMAN ', ''),
      DATA: formatDate(record.date),
      TAG: record.tag,
      'O QUE': record.what,
      QUEM: record.who,
      PRAZO: formatDate(record.deadline),
      STATUS: record.status,
      'TIPO DE ATIVIDADE': record.activityType || 'NÃO',
      'NOTA / OS': record.os,
      OBSERVAÇÕES: record.notes
    }));
    const workbook = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(workbook, global.XLSX.utils.json_to_sheet(rows), 'BACKLOG PROMAN');
    global.XLSX.writeFile(workbook, `BACKLOG_PROMAN_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function setWorkspace(workspace) {
    const proman = workspace === 'proman';
    $('#psmNav').hidden = proman;
    $('#promanNav').hidden = !proman;
    $('#btnWorkspacePsm').classList.toggle('active', !proman);
    $('#btnWorkspaceProman').classList.toggle('active', proman);
    const target = document.querySelector(proman ? '[data-view="proman"]' : '[data-view="dashboard"]');
    target?.click();
  }

  function handleViewChange(view) {
    const proman = String(view || '').startsWith('proman');
    const title = $('#mainPageTitle');
    const subtitle = $('#subtitle');
    if (title) title.textContent = proman ? 'REUNIÃO PROMAN' : 'DASHBOARD PSM';
    if (subtitle) subtitle.hidden = proman;
    if (proman) {
      render();
      if (view === 'promanBacklog') renderBacklog();
    }
  }

  function wirePromanMulti(containerId, onChange) {
    const container = $(`#${containerId}`);
    if (!container) return;
    const button = container.querySelector('.proman-multi-button');
    const menu = container.querySelector('.proman-multi-menu');
    button?.addEventListener('click', event => {
      event.stopPropagation();
      const willOpen = menu.hidden;
      document.querySelectorAll('.proman-multi-menu').forEach(other => { if (other !== menu) other.hidden = true; });
      document.querySelectorAll('.proman-multi-button').forEach(other => { if (other !== button) other.setAttribute('aria-expanded', 'false'); });
      menu.hidden = !willOpen;
      button.setAttribute('aria-expanded', String(willOpen));
    });
    menu?.addEventListener('change', event => {
      const input = event.target;
      if (!input.matches('input[type="checkbox"]')) return;
      const allInput = menu.querySelector('[data-proman-all]');
      const valueInputs = [...menu.querySelectorAll('.proman-multi-options input[type="checkbox"]')];
      if (input.hasAttribute('data-proman-all') && input.checked) valueInputs.forEach(item => { item.checked = false; });
      if (!input.hasAttribute('data-proman-all')) allInput.checked = !valueInputs.some(item => item.checked);
      onChange(valueInputs.filter(item => item.checked).map(item => item.value));
    });
  }

  function clearPlantData(plantKey) {
    const targetPlant = plantKey === 'fabrica' ? 'fabrica' : 'britagem';
    const plant = state.plants[targetPlant];
    if (!plant.records.length) {
      global.dispatchEvent(new CustomEvent('psm:toast', { detail: `${PLANT_CONFIG[targetPlant].label} já está vazia` }));
      return;
    }
    if (!confirm(`Limpar todos os ${plant.records.length.toLocaleString('pt-BR')} registros de ${PLANT_CONFIG[targetPlant].label}?`)) return;
    state.plants[targetPlant] = emptyPlant();
    save();
    render();
    global.dispatchEvent(new CustomEvent('psm:proman-changed'));
  }

  function wire() {
    $('#btnWorkspacePsm')?.addEventListener('click', () => setWorkspace('psm'));
    $('#btnWorkspaceProman')?.addEventListener('click', () => setWorkspace('proman'));
    document.querySelector('[data-view="promanAdd"]')?.addEventListener('click', () => resetActivityForm());
    document.querySelectorAll('[data-proman-tab]').forEach(button => button.addEventListener('click', () => setPlant(button.dataset.promanTab)));
    [['promanImportBritagemInput', 'britagem'], ['promanImportFabricaInput', 'fabrica']].forEach(([inputId, plantKey]) => {
      $(`#${inputId}`)?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (file) importWorkbook(file, plantKey).catch(error => { console.error(error); alert(error.message || 'Não foi possível importar a planilha PROMAN.'); });
        event.target.value = '';
      });
    });
    $('#btnPromanClearBritagem')?.addEventListener('click', () => clearPlantData('britagem'));
    $('#btnPromanClearFabrica')?.addEventListener('click', () => clearPlantData('fabrica'));
    $('#btnPromanExportBritagem')?.addEventListener('click', () => exportCurrentPlant('britagem'));
    $('#btnPromanExportFabrica')?.addEventListener('click', () => exportCurrentPlant('fabrica'));
    $('#promanSearch')?.addEventListener('input', event => {
      const plantKey = state.activePlant;
      state.plants[plantKey].filters.search = event.target.value;
      state.plants[plantKey].page = 1;
      schedulePanelSearch(plantKey);
    });
    wirePromanMulti('promanStatusFilter', values => { currentPlant().filters.status = values; currentPlant().page = 1; save(); render(); });
    wirePromanMulti('promanYearFilter', values => { currentPlant().filters.year = values; currentPlant().page = 1; save(); render(); });
    $('#btnPromanClearFilters')?.addEventListener('click', () => { currentPlant().filters = { search: '', status: [], year: [] }; currentPlant().page = 1; save(); render(); });
    $('#promanPrevPage')?.addEventListener('click', () => { currentPlant().page--; renderTable(filteredRecords()); });
    $('#promanNextPage')?.addEventListener('click', () => { currentPlant().page++; renderTable(filteredRecords()); });
    $('#btnPromanBacklogExport')?.addEventListener('click', exportBacklog);
    $('#promanActivityForm')?.addEventListener('submit', submitManualActivity);
    $('#promanActivityDeadline')?.addEventListener('input', syncActivityDeadlineStatus);
    $('#promanActivityDeadline')?.addEventListener('change', syncActivityDeadlineStatus);
    $('#btnPromanCancelEdit')?.addEventListener('click', () => document.querySelector('[data-view="promanBacklog"]')?.click());
    $('#btnPromanOpenBacklog')?.addEventListener('click', () => document.querySelector('[data-view="promanBacklog"]')?.click());
    $('#btnPromanNewFromBacklog')?.addEventListener('click', () => openActivityForm());
    $('#promanBacklogSearch')?.addEventListener('input', event => {
      state.backlogFilters.search = event.target.value;
      scheduleBacklogSearch();
    });
    wirePromanMulti('promanBacklogPlant', values => { state.backlogFilters.plant = values; save(); renderBacklog(); });
    wirePromanMulti('promanBacklogStatus', values => { state.backlogFilters.status = values; save(); renderBacklog(); });
    wirePromanMulti('promanBacklogType', values => { state.backlogFilters.type = values; save(); renderBacklog(); });
    $('#btnPromanBacklogClearFilters')?.addEventListener('click', () => {
      state.backlogFilters = { plant: [], search: '', status: [], type: [] };
      save();
      renderBacklog();
    });
    $('#promanBacklogBody')?.addEventListener('click', event => {
      if (document.body.dataset.appMode === 'viewer') return;
      const editId = event.target.closest('[data-proman-edit]')?.dataset.promanEdit;
      if (editId) {
        const found = findPromanRecord(editId);
        if (found) openActivityForm({ ...found.record, plant: found.plantKey });
        return;
      }
      const deleteId = event.target.closest('[data-proman-delete]')?.dataset.promanDelete;
      if (!deleteId) return;
      const found = findPromanRecord(deleteId);
      if (!found || !confirm(`Excluir a atividade ${found.record.tag || found.record.what || ''} do backlog PROMAN?`)) return;
      state.plants[found.plantKey].records.splice(found.index, 1);
      save();
      render();
      renderBacklog();
      global.dispatchEvent(new CustomEvent('psm:proman-changed'));
      global.dispatchEvent(new CustomEvent('psm:toast', { detail: 'Atividade PROMAN excluída' }));
    });
    document.addEventListener('click', event => {
      document.querySelectorAll('.proman-multi-select').forEach(container => {
        if (container.contains(event.target)) return;
        const menu = container.querySelector('.proman-multi-menu');
        const button = container.querySelector('.proman-multi-button');
        if (menu) menu.hidden = true;
        button?.setAttribute('aria-expanded', 'false');
      });
    });
    global.addEventListener('psm:toast', event => {
      const toast = $('#toast');
      if (!toast) return;
      toast.textContent = event.detail;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2400);
    });
  }

  load();
  wire();
  render();
  global.PSMProMan = Object.freeze({ getProjectData, restoreProjectData, render, handleViewChange, setWorkspace, getDailyActivities, setDailyCompleted });
})(window);
