/**
 * Paste on https://chat.deepseek.com/ while logged in.
 *
 * Network → chat/completion → Copy → Copy as cURL  (includes Cookie header)
 *   importDeepSeekRequest(`paste cURL here`)
 *   exportDeepSeekAuth()
 *
 * Do NOT use Copy as fetch — it omits cookies (uses credentials: include).
 */
(function () {
  const DEFAULT_WASM =
    'https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm';

  const captured = {
    authorization: '',
    cookie: '',
    hif_dliq: '',
    hif_leim: '',
  };
  const overrides = {};

  function parseMaybeJson(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function normalizeHeaderValue(raw) {
    if (raw == null || raw === '') return '';
    let text = String(raw).trim();
    for (let i = 0; i < 3; i++) {
      const parsed = parseMaybeJson(text);
      if (typeof parsed === 'string') {
        text = parsed.trim();
        continue;
      }
      break;
    }
    while (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      text = text.slice(1, -1).trim();
    }
    return text.replace(/\\"/g, '"').trim();
  }

  function normalizeToken(raw) {
    if (!raw) return '';
    const parsed = parseMaybeJson(raw);
    if (parsed && typeof parsed === 'object') {
      return normalizeHeaderValue(parsed.value || parsed.token || parsed.access_token || parsed.accessToken || '');
    }
    return normalizeHeaderValue(String(raw).replace(/^Bearer\s+/i, ''));
  }

  function readStores() {
    const localStorageData = {};
    const sessionStorageData = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        localStorageData[key] = localStorage.getItem(key);
      }
    } catch {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        sessionStorageData[key] = sessionStorage.getItem(key);
      }
    } catch {}
    return { localStorageData, sessionStorageData };
  }

  function scanStoresForPatterns(stores) {
    const found = { hif_dliq: '', hif_leim: '', ds_session_id: '', token: '' };
    for (const store of stores) {
      for (const [key, value] of Object.entries(store)) {
        if (!value) continue;
        const lk = key.toLowerCase();
        if (lk === 'hif_dliq' || lk.endsWith('.hif_dliq')) found.hif_dliq ||= normalizeHeaderValue(value);
        if (lk === 'hif_leim' || lk.endsWith('.hif_leim')) found.hif_leim ||= normalizeHeaderValue(value);
        if (/ds_session/i.test(key) && !found.ds_session_id) found.ds_session_id = String(value);
        if (/^token$/i.test(key)) found.token ||= normalizeToken(value);

        if (/hif[_-]?dliq/i.test(key) && !found.hif_dliq) found.hif_dliq = normalizeHeaderValue(value);
        if (/hif[_-]?leim/i.test(key) && !found.hif_leim) found.hif_leim = normalizeHeaderValue(value);

        const parsed = parseMaybeJson(value);
        if (parsed && typeof parsed === 'object') {
          if (parsed.hif_dliq && !found.hif_dliq) found.hif_dliq = normalizeHeaderValue(parsed.hif_dliq);
          if (parsed.hif_leim && !found.hif_leim) found.hif_leim = normalizeHeaderValue(parsed.hif_leim);
          if (parsed.ds_session_id && !found.ds_session_id) found.ds_session_id = String(parsed.ds_session_id);
        }

        const sessionMatch = String(value).match(/ds_session_id=([^;\s]+)/i);
        if (sessionMatch && !found.ds_session_id) found.ds_session_id = sessionMatch[1];
      }
    }
    return found;
  }

  function findToken(stores) {
    const tokenKeys = ['userToken', 'token', 'auth_token', 'access_token', 'accessToken'];
    for (const store of stores) {
      for (const key of tokenKeys) {
        const token = normalizeToken(store[key]);
        if (token) return token;
      }
      for (const [key, value] of Object.entries(store)) {
        if (/token/i.test(key)) {
          const token = normalizeToken(value);
          if (token) return token;
        }
      }
    }
    return '';
  }

  function readCookieMap() {
    const map = {};
    if (!document.cookie) return map;
    for (const part of document.cookie.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    return map;
  }

  function parseCookieHeader(raw) {
    const map = {};
    for (const part of String(raw || '').split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    return map;
  }

  function buildCookieHeader(cookieMap) {
    const parts = [];
    if (cookieMap.ds_session_id) parts.push(`ds_session_id=${cookieMap.ds_session_id}`);
    if (cookieMap.smidV2) parts.push(`smidV2=${cookieMap.smidV2}`);
    return parts.join('; ');
  }

  function mergeCookieStrings(...candidates) {
    const map = {};
    for (const candidate of candidates) {
      if (!candidate) continue;
      Object.assign(map, parseCookieHeader(candidate));
    }
    return buildCookieHeader(map);
  }

  function findWasmUrl() {
    try {
      const hit = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .reverse()
        .find((url) => /sha3.*\.wasm/i.test(url));
      return hit || DEFAULT_WASM;
    } catch {
      return DEFAULT_WASM;
    }
  }

  function envLine(name, value) {
    const safe = String(value ?? '');
    if (!safe) return `${name}=`;
    if (/[\s#"\\=]/.test(safe) || safe.includes(';') || safe.includes('+') || safe.includes('/')) {
      return `${name}=${JSON.stringify(safe)}`;
    }
    return `${name}=${safe}`;
  }

  function captureHeader(name, value) {
    if (value == null || value === '') return;
    const lk = String(name).toLowerCase();
    const text = normalizeHeaderValue(value);
    if (lk === 'authorization') captured.authorization = text;
    if (lk === 'cookie') captured.cookie = text;
    if (lk === 'x-hif-dliq') captured.hif_dliq = text;
    if (lk === 'x-hif-leim') captured.hif_leim = text;
  }

  function inspectHeaders(headers) {
    if (!headers) return;

    if (headers instanceof Headers) {
      headers.forEach((value, key) => captureHeader(key, value));
      return;
    }

    if (typeof headers === 'object' && typeof headers.forEach === 'function' && typeof headers.get === 'function') {
      try {
        for (const key of ['authorization', 'cookie', 'x-hif-dliq', 'x-hif-leim']) {
          const value = headers.get(key) || headers.get(key.replace(/^x-/, 'X-'));
          if (value) captureHeader(key, value);
        }
      } catch {}
      try {
        headers.forEach((value, key) => captureHeader(key, value));
      } catch {}
      return;
    }

    if (Array.isArray(headers)) {
      for (const entry of headers) {
        if (Array.isArray(entry)) captureHeader(entry[0], entry[1]);
      }
      return;
    }

    if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) captureHeader(key, value);
    }
  }

  function mergeAuth() {
    const { localStorageData, sessionStorageData } = readStores();
    const stores = [localStorageData, sessionStorageData];
    const scanned = scanStoresForPatterns(stores);
    const cookieMap = readCookieMap();
    if (scanned.ds_session_id) cookieMap.ds_session_id = scanned.ds_session_id;

    const token =
      overrides.token ||
      findToken(stores) ||
      normalizeToken(captured.authorization) ||
      normalizeToken(scanned.token) ||
      normalizeToken(cookieMap.token);

    const hif_dliq = normalizeHeaderValue(
      overrides.hif_dliq ||
      scanned.hif_dliq ||
      localStorageData.hif_dliq ||
      sessionStorageData.hif_dliq ||
      captured.hif_dliq ||
      ''
    );

    const hif_leim = normalizeHeaderValue(
      overrides.hif_leim ||
      scanned.hif_leim ||
      localStorageData.hif_leim ||
      sessionStorageData.hif_leim ||
      captured.hif_leim ||
      ''
    );

    const cookie =
      overrides.cookie ||
      captured.cookie ||
      mergeCookieStrings(buildCookieHeader(cookieMap));

    const wasmUrl = overrides.wasmUrl || findWasmUrl();

    return { token, hif_dliq, hif_leim, cookie, wasmUrl };
  }

  function installDeepSeekAuthCapture() {
    if (window.__deepSeekAuthCaptureInstalled) {
      console.log('[DeepSeek export] capture already installed');
      return;
    }

    const origHeadersSet = Headers.prototype.set;
    const origHeadersAppend = Headers.prototype.append;
    Headers.prototype.set = function (name, value) {
      captureHeader(name, value);
      return origHeadersSet.call(this, name, value);
    };
    Headers.prototype.append = function (name, value) {
      captureHeader(name, value);
      return origHeadersAppend.call(this, name, value);
    };

    const OrigRequest = window.Request;
    window.Request = function (input, init) {
      try {
        if (input instanceof OrigRequest) inspectHeaders(input.headers);
        inspectHeaders(init?.headers);
      } catch {}
      return new OrigRequest(input, init);
    };
    window.Request.prototype = OrigRequest.prototype;

    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        if (input instanceof Request) inspectHeaders(input.headers);
        inspectHeaders(init?.headers);
      } catch {}
      return origFetch.apply(this, arguments).then((response) => {
        try {
          response.headers.forEach((value, key) => captureHeader(key, value));
        } catch {}
        return response;
      });
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (...args) {
      this.__dsHeaders = {};
      this.__dsUrl = String(args[1] || '');
      return origOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      try {
        if (!this.__dsHeaders) this.__dsHeaders = {};
        this.__dsHeaders[name.toLowerCase()] = value;
        captureHeader(name, value);
      } catch {}
      return origSetHeader.apply(this, arguments);
    };
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
      try {
        inspectHeaders(this.__dsHeaders);
        if (/hif-dliq\.deepseek\.com\/query/i.test(this.__dsUrl || '')) {
          this.addEventListener('load', function () {
            try {
              const body = String(this.responseText || '').trim();
              if (!body) return;
              const parsed = parseMaybeJson(body);
              const value =
                typeof parsed === 'string' ? parsed :
                parsed?.data || parsed?.dliq || parsed?.hif_dliq || body;
              if (value) captured.hif_dliq = normalizeHeaderValue(value);
            } catch {}
          }, { once: true });
        }
      } catch {}
      return origSend.apply(this, arguments);
    };

    window.__deepSeekAuthCaptureInstalled = true;
    console.log('[DeepSeek export] capture installed — send one chat message, then exportDeepSeekAuth()');
  }

  function parseRequestHeaderBlock(text) {
    const headers = {};
    for (const line of String(text).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^HTTP\//.test(trimmed) || /^:\s/.test(trimmed)) continue;
      const idx = trimmed.indexOf(':');
      if (idx === -1) continue;
      headers[trimmed.slice(0, idx).trim().toLowerCase()] = trimmed.slice(idx + 1).trim();
    }
    return headers;
  }

  function applyImportedHeaders(headers) {
    const cookie = normalizeHeaderValue(headers.cookie || '');
    const authorization = normalizeHeaderValue(headers.authorization || '');
    const hif_dliq = normalizeHeaderValue(headers['x-hif-dliq'] || '');
    const hif_leim = normalizeHeaderValue(headers['x-hif-leim'] || '');

    if (cookie) overrides.cookie = cookie;
    if (hif_dliq) overrides.hif_dliq = hif_dliq;
    if (hif_leim) overrides.hif_leim = hif_leim;
    if (authorization) overrides.token = normalizeToken(authorization);

    return { cookie, hif_dliq, hif_leim, token: overrides.token || '' };
  }

  function importDeepSeekCookie(raw) {
    const text = normalizeHeaderValue(raw);
    if (!text) {
      console.warn('[DeepSeek export] empty cookie value');
      return '';
    }

    if (/[=;]/.test(text)) {
      overrides.cookie = mergeCookieStrings(overrides.cookie, text);
    } else {
      overrides.cookie = mergeCookieStrings(
        overrides.cookie,
        buildCookieHeader({ ds_session_id: text, ...parseCookieHeader(overrides.cookie) })
      );
    }

    console.log('[DeepSeek export] cookie imported, has ds_session_id:', /ds_session_id=/.test(overrides.cookie));
    return overrides.cookie;
  }

  function importDeepSeekRequest(raw) {
    const text = String(raw || '');

    const pick = (patterns) => {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return normalizeHeaderValue(match[1].replace(/\\n/g, '\n'));
      }
      return '';
    };

    const pickHeader = (name) => pick([
      new RegExp(`["']${name}["']\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'),
      new RegExp(`(?:-H|--header)\\s+"${name}:\\s*((?:\\\\.|[^"\\\\])*)"`, 'i'),
      new RegExp(`(?:-H|--header)\\s+'${name}:\\s*((?:\\\\.|[^'\\\\])*)'`, 'i'),
      new RegExp(`^${name}:\\s*(.+)$`, 'im'),
    ]);

    let result = { cookie: '', hif_dliq: '', hif_leim: '', token: '' };

    if (/^[a-z0-9-]+:\s/i.test(text.trim()) && !/^fetch\s*\(/i.test(text.trim())) {
      result = applyImportedHeaders(parseRequestHeaderBlock(text));
    } else {
      result = applyImportedHeaders({
        cookie:
          pickHeader('cookie') ||
          pickHeader('Cookie') ||
          pick([
            /(?:\s|^)(?:-b|--cookie)\s+"((?:\\.|[^"\\])*)"/i,
            /(?:\s|^)(?:-b|--cookie)\s+'((?:\\.|[^'\\])*)'/i,
          ]),
        authorization: pickHeader('authorization') || pickHeader('Authorization'),
        'x-hif-dliq': pickHeader('x-hif-dliq'),
        'x-hif-leim': pickHeader('x-hif-leim'),
      });
    }

    console.log('[DeepSeek export] imported:', {
      cookie: !!result.cookie,
      hif_dliq: !!result.hif_dliq,
      hif_leim: !!result.hif_leim,
      token: !!result.token,
    });

    if (!result.cookie && !result.hif_dliq && !result.hif_leim && !result.token) {
      console.warn(
        '[DeepSeek export] nothing parsed.\n' +
          'Use Network → chat/completion → Copy → Copy as cURL (NOT Copy as fetch).\n' +
          'Or Application → Cookies → ds_session_id → importDeepSeekCookie("value")'
      );
    } else if (!result.cookie) {
      console.warn('[DeepSeek export] cookie missing — use Copy as cURL, not Copy as fetch.');
    }

    return result;
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
    }
    return copyTextFallback(text);
  }

  function copyTextFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      console.log('[DeepSeek export] copied .env block to clipboard');
    } catch {
      console.log('[DeepSeek export] clipboard copy failed — copy from console output');
    }
    document.body.removeChild(ta);
  }

  function exportDeepSeekAuth({ copy = true } = {}) {
    const auth = mergeAuth();
    const json = {
      token: auth.token,
      hif_dliq: auth.hif_dliq,
      hif_leim: auth.hif_leim,
      cookie: auth.cookie,
      wasmUrl: auth.wasmUrl,
    };

    const env = [
      envLine('DEEPSEEK_TOKEN', auth.token),
      envLine('DEEPSEEK_HIF_DLIQ', auth.hif_dliq),
      envLine('DEEPSEEK_HIF_LEIM', auth.hif_leim),
      envLine('DEEPSEEK_COOKIE', auth.cookie),
      envLine('DEEPSEEK_WASM_URL', auth.wasmUrl),
    ].join('\n');

    const missing = [];
    const warnings = [];
    if (!auth.token) missing.push('DEEPSEEK_TOKEN');
    if (!auth.cookie) missing.push('DEEPSEEK_COOKIE');
    if (auth.cookie && !/ds_session_id=/.test(auth.cookie)) {
      warnings.push('DEEPSEEK_COOKIE missing ds_session_id — Network → Copy as cURL, or Application → Cookies → importDeepSeekCookie("...")');
    }
    if (!auth.hif_dliq) warnings.push('DEEPSEEK_HIF_DLIQ empty (often optional; not sent on every completion request)');
    if (!auth.hif_leim) warnings.push('DEEPSEEK_HIF_LEIM empty (optional for many requests)');

    console.log('--- deepseek-auth.json ---');
    console.log(JSON.stringify(json, null, 2));
    console.log('--- .env (Coolify / docker compose) ---');
    console.log(env);

    if (missing.length) {
      console.warn('[DeepSeek export] missing required:', missing.join(', '));
    } else {
      console.log('[DeepSeek export] required fields OK (token + cookie present)');
    }
    if (warnings.length) {
      console.warn('[DeepSeek export] warnings:\n - ' + warnings.join('\n - '));
    }

    if (copy) copyText(env);

    return { json, env, missing, warnings };
  }

  window.installDeepSeekAuthCapture = installDeepSeekAuthCapture;
  window.importDeepSeekRequest = importDeepSeekRequest;
  window.importDeepSeekCookie = importDeepSeekCookie;
  window.exportDeepSeekAuth = exportDeepSeekAuth;

  installDeepSeekAuthCapture();

  console.log('[DeepSeek export] ready');
  console.log('Network → chat/completion → Copy → Copy as cURL');
  console.log('  importDeepSeekRequest(`paste cURL`)');
  console.log('  exportDeepSeekAuth()');
  console.log('Fallback: Application → Cookies → ds_session_id → importDeepSeekCookie("value")');
})();
