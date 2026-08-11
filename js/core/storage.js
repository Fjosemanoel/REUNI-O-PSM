(function (global) {
  'use strict';

  function createStorage(key) {
    return {
      save: function (value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
          return true;
        } catch (error) {
          console.error('Falha ao salvar dados locais.', error);
          return false;
        }
      },
      load: function (fallback) {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
          console.error('Falha ao carregar dados locais.', error);
          return fallback;
        }
      },
      clear: function () {
        localStorage.removeItem(key);
      }
    };
  }

  global.PSMStorage = Object.freeze({ create: createStorage });
})(window);
