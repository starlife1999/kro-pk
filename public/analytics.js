(function () {
  const VISITOR_KEY = 'kro_pk_visitor_id';
  const SESSION_KEY = 'kro_pk_session_id';

  function randomId(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function getOrCreate(key, prefix, storage) {
    let value = storage.getItem(key);
    if (!value) {
      value = randomId(prefix);
      storage.setItem(key, value);
    }
    return value;
  }

  const visitorId = getOrCreate(VISITOR_KEY, 'visitor', localStorage);
  const sessionId = getOrCreate(SESSION_KEY, 'session', sessionStorage);

  function send(type, payload = {}) {
    const body = JSON.stringify({
      type,
      visitorId,
      sessionId,
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
    track: send
  };

  send('page_view');
})();
