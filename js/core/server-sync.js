(function (global) {
  'use strict';

  const clientId = global.crypto?.randomUUID?.() || `psm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let client = null;
  let channel = null;
  let config = null;
  let getSnapshot = null;
  let onSnapshot = null;
  let getUser = null;
  let ready = false;
  let started = false;
  let applyingRemote = false;
  let saving = false;
  let saveTimer = 0;
  let retryTimer = 0;
  let pending = null;
  let lastSavedFingerprint = '';
  let lastRevision = 0;

  function emit(state, text, extra = {}) {
    global.dispatchEvent(new CustomEvent('psm:sync-status', {
      detail: { state, text, ...extra }
    }));
  }

  function clean(value) {
    return String(value ?? '').trim();
  }

  function resolvedConfig() {
    const source = global.PSM_SERVER_CONFIG || {};
    return {
      url: clean(source.url),
      publishableKey: clean(source.publishableKey),
      workspaceId: clean(source.workspaceId) || 'psm-analytics-main',
      table: clean(source.table) || 'psm_shared_state',
      saveDebounceMs: Math.max(150, Number(source.saveDebounceMs) || 600)
    };
  }

  function isConfigured() {
    const value = resolvedConfig();
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value.url)
      && value.publishableKey.length > 20
      && !/COLE_AQUI|YOUR_|EXEMPLO/i.test(value.publishableKey);
  }

  function fingerprint(snapshot) {
    try { return JSON.stringify(snapshot); } catch { return ''; }
  }

  async function fetchLatest(options = {}) {
    if (!client || !config) return null;
    const { data, error } = await client
      .from(config.table)
      .select('workspace_id,payload,revision,updated_at,updated_by,client_id')
      .eq('workspace_id', config.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.payload) return null;

    const revision = Number(data.revision) || 0;
    if (!options.initial && revision && revision <= lastRevision) return data;
    lastRevision = revision;
    lastSavedFingerprint = fingerprint(data.payload);
    pending = null;

    applyingRemote = true;
    try {
      await onSnapshot?.(data.payload, {
        initial: Boolean(options.initial),
        revision,
        updatedAt: data.updated_at,
        updatedBy: data.updated_by || ''
      });
    } finally {
      applyingRemote = false;
    }

    const suffix = data.updated_by ? ` por ${data.updated_by}` : '';
    emit('online', options.initial ? 'Dados carregados do servidor' : `Atualizado${suffix}`, { revision });
    return data;
  }

  function waitForSubscription() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = global.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Tempo esgotado ao conectar ao servidor em tempo real.'));
      }, 12000);

      channel.subscribe(status => {
        if (settled) return;
        if (status === 'SUBSCRIBED') {
          settled = true;
          global.clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          settled = true;
          global.clearTimeout(timeout);
          reject(new Error('Não foi possível abrir o canal em tempo real.'));
        }
      });
    });
  }

  async function writeSnapshot(snapshot, updatedBy = '') {
    const row = {
      workspace_id: config.workspaceId,
      payload: snapshot,
      updated_by: clean(updatedBy).slice(0, 160) || null,
      client_id: clientId
    };
    const { data, error } = await client
      .from(config.table)
      .upsert(row, { onConflict: 'workspace_id' })
      .select('revision,updated_at')
      .single();
    if (error) throw error;

    lastRevision = Number(data?.revision) || lastRevision;
    lastSavedFingerprint = fingerprint(snapshot);
    if (channel) {
      channel.send({
        type: 'broadcast',
        event: 'data-updated',
        payload: { workspaceId: config.workspaceId, clientId, revision: lastRevision }
      }).catch(() => {});
    }
    return data;
  }

  function scheduleRetry() {
    global.clearTimeout(retryTimer);
    retryTimer = global.setTimeout(() => {
      retryTimer = 0;
      flush().catch(() => {});
    }, 5000);
  }

  async function flush() {
    global.clearTimeout(saveTimer);
    saveTimer = 0;
    if (!ready || saving || !pending) return false;

    const job = pending;
    pending = null;
    saving = true;
    emit('saving', 'Salvando no servidor…');
    try {
      await writeSnapshot(job.snapshot, job.updatedBy);
      emit('online', 'Dados salvos no servidor', { revision: lastRevision });
      return true;
    } catch (error) {
      console.error('Falha ao salvar no servidor.', error);
      if (!pending) pending = job;
      emit('error', 'Sem conexão — cópia local preservada', { error: error?.message || String(error) });
      scheduleRetry();
      return false;
    } finally {
      saving = false;
      if (pending && ready && !saveTimer) {
        saveTimer = global.setTimeout(() => flush().catch(() => {}), config.saveDebounceMs);
      }
    }
  }

  function queueSave(snapshot, updatedBy = '') {
    if (!isConfigured() || applyingRemote || !snapshot) return false;
    const nextFingerprint = fingerprint(snapshot);
    if (!nextFingerprint || nextFingerprint === lastSavedFingerprint || nextFingerprint === pending?.fingerprint) return false;
    pending = { snapshot, updatedBy, fingerprint: nextFingerprint };
    if (!ready) return true;
    emit('saving', 'Alterações aguardando envio…');
    global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(() => flush().catch(() => {}), config.saveDebounceMs);
    return true;
  }

  async function start(options = {}) {
    if (started) return { configured: Boolean(client), ready };
    started = true;
    getSnapshot = options.getSnapshot;
    onSnapshot = options.onSnapshot;
    getUser = options.getUser;
    config = resolvedConfig();

    if (!isConfigured()) {
      emit('local', 'Servidor ainda não configurado');
      return { configured: false, ready: false };
    }
    if (!global.supabase?.createClient) {
      emit('error', 'Biblioteca do servidor não carregou');
      return { configured: true, ready: false };
    }

    emit('connecting', 'Conectando ao servidor…');
    try {
      client = global.supabase.createClient(config.url, config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      channel = client
        .channel(`psm-shared-${config.workspaceId}`)
        .on('broadcast', { event: 'data-updated' }, message => {
          const payload = message?.payload || {};
          if (payload.workspaceId !== config.workspaceId || payload.clientId === clientId) return;
          fetchLatest().catch(error => {
            console.error('Falha ao receber atualização do servidor.', error);
            emit('error', 'Falha ao receber atualização');
          });
        });

      await waitForSubscription();
      const remote = await fetchLatest({ initial: true });
      ready = true;

      if (!remote) {
        const initialSnapshot = getSnapshot?.();
        if (initialSnapshot) {
          pending = null;
          emit('saving', 'Enviando a base inicial…');
          await writeSnapshot(initialSnapshot, getUser?.() || 'Configuração inicial');
        }
        emit('online', 'Servidor conectado', { revision: lastRevision });
      }
      return { configured: true, ready: true, revision: lastRevision };
    } catch (error) {
      console.error('Falha ao iniciar sincronização.', error);
      emit('error', 'Servidor indisponível — usando cópia local', { error: error?.message || String(error) });
      return { configured: true, ready: false, error };
    }
  }

  global.addEventListener('online', () => {
    if (!ready) return;
    fetchLatest().then(() => flush()).catch(() => scheduleRetry());
  });

  global.addEventListener('beforeunload', () => {
    if (pending && ready && !saving) flush().catch(() => {});
  });

  global.PSMServerSync = Object.freeze({
    start,
    queueSave,
    flush,
    isConfigured,
    isApplyingRemote: () => applyingRemote,
    isReady: () => ready
  });
})(window);
