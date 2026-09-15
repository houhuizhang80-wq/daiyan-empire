/* 接口封装 */
(function () {
  const TOKEN_KEY = 'daiyan.token';

  const store = {
    get token() {
      return localStorage.getItem(TOKEN_KEY);
    },
    set token(v) {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    },
  };

  async function request(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (store.token) headers.authorization = `Bearer ${store.token}`;
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `请求失败（${res.status}）`);
      err.status = res.status;
      throw err;
    }
    return data || {};
  }

  window.API = {
    token: store,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b || {}),

    register: (username, displayName, password) =>
      request('POST', '/api/auth/register', { username, displayName, password }),
    login: (username, password) => request('POST', '/api/auth/login', { username, password }),
    logout: () => request('POST', '/api/auth/logout'),

    me: () => request('GET', '/api/me'),
    act: (key, targetId) => request('POST', `/api/actions/${key}`, { targetId }),
    actions: () => request('GET', '/api/actions'),
    promote: () => request('POST', '/api/promote'),
    events: () => request('GET', '/api/events'),
    resolveEvent: (id, optionKey) => request('POST', `/api/events/${id}/resolve`, { optionKey }),

    court: () => request('GET', '/api/court'),
    leaderboard: () => request('GET', '/api/leaderboard'),
    ranks: () => request('GET', '/api/ranks'),
    players: (q) => request('GET', `/api/players${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    player: (id) => request('GET', `/api/players/${id}`),
    gazette: (limit) => request('GET', `/api/gazette${limit ? `?limit=${limit}` : ''}`),

    factions: () => request('GET', '/api/factions'),
    createFaction: (name, doctrine) => request('POST', '/api/factions', { name, doctrine }),
    joinFaction: (id) => request('POST', `/api/factions/${id}/join`),
    leaveFaction: () => request('POST', '/api/factions/leave'),
    donateFaction: (amount) => request('POST', '/api/factions/donate', { amount }),

    dm: (toId, text) => request('POST', '/api/dm', { toId, text }),
    dmThreads: () => request('GET', '/api/dm/threads'),
    dmHistory: (playerId) => request('GET', `/api/dm/${playerId}`),
  };
})();
