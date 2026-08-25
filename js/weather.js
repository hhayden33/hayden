(function () {
  'use strict';
  // Melbourne current conditions — Open-Meteo, no API key needed. Cached
  // in localStorage (shared with index.html's identical copy of this
  // block, same cache key) so hopping between pages doesn't refetch, and
  // a stale/missing network still shows the last known reading rather
  // than nothing.
  const el = document.getElementById('heroWeather');
  if (!el) return;
  const CACHE_KEY = 'weather:melbourne';
  const MAX_AGE_MS = 30 * 60 * 1000;
  const WEATHER_LABELS = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Foggy',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
    85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm'
  };
  function render(data) {
    const label = WEATHER_LABELS[data.code];
    if (!label || typeof data.temp !== 'number') return;
    el.textContent = 'Melbourne · ' + Math.round(data.temp) + '°C · ' + label;
  }
  function loadCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
      return (raw && typeof raw.temp === 'number') ? raw : null;
    } catch (e) { return null; }
  }
  const cached = loadCache();
  if (cached) render(cached);
  if (cached && (Date.now() - cached.fetchedAt) < MAX_AGE_MS) return;

  fetch('https://api.open-meteo.com/v1/forecast?latitude=-37.8136&longitude=144.9631&current=temperature_2m,weather_code&timezone=Australia%2FMelbourne')
    .then(r => r.json())
    .then(data => {
      const cur = data && data.current;
      if (!cur || typeof cur.temperature_2m !== 'number') return;
      const out = { temp: cur.temperature_2m, code: cur.weather_code, fetchedAt: Date.now() };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(out)); } catch (e) {}
      render(out);
    })
    .catch(() => {}); // offline/blocked — leave whatever render() already did (cache or nothing)
})();
