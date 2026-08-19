(function (global) {
  'use strict';

  const STORAGE_KEY = 'psm-proman-state-v1';
  const ACTIVITY_TYPES_KEY = 'psm-proman-activity-types-v1';
  const REMOVED_ACTIVITY_TYPES_KEY = 'psm-proman-removed-activity-types-v1';
  const ACCESS_FILTERS_KEY = 'psm-proman-access-filters-v1';
  const PAGE_SIZE = 40;
  const PLANT_CONFIG = {
    britagem: { label: 'PROMAN BRITAGEM', sheet: 'PROMAN - BRT' },
    fabrica: { label: 'PROMAN FÁBRICA', sheet: 'PROMAN - FAB' }
  };
  const BACKLOG_STATUS_VALUES = ['NO PRAZO', 'EM ANDAMENTO', 'PENDENTE', 'ATRASADA'];
  const STATUS_VALUES = [...BACKLOG_STATUS_VALUES, 'CONCLUÍDA', 'CANCELADA'];
  const DEFAULT_ACTIVITY_TYPES = ['NÃO', 'SEGURANÇA', 'OPORTUNIDADE', 'CORRETIVA'];
  const BACKLOG_STATUS_SET = new Set(BACKLOG_STATUS_VALUES);
  const $ = selector => document.querySelector(selector);
  const normalize = value => String(value ?? '').trim();
  const upper = value => normalize(value).toLocaleUpperCase('pt-BR');
  const plain = value => upper(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const filterValues = value => [...new Set((Array.isArray(value) ? value : normalize(value) ? [value] : []).map(normalize).filter(Boolean))];
  const emptyPlant = () => ({ records: [], fileName: '', importedAt: '', filters: { search: '', status: [], year: [], week: [] }, page: 1 });
  const state = {
    activePlant: 'britagem',
    plants: { britagem: emptyPlant(), fabrica: emptyPlant() },
    panelFilters: { plant: ['britagem'], search: '', status: [], year: [], week: [] },
    panelPage: 1,
    backlogFilters: { plant: [], search: '', status: [], type: [], week: [], year: [] },
    backlogSort: { key: 'date', direction: 'desc' },
    charts: {}
  };
  let panelSearchTimer = 0;
  let backlogSearchTimer = 0;
  let accessMode = '';
  let activeView = '';

  function accessFilterBanks() {
    try { return JSON.parse(localStorage.getItem(ACCESS_FILTERS_KEY)) || {}; } catch { return {}; }
  }

  function setAccessMode(mode) {
    const banks = accessFilterBanks();
    if (accessMode) banks[accessMode] = { panelFilters: { ...state.panelFilters }, backlogFilters: { ...state.backlogFilters } };
    if (mode) {
      const saved = banks[mode] || {};
      state.panelFilters = { plant: filterValues(saved.panelFilters?.plant), search: normalize(saved.panelFilters?.search), status: filterValues(saved.panelFilters?.status).map(upper), year: filterValues(saved.panelFilters?.year), week: filterValues(saved.panelFilters?.week) };
      state.backlogFilters = { plant: filterValues(saved.backlogFilters?.plant), search: normalize(saved.backlogFilters?.search), status: filterValues(saved.backlogFilters?.status).map(upper), type: filterValues(saved.backlogFilters?.type).map(upper), week: filterValues(saved.backlogFilters?.week), year: filterValues(saved.backlogFilters?.year) };
      state.panelPage = 1;
    }
    localStorage.setItem(ACCESS_FILTERS_KEY, JSON.stringify(banks));
    accessMode = mode;
    if (mode) render();
  }

  function schedulePanelSearch(delay = 360) {
    global.clearTimeout(panelSearchTimer);
    panelSearchTimer = global.setTimeout(() => {
      panelSearchTimer = 0;
      save();
      renderHeader();
      const records = filteredRecords();
      renderKpis(records);
      renderCharts(records);
      renderTable(records);
    }, delay);
  }

  function dateFromIso(value) {
    const match = normalize(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  }

  function isoDate(date) {
    return date ? date.toISOString().slice(0, 10) : '';
  }

  function addUtcDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  function weekInfo(value) {
    const date = dateFromIso(value);
    if (!date) return null;
    const monday = addUtcDays(date, -((date.getUTCDay() + 6) % 7));
    const thursday = addUtcDays(monday, 3);
    const year = thursday.getUTCFullYear();
    const january4 = new Date(Date.UTC(year, 0, 4));
    const firstMonday = addUtcDays(january4, -((january4.getUTCDay() + 6) % 7));
    const calculated = 1 + Math.round((monday - firstMonday) / 604800000);
    const week = Math.max(1, Math.min(52, calculated));
    const friday = addUtcDays(monday, 4);
    return {
      key: `${year}-W${String(week).padStart(2, '0')}`,
      week,
      monday: isoDate(monday),
      friday: isoDate(friday),
      label: `SEMANA ${String(week).padStart(2, '0')} · ${formatDate(isoDate(monday))} A ${formatDate(isoDate(friday))}`
    };
  }

  function weekOptions(records) {
    const options = new Map();
    records.forEach(record => {
      const info = weekInfo(record.date);
      if (info) options.set(info.key, { value: info.key, label: info.label });
    });
    return [...options.values()].sort((a, b) => a.value.localeCompare(b.value));
  }

  function weekYear(value) {
    return weekInfo(value)?.key.slice(0, 4) || '';
  }

  function facetValue(record, facet) {
    if (facet === 'plant') return record.plant;
    if (facet === 'status') return upper(record.status);
    if (facet === 'type') return upper(record.activityType || 'NÃO');
    if (facet === 'year') return weekYear(record.date);
    if (facet === 'week') return weekInfo(record.date)?.key || '';
    return '';
  }

  function recordMatchesFacets(record, filters, omittedFacet = '', includeType = false, applySearch = true) {
    const search = applySearch ? plain(filters.search) : '';
    if (search && !plain(Object.values(record).join(' ')).includes(search)) return false;
    const facets = includeType ? ['plant', 'status', 'type', 'year', 'week'] : ['plant', 'status', 'year', 'week'];
    return facets.every(facet => {
      if (facet === omittedFacet) return true;
      const selected = new Set(filterValues(filters[facet]).map(value => facet === 'status' || facet === 'type' ? upper(value) : value));
      return !selected.size || selected.has(facetValue(record, facet));
    });
  }

  function contextualFacetOptions(records, filters, facet, includeType = false) {
    const candidates = records.filter(record => recordMatchesFacets(record, filters, facet, includeType, false));
    if (facet === 'week') return weekOptions(candidates);
    const values = [...new Set(candidates.map(record => facetValue(record, facet)).filter(Boolean))];
    if (facet === 'plant') {
      return values.sort().map(value => ({ value, label: PLANT_CONFIG[value]?.label.replace('PROMAN ', '') || upper(value) }));
    }
    return values.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
  }

  function reconcileContextualFilters(records, filters, includeType = false) {
    const facets = includeType ? ['plant', 'status', 'type', 'year', 'week'] : ['plant', 'status', 'year', 'week'];
    let changed = false;
    for (let pass = 0; pass < facets.length; pass++) {
      let passChanged = false;
      facets.forEach(facet => {
        const options = contextualFacetOptions(records, filters, facet, includeType);
        const available = new Set(options.map(item => normalize(typeof item === 'object' ? item.value : item)));
        const current = filterValues(filters[facet]);
        const next = current.filter(value => available.has(normalize(value)));
        if (next.length !== current.length) {
          filters[facet] = next;
          passChanged = true;
          changed = true;
        }
      });
      if (!passChanged) break;
    }
    return changed;
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
      if (accessMode) {
        const banks = accessFilterBanks();
        banks[accessMode] = { panelFilters: { ...state.panelFilters }, backlogFilters: { ...state.backlogFilters } };
        localStorage.setItem(ACCESS_FILTERS_KEY, JSON.stringify(banks));
      }
    } catch (error) {
      console.warn('Não foi possível salvar os dados PROMAN.', error);
    }
  }

  function getProjectData() {
    return {
      activePlant: state.activePlant,
      panelFilters: { ...state.panelFilters },
      backlogFilters: { ...state.backlogFilters },
      backlogSort: { ...state.backlogSort },
      activityTypes: customActivityTypes(),
      removedActivityTypes: [...removedActivityTypes()],
      plants: {
        britagem: { ...state.plants.britagem, page: 1 },
        fabrica: { ...state.plants.fabrica, page: 1 }
      }
    };
  }

  function restoreProjectData(payload, shouldRender = true) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.activityTypes)) saveCustomActivityTypes(payload.activityTypes);
    if (Array.isArray(payload.removedActivityTypes)) {
      localStorage.setItem(REMOVED_ACTIVITY_TYPES_KEY, JSON.stringify(filterValues(payload.removedActivityTypes).map(upper)));
    }
    state.activePlant = payload.activePlant === 'fabrica' ? 'fabrica' : 'britagem';
    const savedPanelFilters = payload.panelFilters || payload.plants?.[state.activePlant]?.filters || {};
    state.panelFilters = {
      plant: filterValues(savedPanelFilters.plant || [state.activePlant]).map(value => value === 'fabrica' ? 'fabrica' : 'britagem'),
      search: normalize(savedPanelFilters.search),
      status: filterValues(savedPanelFilters.status).map(upper),
      year: filterValues(savedPanelFilters.year),
      week: filterValues(savedPanelFilters.week)
    };
    state.panelPage = 1;
    const savedBacklogFilters = payload.backlogFilters || {};
    state.backlogFilters = {
      plant: filterValues(savedBacklogFilters.plant).map(value => value === 'fabrica' ? 'fabrica' : 'britagem'),
      search: normalize(savedBacklogFilters.search),
      status: filterValues(savedBacklogFilters.status).map(upper),
      type: filterValues(savedBacklogFilters.type).map(upper),
      week: filterValues(savedBacklogFilters.week),
      year: filterValues(savedBacklogFilters.year)
    };
    state.backlogSort = {
      key: normalize(payload.backlogSort?.key) || 'date',
      direction: payload.backlogSort?.direction === 'asc' ? 'asc' : 'desc'
    };
    Object.keys(PLANT_CONFIG).forEach(key => {
      const source = payload.plants?.[key] || {};
      state.plants[key] = {
        ...emptyPlant(),
        ...source,
        records: Array.isArray(source.records) ? source.records.map((record, index) => ({
          ...record,
          id: normalize(record.id) || recordId(record, index),
          plant: key,
          source: record.source === 'manual' ? 'manual' : 'imported',
          activityType: upper(record.activityType || 'NÃO'),
          completionDate: parseExcelDate(record.completionDate),
          status: automaticStatus(record.deadline, record.status),
          realizado: /CONCLU/.test(upper(record.status))
        })) : [],
        filters: {
          search: normalize(source.filters?.search),
          status: filterValues(source.filters?.status).map(upper),
          year: filterValues(source.filters?.year),
          week: filterValues(source.filters?.week)
        },
        page: 1
      };
    });
    const restoredRecords = allBacklogRecords();
    reconcileContextualFilters(restoredRecords, state.panelFilters, false);
    reconcileContextualFilters(restoredRecords, state.backlogFilters, true);
    save();
    if (shouldRender) render();
  }

  function getSharedData() {
    const sharedPlant = plant => ({
      records: plant.records,
      fileName: plant.fileName,
      importedAt: plant.importedAt
    });
    return {
      plants: {
        britagem: sharedPlant(state.plants.britagem),
        fabrica: sharedPlant(state.plants.fabrica)
      },
      activityTypes: customActivityTypes(),
      removedActivityTypes: [...removedActivityTypes()]
    };
  }

  function restoreSharedData(payload, shouldRender = true) {
    if (!payload || typeof payload !== 'object') return;
    const current = getProjectData();
    const mergePlant = key => ({
      ...current.plants[key],
      ...(payload.plants?.[key] || {}),
      filters: current.plants[key].filters,
      page: 1
    });
    restoreProjectData({
      ...current,
      activityTypes: Array.isArray(payload.activityTypes) ? payload.activityTypes : current.activityTypes,
      removedActivityTypes: Array.isArray(payload.removedActivityTypes) ? payload.removedActivityTypes : current.removedActivityTypes,
      plants: {
        britagem: mergePlant('britagem'),
        fabrica: mergePlant('fabrica')
      }
    }, shouldRender);
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
      completionDate: indexOfHeader(headers, ['DATA DE CONCLUSAO', 'DATA CONCLUSAO', 'CONCLUSAO']),
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
        completionDate: indexes.completionDate >= 0 ? parseExcelDate(row[indexes.completionDate]) : '',
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
    plant.filters = { search: '', status: [], year: [], week: [] };
    plant.page = 1;
    state.activePlant = targetPlant;
    state.panelFilters = { plant: [targetPlant], search: '', status: [], year: [], week: [] };
    state.panelPage = 1;
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
      .filter(record => record.realizado === true || ['ATRASADA', 'NO PRAZO'].includes(plain(record.status)))
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

  function setDailyCompleted(dailyId, completed, recordIdValue = '', plantHint = '', osHint = '', whatHint = '') {
    const hintedPlant = PLANT_CONFIG[plantHint] ? plantHint : '';
    const plants = hintedPlant ? [hintedPlant] : Object.keys(PLANT_CONFIG);
    for (const plantKey of plants) {
      const expectedRecordId = normalize(recordIdValue);
      const expectedOs = plain(osHint);
      const expectedWhat = plain(whatHint);
      let record = state.plants[plantKey].records.find(item =>
        (expectedRecordId && normalize(item.id) === expectedRecordId) || dailyActivityId(plantKey, item.id) === dailyId
      );
      if (!record && expectedOs) record = state.plants[plantKey].records.find(item => plain(item.os) === expectedOs);
      if (!record && expectedWhat) record = state.plants[plantKey].records.find(item => plain(item.what) === expectedWhat);
      if (!record) continue;
      if (completed) {
        applyPromanStatus(record, 'CONCLUÍDA');
      } else {
        const restoreStatus = record.statusBeforeCompletion || 'NO PRAZO';
        applyPromanStatus(record, restoreStatus);
      }
      save();
      global.dispatchEvent(new CustomEvent('psm:proman-changed'));
      try {
        render();
      } catch (error) {
        console.error('A atividade foi atualizada, mas o painel PROMAN não pôde ser redesenhado.', error);
      }
      return true;
    }
    return false;
  }

  function filteredRecords() {
    const filters = state.panelFilters;
    return allBacklogRecords().filter(record => recordMatchesFacets(record, filters, '', false));
  }

  function allBacklogRecords() {
    return Object.keys(PLANT_CONFIG).flatMap(plantKey => state.plants[plantKey].records
      .map(record => ({ ...record, plant: plantKey })));
  }

  function filteredBacklogRecords() {
    const filters = state.backlogFilters;
    const records = allBacklogRecords().filter(record => recordMatchesFacets(record, filters, '', true));
    return sortBacklogRecords(records);
  }

  function compareBacklogValues(a, b, key) {
    const plantLabel = record => PLANT_CONFIG[record.plant]?.label || record.plant;
    const statusRank = value => ({ 'ATRASADA': 6, 'PENDENTE': 5, 'EM ANDAMENTO': 4, 'NO PRAZO': 3, 'CONCLUÍDA': 2, 'CANCELADA': 1 }[upper(value)] || 0);
    const getters = {
      plant: plantLabel,
      date: record => record.date || '',
      tag: record => record.tag || '',
      what: record => record.what || '',
      who: record => record.who || '',
      deadline: record => record.deadline || '',
      completionDate: record => record.completionDate || '',
      status: record => statusRank(record.status),
      activityType: record => record.activityType || '',
      os: record => record.os || '',
      notes: record => record.notes || ''
    };
    const getter = getters[key] || getters.date;
    const left = getter(a);
    const right = getter(b);
    if (typeof left === 'number' || typeof right === 'number') return Number(left) - Number(right);
    return String(left).localeCompare(String(right), 'pt-BR', { numeric: true, sensitivity: 'base' });
  }

  function sortBacklogRecords(records) {
    const { key, direction } = state.backlogSort;
    const factor = direction === 'asc' ? 1 : -1;
    return [...records].sort((a, b) => factor * compareBacklogValues(a, b, key) || (a.tag || '').localeCompare(b.tag || '', 'pt-BR', { numeric: true }));
  }

  function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function automaticStatus(deadline, status) {
    const current = upper(status) || 'NO PRAZO';
    if (/CONCLU|CANCEL/.test(current) || !deadline) return current;
    if (!BACKLOG_STATUS_SET.has(plain(current))) return current;
    if (deadline < todayIso()) return 'ATRASADA';
    return current;
  }

  function applyPromanStatus(record, requestedStatus) {
    const previous = upper(record.status) || 'NO PRAZO';
    const requested = upper(requestedStatus) || 'NO PRAZO';
    const next = automaticStatus(record.deadline, requested);
    const wasCompleted = /CONCLU/.test(previous);
    const wasRealized = record.realizado === true;
    const completed = /CONCLU/.test(next);
    if (completed) {
      if (!wasCompleted) record.statusBeforeCompletion = previous;
      record.status = 'CONCLUÍDA';
      record.realizado = true;
      if (!record.completionDate) record.completionDate = todayIso();
    } else {
      record.status = next;
      record.realizado = false;
      if (wasCompleted || wasRealized || /CANCEL/.test(next)) record.completionDate = '';
      delete record.statusBeforeCompletion;
    }
    record.updatedAt = new Date().toISOString();
    return { previous, status: record.status };
  }

  function applyPromanCompletionDate(record, value) {
    const completionDate = parseExcelDate(value);
    if (completionDate) {
      record.completionDate = completionDate;
      return applyPromanStatus(record, 'CONCLUÍDA');
    }
    const restoreStatus = record.statusBeforeCompletion || 'NO PRAZO';
    record.completionDate = '';
    if (/CONCLU/.test(upper(record.status)) || record.realizado === true) return applyPromanStatus(record, restoreStatus);
    record.updatedAt = new Date().toISOString();
    return { previous: upper(record.status), status: record.status };
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
    $('#promanActivityCompletionDate').value = record?.completionDate || '';
    $('#promanActivityStatus').value = record?.status || 'NO PRAZO';
    $('#promanActivityType').value = upper(record?.activityType || 'NÃO');
    updateActivityTypeOptions();
    $('#promanActivityOs').value = record?.os || '';
    $('#promanActivityNotes').value = record?.notes || '';
    $('#promanFormTitle').textContent = record ? 'EDITAR ATIVIDADE' : 'ADICIONAR ATIVIDADE';
    syncActivityDeadlineStatus();
  }

  function updateActivityTypeOptions() {
    const select = $('#promanActivityType');
    if (!select) return;
    const current = upper(select.value || 'NÃO');
    const types = activityTypeValues(current);
    select.innerHTML = types.map(type => `<option value="${escapeHtml(type)}" ${type === current ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('');
  }

  function customActivityTypes() {
    try { return filterValues(JSON.parse(localStorage.getItem(ACTIVITY_TYPES_KEY))).map(upper); } catch { return []; }
  }

  function removedActivityTypes() {
    try { return new Set(filterValues(JSON.parse(localStorage.getItem(REMOVED_ACTIVITY_TYPES_KEY))).map(upper)); } catch { return new Set(); }
  }

  function saveCustomActivityTypes(types) {
    localStorage.setItem(ACTIVITY_TYPES_KEY, JSON.stringify([...new Set(types.map(upper).filter(Boolean))]));
  }

  function activityTypeValues(current = '') {
    const removed = removedActivityTypes();
    return [...new Set([...DEFAULT_ACTIVITY_TYPES.filter(type => !removed.has(type)), ...customActivityTypes().filter(type => !removed.has(type)), upper(current)].filter(Boolean))];
  }

  function activityTypeOptionsHtml(currentType) {
    const current = upper(currentType || 'NÃO');
    return activityTypeValues(current).map(type => `<option value="${escapeHtml(type)}" ${type === current ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('');
  }

  function renderTypeManager(message = '') {
    const list = $('#promanTypeManagerList');
    if (list) list.innerHTML = activityTypeValues().map(type => `<div><strong>${escapeHtml(type)}</strong>${DEFAULT_ACTIVITY_TYPES.includes(type) ? '<span>INICIAL</span>' : ''}<button type="button" class="danger ghost" data-proman-type-remove="${escapeHtml(type)}">REMOVER</button></div>`).join('');
    const status = $('#promanTypeManagerMessage');
    if (status) { status.textContent = message; status.hidden = !message; }
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
    const requestedStatus = $('#promanActivityStatus').value;
    const record = {
      id: existing?.record.id || `proman-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: $('#promanActivityDate').value,
      tag: upper($('#promanActivityTag').value),
      what: upper($('#promanActivityWhat').value),
      who: upper($('#promanActivityWho').value),
      deadline: $('#promanActivityDeadline').value,
      completionDate: $('#promanActivityCompletionDate').value,
      status: existing?.record.status || requestedStatus,
      activityType: upper($('#promanActivityType').value) || 'NÃO',
      os: upper($('#promanActivityOs').value),
      notes: normalize($('#promanActivityNotes').value),
      plant: plantKey,
      source: existing?.record.source || 'manual',
      realizado: existing?.record.realizado === true,
      statusBeforeCompletion: existing?.record.statusBeforeCompletion,
      createdAt: existing?.record.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (record.completionDate) applyPromanCompletionDate(record, record.completionDate);
    else applyPromanStatus(record, requestedStatus);
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

  function statusOptionsHtml(currentStatus) {
    const current = upper(currentStatus) || 'NO PRAZO';
    const values = STATUS_VALUES.some(value => upper(value) === current) ? STATUS_VALUES : [current, ...STATUS_VALUES];
    return values.map(status => `<option value="${escapeHtml(status)}" ${current === upper(status) ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('');
  }

  function statusInlineStyle(status) {
    const value = upper(status);
    if (/CONCLU/.test(value)) return 'background-color:#eaf6d7;border-color:#98ca3d;color:#4e8200;-webkit-text-fill-color:#4e8200';
    if (/CANCEL/.test(value)) return 'background-color:#eef1f5;border-color:#7d8da1;color:#5f6f82;-webkit-text-fill-color:#5f6f82';
    if (/ATRAS/.test(value)) return 'background-color:#ffe6e6;border-color:#ef5b5b;color:#d93636;-webkit-text-fill-color:#d93636';
    if (/EM ANDAMENTO/.test(value)) return 'background-color:#fff0e2;border-color:#f58220;color:#b95400;-webkit-text-fill-color:#b95400';
    if (/PENDENTE/.test(value)) return 'background-color:#fff6d6;border-color:#ffb400;color:#8a5c00;-webkit-text-fill-color:#8a5c00';
    return 'background-color:#e6f5fc;border-color:#008acb;color:#0073ad;-webkit-text-fill-color:#0073ad';
  }

  function renderBacklog() {
    if (!$('#promanBacklogBody')) return;
    const filters = state.backlogFilters;
    $('#promanBacklogSearch').value = filters.search;
    const allRecords = allBacklogRecords();
    const filtersChanged = reconcileContextualFilters(allRecords, filters, true);
    const plantOptions = contextualFacetOptions(allRecords, filters, 'plant', true);
    const weekOptionsList = contextualFacetOptions(allRecords, filters, 'week', true);
    const yearOptions = contextualFacetOptions(allRecords, filters, 'year', true);
    const statusOptions = contextualFacetOptions(allRecords, filters, 'status', true);
    const typeOptions = contextualFacetOptions(allRecords, filters, 'type', true);
    renderMultiSelect('promanBacklogPlant', plantOptions, filters.plant, 'TODAS');
    renderMultiSelect('promanBacklogWeek', weekOptionsList, filters.week, 'TODAS AS SEMANAS');
    renderMultiSelect('promanBacklogYear', yearOptions, filters.year, 'TODOS OS ANOS');
    renderMultiSelect('promanBacklogStatus', statusOptions, filters.status, 'TODOS OS STATUS');
    renderMultiSelect('promanBacklogType', typeOptions, filters.type, 'TODOS OS TIPOS');
    if (filtersChanged) save();
    const records = filteredBacklogRecords();
    updateBacklogSortHeaders();
    $('#promanBacklogTotal').textContent = records.length.toLocaleString('pt-BR');
    $('#promanBacklogOpen').textContent = records.filter(record => !isCompleted(record) && !isCanceled(record)).length.toLocaleString('pt-BR');
    $('#promanBacklogOverdue').textContent = records.filter(isOverdue).length.toLocaleString('pt-BR');
    const viewer = document.body.dataset.appMode === 'viewer';
    const inlineText = (record, field, value) => viewer ? escapeHtml(value || '—') : `<span class="proman-inline-value" contenteditable="true" data-proman-inline-id="${escapeHtml(record.id)}" data-proman-inline-field="${field}" data-proman-inline-before="${escapeHtml(value || '')}" role="textbox">${escapeHtml(value || '—')}</span>`;
    $('#promanBacklogBody').innerHTML = records.length ? records.map((record, index) => `<tr>
      <td>${index + 1}</td>
      <td>${viewer ? `<strong>${escapeHtml(PLANT_CONFIG[record.plant].label.replace('PROMAN ', ''))}</strong>` : `<select class="proman-inline-select" data-proman-plant-id="${escapeHtml(record.id)}"><option value="britagem" ${record.plant==='britagem'?'selected':''}>BRITAGEM</option><option value="fabrica" ${record.plant==='fabrica'?'selected':''}>FÁBRICA</option></select>`}</td>
      <td>${viewer ? escapeHtml(formatDate(record.date)) : `<input type="date" class="proman-inline-date" data-proman-date-id="${escapeHtml(record.id)}" data-proman-date-field="date" value="${escapeHtml(record.date || '')}">`}</td>
      <td><strong>${inlineText(record, 'tag', record.tag)}</strong></td>
      <td class="proman-what" title="${escapeHtml(record.what || '—')}">${inlineText(record, 'what', record.what)}</td>
      <td>${inlineText(record, 'who', record.who)}</td>
      <td>${viewer ? escapeHtml(formatDate(record.deadline)) : `<input type="date" class="proman-inline-date" data-proman-date-id="${escapeHtml(record.id)}" data-proman-date-field="deadline" value="${escapeHtml(record.deadline || '')}">`}</td>
      <td>${viewer ? escapeHtml(formatDate(record.completionDate)) : `<input type="date" class="proman-completion-date" data-proman-completion-id="${escapeHtml(record.id)}" value="${escapeHtml(record.completionDate || '')}" aria-label="Data de conclusão da atividade ${escapeHtml(record.tag || record.what)}">`}</td>
      <td>${viewer ? `<span class="proman-status ${statusClass(record.status)}">${escapeHtml(record.status)}</span>` : `<select class="proman-status-select ${statusClass(record.status)}" style="${statusInlineStyle(record.status)}" data-proman-status-id="${escapeHtml(record.id)}" data-proman-status-plant="${escapeHtml(record.plant)}" aria-label="Alterar status da atividade ${escapeHtml(record.tag || record.what)}">${statusOptionsHtml(record.status)}</select>`}</td>
      <td>${viewer ? `<span class="proman-activity-type">${escapeHtml(record.activityType || 'NÃO')}</span>` : `<select class="proman-status-select proman-type-select" data-proman-type-id="${escapeHtml(record.id)}" aria-label="Alterar tipo da atividade ${escapeHtml(record.tag || record.what)}">${activityTypeOptionsHtml(record.activityType)}</select>`}</td>
      <td>${inlineText(record, 'os', record.os)}</td>
      <td class="proman-notes" title="${escapeHtml(record.notes || '—')}">${inlineText(record, 'notes', record.notes)}</td>
      <td><div class="proman-row-actions"><button type="button" data-proman-edit="${escapeHtml(record.id)}">EDITAR</button><button type="button" class="danger ghost" data-proman-delete="${escapeHtml(record.id)}">EXCLUIR</button></div></td>
    </tr>`).join('') : '<tr><td colspan="13" class="proman-empty">NENHUMA ATIVIDADE IMPORTADA OU MANUAL COM STATUS DE BACKLOG FOI ENCONTRADA.</td></tr>';
  }

  function updateBacklogSortHeaders() {
    document.querySelectorAll('[data-proman-backlog-sort]').forEach(button => {
      const active = button.dataset.promanBacklogSort === state.backlogSort.key;
      const icon = button.querySelector('.proman-sort-icon');
      button.closest('th')?.setAttribute('aria-sort', active ? (state.backlogSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      if (icon) icon.textContent = active ? (state.backlogSort.direction === 'asc' ? '↑' : '↓') : '↕';
    });
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
    const filters = state.panelFilters;
    const sourceRecords = allBacklogRecords();
    const filtersChanged = reconcileContextualFilters(sourceRecords, filters, false);
    const selectedPlants = filterValues(filters.plant);
    document.querySelectorAll('[data-proman-tab]').forEach(button => {
      const active = selectedPlants.length === 1 && button.dataset.promanTab === selectedPlants[0];
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('#promanSearch').value = filters.search;
    const plantOptions = contextualFacetOptions(sourceRecords, filters, 'plant', false);
    const weekOptionsList = contextualFacetOptions(sourceRecords, filters, 'week', false);
    const statusOptions = contextualFacetOptions(sourceRecords, filters, 'status', false);
    const yearOptions = contextualFacetOptions(sourceRecords, filters, 'year', false);
    renderMultiSelect('promanPlantFilter', plantOptions, filters.plant, 'TODAS');
    renderMultiSelect('promanWeekFilter', weekOptionsList, filters.week, 'TODAS AS SEMANAS');
    renderMultiSelect('promanStatusFilter', statusOptions, filters.status, 'TODOS OS STATUS');
    renderMultiSelect('promanYearFilter', yearOptions, filters.year, 'TODOS OS ANOS');
    if (filtersChanged) save();
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

    const typeTotals = { 'SEGURANÇA': 0, 'OPORTUNIDADE': 0, 'CORRETIVA': 0, 'NÃO': 0 };
    records.forEach(record => {
      const value = plain(record.activityType);
      if (value.includes('SEGURANCA')) typeTotals['SEGURANÇA']++;
      else if (value.includes('OPORTUNIDADE')) typeTotals.OPORTUNIDADE++;
      else if (value.includes('CORRETIVA')) typeTotals.CORRETIVA++;
      else typeTotals['NÃO']++;
    });
    createChart('types', $('#promanTypeChart'), {
      type: 'doughnut',
      data: {
        labels: Object.keys(typeTotals),
        datasets: [{ data: Object.values(typeTotals), backgroundColor: ['#f58220', '#98ca3d', '#7c5cff', '#008acb'], borderColor: '#ffffff', borderWidth: 2 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '56%', plugins: { legend: { display: true, position: 'bottom', labels: { color: document.documentElement.classList.contains('light') ? '#315a7e' : '#d9ebfb', boxWidth: 10, font: { size: 10, weight: '700' } } } } }
    });
  }

  function statusClass(status) {
    if (/CONCLU/.test(status)) return 'is-completed';
    if (/CANCEL/.test(status)) return 'is-canceled';
    if (/ATRAS/.test(status)) return 'is-overdue';
    if (/EM ANDAMENTO/.test(status)) return 'is-progress';
    if (/PENDENTE/.test(status)) return 'is-pending';
    if (/PRAZO/.test(status)) return 'is-on-time';
    return '';
  }

  function renderTable(records) {
    const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    state.panelPage = Math.min(Math.max(1, state.panelPage), pages);
    const start = (state.panelPage - 1) * PAGE_SIZE;
    const pageRows = records.slice(start, start + PAGE_SIZE);
    $('#promanTableCount').textContent = `${records.length.toLocaleString('pt-BR')} REGISTROS`;
    $('#promanPageInfo').textContent = `PÁGINA ${state.panelPage} DE ${pages}`;
    $('#promanPrevPage').disabled = state.panelPage <= 1;
    $('#promanNextPage').disabled = state.panelPage >= pages;
    $('#promanTableBody').innerHTML = pageRows.length ? pageRows.map(record => `<tr>
      <td><strong>${escapeHtml(PLANT_CONFIG[record.plant]?.label.replace('PROMAN ', '') || record.plant)}</strong></td>
      <td>${escapeHtml(formatDate(record.date))}</td>
      <td><strong>${escapeHtml(record.tag || '—')}</strong></td>
      <td class="proman-what">${escapeHtml(record.what || '—')}</td>
      <td>${escapeHtml(record.who || '—')}</td>
      <td>${escapeHtml(formatDate(record.deadline))}</td>
      <td>${escapeHtml(formatDate(record.completionDate))}</td>
      <td><span class="proman-status ${statusClass(record.status)}">${escapeHtml(record.status)}</span></td>
      <td><span class="proman-activity-type">${escapeHtml(record.activityType || 'NÃO')}</span></td>
      <td>${escapeHtml(record.os || '—')}</td>
      <td class="proman-notes">${escapeHtml(record.notes || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="11" class="proman-empty">IMPORTE UMA PLANILHA PROMAN OU AJUSTE OS FILTROS PARA VISUALIZAR AS AÇÕES.</td></tr>';
  }

  function render() {
    if (!$('#promanView')) return;
    if (activeView !== 'proman' && activeView !== 'promanBacklog') return;
    refreshAutomaticStatuses();
    if (activeView === 'promanBacklog') {
      renderBacklog();
      return;
    }
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
    state.panelFilters.plant = [key];
    state.panelPage = 1;
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
      PRAZO: formatDate(record.deadline), 'DATA DE CONCLUSÃO': formatDate(record.completionDate), STATUS: record.status, 'TIPO DE ATIVIDADE': record.activityType || 'NÃO', 'NOTA/OS': record.os, OBSERVAÇÕES: record.notes
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
      'DATA DE CONCLUSÃO': formatDate(record.completionDate),
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
    activeView = String(view || '');
    const proman = String(view || '').startsWith('proman');
    const title = $('#mainPageTitle');
    const subtitle = $('#subtitle');
    if (title) title.textContent = proman ? 'REUNIÃO PROMAN' : 'DASHBOARD PSM';
    if (subtitle) subtitle.hidden = proman;
    if (proman) {
      render();
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
      state.panelFilters.search = event.target.value;
      state.panelPage = 1;
      schedulePanelSearch();
    });
    wirePromanMulti('promanPlantFilter', values => { state.panelFilters.plant = values; state.panelPage = 1; save(); render(); });
    wirePromanMulti('promanWeekFilter', values => { state.panelFilters.week = values; state.panelPage = 1; save(); render(); });
    wirePromanMulti('promanStatusFilter', values => { state.panelFilters.status = values; state.panelPage = 1; save(); render(); });
    wirePromanMulti('promanYearFilter', values => { state.panelFilters.year = values; reconcileContextualFilters(allBacklogRecords(), state.panelFilters, false); state.panelPage = 1; save(); render(); });
    $('#btnPromanClearFilters')?.addEventListener('click', () => { state.panelFilters = { plant: [], search: '', status: [], year: [], week: [] }; state.panelPage = 1; save(); render(); });
    $('#promanPrevPage')?.addEventListener('click', () => { state.panelPage--; renderTable(filteredRecords()); });
    $('#promanNextPage')?.addEventListener('click', () => { state.panelPage++; renderTable(filteredRecords()); });
    $('#btnPromanBacklogExport')?.addEventListener('click', exportBacklog);
    $('#promanActivityForm')?.addEventListener('submit', submitManualActivity);
    $('#btnManagePromanTypes')?.addEventListener('click', () => { renderTypeManager(); $('#promanTypesDialog')?.showModal(); setTimeout(() => $('#promanNewType')?.focus(), 0); });
    $('#promanTypeManagerForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const type = upper($('#promanNewType')?.value);
      if (!type) return;
      const types = customActivityTypes();
      if (activityTypeValues().includes(type)) { renderTypeManager('Este tipo já está cadastrado.'); return; }
      saveCustomActivityTypes([...types, type]);
      const removed = removedActivityTypes(); removed.delete(type); localStorage.setItem(REMOVED_ACTIVITY_TYPES_KEY, JSON.stringify([...removed]));
      $('#promanNewType').value = ''; updateActivityTypeOptions(); renderTypeManager('Tipo adicionado.');
      save();
      global.dispatchEvent(new CustomEvent('psm:proman-changed'));
    });
    $('#promanTypeManagerList')?.addEventListener('click', event => {
      const type = event.target.closest('[data-proman-type-remove]')?.dataset.promanTypeRemove;
      if (!type) return;
      if (activityTypeValues().length <= 1) { renderTypeManager('É necessário manter pelo menos um tipo cadastrado.'); return; }
      if (!confirm(`Remover o tipo ${type} das opções disponíveis?`)) return;
      saveCustomActivityTypes(customActivityTypes().filter(item => item !== type));
      const removed = removedActivityTypes(); removed.add(type); localStorage.setItem(REMOVED_ACTIVITY_TYPES_KEY, JSON.stringify([...removed]));
      updateActivityTypeOptions(); renderTypeManager('Tipo removido das opções. As atividades antigas foram preservadas.'); render();
      save();
      global.dispatchEvent(new CustomEvent('psm:proman-changed'));
    });
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
    wirePromanMulti('promanBacklogWeek', values => { state.backlogFilters.week = values; save(); renderBacklog(); });
    wirePromanMulti('promanBacklogYear', values => { state.backlogFilters.year = values; reconcileContextualFilters(allBacklogRecords(), state.backlogFilters, true); save(); renderBacklog(); });
    wirePromanMulti('promanBacklogStatus', values => { state.backlogFilters.status = values; save(); renderBacklog(); });
    wirePromanMulti('promanBacklogType', values => { state.backlogFilters.type = values; save(); renderBacklog(); });
    $('#btnPromanBacklogClearFilters')?.addEventListener('click', () => {
      state.backlogFilters = { plant: [], search: '', status: [], type: [], week: [], year: [] };
      save();
      renderBacklog();
    });
    $('.proman-backlog-table thead')?.addEventListener('click', event => {
      const button = event.target.closest('[data-proman-backlog-sort]');
      if (!button) return;
      const key = button.dataset.promanBacklogSort;
      if (state.backlogSort.key === key) state.backlogSort.direction = state.backlogSort.direction === 'desc' ? 'asc' : 'desc';
      else state.backlogSort = { key, direction: 'desc' };
      save();
      renderBacklog();
    });
    $('#promanBacklogBody')?.addEventListener('change', event => {
      const typeSelect = event.target.closest('[data-proman-type-id]');
      if (typeSelect && document.body.dataset.appMode !== 'viewer') {
        const found = findPromanRecord(typeSelect.dataset.promanTypeId);
        if (!found) return;
        found.record.activityType = upper(typeSelect.value) || 'NÃO';
        found.record.updatedAt = new Date().toISOString(); save(); updateActivityTypeOptions(); render();
        global.dispatchEvent(new CustomEvent('psm:proman-changed'));
        global.dispatchEvent(new CustomEvent('psm:toast', { detail: 'Tipo de atividade atualizado' })); return;
      }
      const plantSelect = event.target.closest('[data-proman-plant-id]');
      if (plantSelect && document.body.dataset.appMode !== 'viewer') {
        const found = findPromanRecord(plantSelect.dataset.promanPlantId);
        const nextPlant = plantSelect.value === 'fabrica' ? 'fabrica' : 'britagem';
        if (!found) return;
        const record = found.record;
        state.plants[found.plantKey].records.splice(found.index, 1);
        record.plant = nextPlant; record.updatedAt = new Date().toISOString();
        state.plants[nextPlant].records.push(record); save(); render();
        global.dispatchEvent(new CustomEvent('psm:proman-changed'));
        global.dispatchEvent(new CustomEvent('psm:toast', { detail: 'Unidade atualizada' })); return;
      }
      const dateInput = event.target.closest('[data-proman-date-id]');
      if (dateInput && document.body.dataset.appMode !== 'viewer') {
        const found = findPromanRecord(dateInput.dataset.promanDateId);
        const field = dateInput.dataset.promanDateField;
        if (!found || !['date', 'deadline'].includes(field)) return;
        found.record[field] = parseExcelDate(dateInput.value);
        if (field === 'deadline') found.record.status = automaticStatus(found.record.deadline, found.record.status);
        found.record.updatedAt = new Date().toISOString(); save(); render();
        global.dispatchEvent(new CustomEvent('psm:proman-changed'));
        global.dispatchEvent(new CustomEvent('psm:toast', { detail: field === 'date' ? 'Data atualizada' : 'Prazo atualizado' })); return;
      }
      const completionInput = event.target.closest('[data-proman-completion-id]');
      if (completionInput && document.body.dataset.appMode !== 'viewer') {
        const found = findPromanRecord(completionInput.dataset.promanCompletionId);
        if (!found) return;
        const change = applyPromanCompletionDate(found.record, completionInput.value);
        save();
        render();
        global.dispatchEvent(new CustomEvent('psm:proman-changed'));
        global.dispatchEvent(new CustomEvent('psm:toast', { detail: completionInput.value ? 'Conclusão registrada · status alterado para CONCLUÍDA' : `Data de conclusão removida · status ${change.status}` }));
        return;
      }
      const select = event.target.closest('[data-proman-status-id]');
      if (!select || document.body.dataset.appMode === 'viewer') return;
      const found = findPromanRecord(select.dataset.promanStatusId);
      if (!found) return;
      const change = applyPromanStatus(found.record, select.value);
      save();
      render();
      global.dispatchEvent(new CustomEvent('psm:proman-changed'));
      global.dispatchEvent(new CustomEvent('psm:toast', { detail: `Status alterado: ${change.previous} → ${change.status}` }));
    });
    $('#promanBacklogBody')?.addEventListener('focusout', event => {
      if (document.body.dataset.appMode === 'viewer') return;
      const target = event.target.closest?.('[data-proman-inline-id][contenteditable="true"]');
      if (!target) return;
      const found = findPromanRecord(target.dataset.promanInlineId);
      const field = target.dataset.promanInlineField;
      if (!found || !['tag', 'what', 'who', 'activityType', 'os', 'notes'].includes(field)) return;
      const before = normalize(target.dataset.promanInlineBefore);
      const after = field === 'notes' ? normalize(target.textContent).replace(/^—$/, '') : upper(normalize(target.textContent).replace(/^—$/, ''));
      if (!after && ['tag', 'what', 'who'].includes(field)) { target.textContent = before || '—'; return; }
      found.record[field] = field === 'activityType' ? (after || 'NÃO') : after;
      found.record.updatedAt = new Date().toISOString(); save(); updateActivityTypeOptions(); render();
      global.dispatchEvent(new CustomEvent('psm:proman-changed'));
      if (before !== found.record[field]) global.dispatchEvent(new CustomEvent('psm:toast', { detail: 'Atividade PROMAN atualizada' }));
    });
    $('#promanBacklogBody')?.addEventListener('keydown', event => {
      const target = event.target.closest?.('[data-proman-inline-id][contenteditable="true"]');
      if (!target) return;
      if (event.key === 'Enter') { event.preventDefault(); target.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); target.textContent = target.dataset.promanInlineBefore || '—'; target.blur(); }
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
  global.PSMProMan = Object.freeze({ getProjectData, restoreProjectData, getSharedData, restoreSharedData, render, handleViewChange, setWorkspace, getDailyActivities, setDailyCompleted, setAccessMode });
})(window);
