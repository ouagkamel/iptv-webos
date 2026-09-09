// tests/helpers/fetchRouter.mjs — fetch simulé par table de routes (URL → contenu).
// Response minimale : ok/status/headers.get/body.getReader()/json()/text().
const routes = new Map();

export function setRoute(url, payload, opts) {
  routes.set(url, { payload: payload, opts: opts || {} });
}
export function clearRoutes() { routes.clear(); }
export function hasRoute(url) { return routes.has(url); }

function makeResponse(url, entry) {
  const opts = entry.opts || {};
  const status = opts.status || 200;
  let bytes;
  if (typeof entry.payload === 'string') {
    bytes = new TextEncoder().encode(entry.payload);
  } else if (entry.payload instanceof Uint8Array) {
    bytes = entry.payload;
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(entry.payload));
  }

  const chunkSize = opts.chunkSize || 0;
  const headers = {
    get: function (k) {
      if (k.toLowerCase() === 'content-length' && opts.contentLength !== undefined) {
        return String(opts.contentLength);
      }
      if (k.toLowerCase() === 'content-length' && opts.contentLength === undefined) {
        return String(bytes.length);
      }
      return null;
    }
  };

  const body = {
    getReader: function () {
      let pos = 0;
      return {
        read: async function () {
          if (pos >= bytes.length) return { done: true, value: undefined };
          const size = chunkSize > 0 ? chunkSize : bytes.length;
          const value = bytes.subarray(pos, pos + size);
          pos += size;
          return { done: false, value: value };
        },
        cancel: async function () {}
      };
    }
  };

  return {
    ok: status >= 200 && status < 300,
    status: status,
    headers: headers,
    body: opts.noBody ? null : body,
    text: async function () { return new TextDecoder().decode(bytes); },
    json: async function () {
      return typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;
    }
  };
}

export function installFetchRouter(globalObj) {
  globalObj.fetch = function (url, signal) {
    const entry = routes.get(url);
    if (signal && signal.aborted) {
      return Promise.reject(new Error('AbortError'));
    }
    if (!entry) {
      return Promise.reject(new Error('NO_ROUTE: ' + url));
    }
    if (entry.opts && entry.opts.delayMs) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (signal && signal.aborted) return reject(new Error('AbortError'));
          resolve(makeResponse(url, entry));
        }, entry.opts.delayMs);
      });
    }
    return Promise.resolve(makeResponse(url, entry));
  };
}
