/* ULTRON persona: the face changes with the chosen mode (Companion = woman's face) */
(() => {
  const set = () => {
    const a = document.querySelector('.mode.active');
    const persona = a && a.dataset.mode === 'companion' ? 'companion' : 'default';
    if (document.body.dataset.persona !== persona) document.body.dataset.persona = persona;
  };
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.mode')) setTimeout(set, 0); });
  const modes = document.getElementById('modes');
  if (modes) new MutationObserver(set).observe(modes, { subtree: true, attributes: true, attributeFilter: ['class'] });
  set();
  setTimeout(set, 800);
})();