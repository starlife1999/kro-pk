(function () {
  const VISITOR_KEY = 'kro_pk_visitor_id';
  const SESSION_KEY = 'kro_pk_session_id';

  function randomId(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function getOrCreate(key, prefix, storage) {
    let value = null;
    try {
      value = storage.getItem(key);
    } catch {
      value = null;
    }
    if (!value) {
      value = randomId(prefix);
      try {
        storage.setItem(key, value);
      } catch {}
    }
    return value;
  }

  const visitorId = getOrCreate(VISITOR_KEY, 'visitor', localStorage);
  const sessionId = getOrCreate(SESSION_KEY, 'session', sessionStorage);
  const allowedSources = new Set(['instagram', 'tiktok', 'snapchat', 'whatsapp']);
  const params = new URLSearchParams(window.location.search);
  const incomingSource = String(params.get('source') || '').trim().toLowerCase();
  let storedSource = '';
  try {
    storedSource = localStorage.getItem('kro_pk_source') || '';
  } catch {}
  const source = allowedSources.has(incomingSource) ? incomingSource : (storedSource || 'direct');
  try {
    localStorage.setItem('kro_pk_source', source);
  } catch {}

  function send(type, payload = {}) {
    const body = JSON.stringify({
      type,
      visitorId,
      sessionId,
      source,
      path: window.location.pathname + window.location.search,
      ...payload
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/events', new Blob([body], { type: 'application/json' }));
      return;
    }

    fetch('/api/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  }

  window.KroAnalytics = {
    visitorId,
    sessionId,
    source,
    track: send,
    updateProfile(payload = {}) {
      const body = JSON.stringify({ visitorId, sessionId, source, ...payload });
      fetch('/api/analytics/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    }
  };

  send('page_view');
})();
