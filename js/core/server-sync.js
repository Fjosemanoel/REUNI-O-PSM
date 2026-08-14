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
  let pollTimer = 0;
  let reconnectTimer = 0;
  let realtimeConnected = false;
  let pending = null;
  let lastSavedFingerprint = '';
  let lastRevision = 0;
  let lastUpdatedAt = '';

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
      saveDebounceMs: Math.max(150, Number(source.saveDebounceMs) || 600),
      pollIntervalMs: Math.max(5000, Number(source.pollIntervalMs) || 15000)
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
    if (!options.initial && !options.force && revision && revision <= lastRevision) return data;
    lastRevision = revision;
    lastUpdatedAt = data.updated_at || lastUpdatedAt;
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
    emit('online', options.initial ? `Dados carregados do servidor · revisão ${revision}` : `Atualizado${suffix}`, { revision });
    return data;
  }

  function waitForSubscription(targetChannel) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = global.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Tempo esgotado ao conectar ao servidor em tempo real.'));
      }, 12000);

      targetChannel.subscribe(status => {
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

  function createRealtimeChannel() {
    return client
      .channel(`psm-shared-${config.workspaceId}`)
      .on('broadcast', { event: 'data-updated' }, message => {
        const payload = message?.payload || {};
        if (payload.workspaceId !== config.workspaceId || payload.clientId === clientId) return;
        fetchLatest().catch(error => {
          console.error('Falha ao receber atualização do servidor.', error);
          emit('error', 'Falha ao receber atualização');
        });
      });
  }

  function scheduleRealtimeReconnect() {
    if (!ready || realtimeConnected || reconnectTimer) return;
    reconnectTimer = global.setTimeout(() => {
      reconnectTimer = 0;
      connectRealtime().catch(() => {});
    }, 30000);
  }

  async function connectRealtime() {
    if (!client || !config || realtimeConnected) return realtimeConnected;
    const nextChannel = createRealtimeChannel();
    channel = nextChannel;
    try {
      await waitForSubscription(nextChannel);
      if (channel !== nextChannel) return false;
      realtimeConnected = true;
      emit('online', `Servidor conectado · revisão ${lastRevision} · tempo real ativo`, { revision: lastRevision, realtime: true });
      return true;
    } catch (error) {
      console.warn('Canal em tempo real indisponível; atualização periódica continuará ativa.', error);
      if (channel === nextChannel) channel = null;
      realtimeConnected = false;
      try { await client.removeChannel?.(nextChannel); } catch {}
      emit('online', `Servidor conectado · revisão ${lastRevision} · atualização automática ativa`, {
        revision: lastRevision,
        realtime: false
      });
      scheduleRealtimeReconnect();
      return false;
    }
  }

  function startPolling() {
    global.clearInterval(pollTimer);
    pollTimer = global.setInterval(() => {
      if (!ready || saving) return;
      fetchLatest()
        .then(() => flush())
        .catch(error => {
          console.error('Falha na atualização periódica.', error);
          emit('error', 'Sem conexão — cópia local preservada', { error: error?.message || String(error) });
        });
    }, config.pollIntervalMs);
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
    if (channel && realtimeConnected) {
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

  async function refresh() {
    if (!client || !config) throw new Error('Servidor ainda não inicializado.');
    emit('connecting', 'Buscando a revisão mais recente…');
    if (pending && ready) await flush();
    const data = await fetchLatest({ initial: !ready, force: true });
    if (!data) throw new Error('Nenhuma base compartilhada encontrada no servidor.');
    const wasReady = ready;
    ready = true;
    if (!wasReady) {
      startPolling();
      connectRealtime().catch(() => {});
    }
    emit('online', `Atualizado agora · revisão ${lastRevision}`, {
      revision: lastRevision,
      updatedAt: lastUpdatedAt,
      forced: true
    });
    return { revision: lastRevision, updatedAt: lastUpdatedAt };
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
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: {
          fetch: (input, init = {}) => global.fetch(input, { ...init, cache: 'no-store' })
        }
      });

      // Primeiro carrega a base via HTTP. Isso funciona mesmo quando uma rede
      // corporativa bloqueia o canal WebSocket usado pelo tempo real.
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

      startPolling();
      connectRealtime().catch(() => {});
      return { configured: true, ready: true, revision: lastRevision };
    } catch (error) {
      console.error('Falha ao iniciar sincronização.', error);
      emit('error', 'Servidor indisponível — usando cópia local', { error: error?.message || String(error) });
      return { configured: true, ready: false, error };
    }
  }

  global.addEventListener('online', () => {
    if (!ready) return;
    fetchLatest()
      .then(() => flush())
      .then(() => {
        if (!realtimeConnected) connectRealtime().catch(() => {});
      })
      .catch(() => scheduleRetry());
  });

  function refreshWhenVisible() {
    if (!ready || global.document?.visibilityState === 'hidden') return;
    fetchLatest().then(() => flush()).catch(() => scheduleRetry());
  }

  global.addEventListener('focus', refreshWhenVisible);
  global.addEventListener('pageshow', refreshWhenVisible);
  global.document?.addEventListener('visibilitychange', refreshWhenVisible);

  global.addEventListener('beforeunload', () => {
    if (pending && ready && !saving) flush().catch(() => {});
  });

  global.PSMServerSync = Object.freeze({
    start,
    refresh,
    queueSave,
    flush,
    isConfigured,
    isApplyingRemote: () => applyingRemote,
    isReady: () => ready,
    getStatus: () => ({ ready, revision: lastRevision, updatedAt: lastUpdatedAt, realtime: realtimeConnected })
  });
})(window);
