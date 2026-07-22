/* Shared toolbar for quote templates. */
(function () {
  function init() {
    const printBtn = document.getElementById('print-btn');
    const resetBtn = document.getElementById('reset-btn');
    const stateKey = 'kaipability-quote::' + location.pathname;

    // Restore saved field values
    const saved = localStorage.getItem(stateKey);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        document.querySelectorAll('[data-edit]').forEach((el, i) => {
          const k = el.dataset.field || ('f' + i);
          if (data[k] != null) el.innerHTML = data[k];
        });
      } catch (e) { /* ignore */ }
    }

    // Persist on edit
    let saveTimer = null;
    document.addEventListener('input', (e) => {
      if (!e.target.matches('[data-edit]')) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const data = {};
        document.querySelectorAll('[data-edit]').forEach((el, i) => {
          const k = el.dataset.field || ('f' + i);
          data[k] = el.innerHTML;
        });
        localStorage.setItem(stateKey, JSON.stringify(data));
      }, 300);
    });

    if (printBtn) printBtn.addEventListener('click', () => window.print());
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (confirm('Reset all fields to the template defaults?')) {
        localStorage.removeItem(stateKey);
        location.reload();
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
