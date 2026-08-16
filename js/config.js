(function (global) {
  'use strict';

  // Preencha estes dois valores com os dados do seu projeto Supabase.
  // A chave publishable foi feita para uso no navegador. Nunca use secret/service_role aqui.
  global.PSM_SERVER_CONFIG = Object.freeze({
    url: 'https://jzblrdazidemwinjztrn.supabase.co',
    publishableKey: 'sb_publishable_kfCU8QGUJF66y1V8iB1Xwg_orc9Pjjz',
    workspaceId: 'psm-analytics-main',
    table: 'psm_shared_state',
    saveDebounceMs: 900,
    pollIntervalMs: 30000
  });
})(window);
