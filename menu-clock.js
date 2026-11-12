(() => {
  const clock = document.querySelector('.menu-clock');
  if (!clock) return;
  function updateClock() {
    const now = new Date();
    clock.querySelector('[data-clock-time]').textContent = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
    clock.querySelector('[data-clock-period]').textContent = now.getHours() < 12 ? 'AM' : 'PM';
    clock.querySelector('[data-clock-date]').textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    clock.querySelector('[data-clock-progress]').style.width = `${now.getSeconds() / 59 * 100}%`;
  }
  updateClock();
  setInterval(updateClock, 1000);
})();
