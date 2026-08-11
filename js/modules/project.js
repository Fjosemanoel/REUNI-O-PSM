(function (global) {
  'use strict';

  const FORMAT = 'PSM_ANALYTICS_PROJECT';
  const VERSION = 2;

  function createEnvelope(data, metadata) {
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      app: 'PSM Analytics Pro',
      metadata: metadata || {},
      data: data
    };
  }

  function triggerDownload(blob, fileName) {
    const safeName = String(fileName || 'PSM_Projeto.psm').replace(/[\/:*?"<>|]+/g, '-');

    // Método principal: download iniciado diretamente pelo clique do usuário.
    try {
      if (navigator.msSaveOrOpenBlob) {
        navigator.msSaveOrOpenBlob(blob, safeName);
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(function () {
        anchor.remove();
        URL.revokeObjectURL(url);
      }, 1000);
      return true;
    } catch (error) {
      console.warn('Falha no download por Blob URL; tentando alternativa.', error);
    }

    // Alternativa para navegadores/restrições que bloqueiam Blob URLs em file://.
    const reader = new FileReader();
    reader.onload = function () {
      const anchor = document.createElement('a');
      anchor.href = reader.result;
      anchor.download = safeName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    };
    reader.onerror = function () {
      console.error('Falha ao converter o PSM para download.');
      alert('O navegador bloqueou o download. Verifique a permissão de downloads para esta página.');
    };
    reader.readAsDataURL(blob);
    return true;
  }

  async function save(data, fileName, metadata) {
    if (!data || !Array.isArray(data.orders)) {
      throw new Error('Os dados do PSM estão inválidos.');
    }
    const envelope = createEnvelope(data, metadata);
    const json = JSON.stringify(envelope, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    triggerDownload(blob, fileName);
    return { method: 'download', fileName: fileName };
  }

  async function open(file) {
    if (!file) throw new Error('Nenhum arquivo foi selecionado.');
    let text;
    try {
      text = await file.text();
    } catch (error) {
      throw new Error('O navegador não conseguiu ler o arquivo selecionado.');
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error('O arquivo não contém um PSM válido.');
    }

    const payload = parsed && parsed.format === FORMAT ? parsed.data : (parsed.data || parsed);
    if (!payload || !Array.isArray(payload.orders) || !Array.isArray(payload.capacity)) {
      throw new Error('O arquivo não possui ordens e HH disponível válidos.');
    }

    return {
      payload: payload,
      metadata: parsed.metadata || {},
      version: parsed.version || 1,
      exportedAt: parsed.exportedAt || null
    };
  }

  global.PSMProject = Object.freeze({
    FORMAT: FORMAT,
    VERSION: VERSION,
    save: save,
    open: open
  });
})(window);
