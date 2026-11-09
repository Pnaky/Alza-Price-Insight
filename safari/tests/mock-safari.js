// Napodobenina API rozšíření v Safari pro testy ve WKWebView (tests/run.sh). Jako v Safari chybí chrome.notifications
// (doplní je src/safari/notifications.js), nativní aplikaci zastupuje mock.native / mock.nativeReply.
// window.__FAKE_TIMERS__ = true → setTimeout / setInterval stránky řídí mock.advance(ms)
(() => {
  const errors = [];
  addEventListener("error", (event) => errors.push(`${event.message} @ ${event.filename}:${event.lineno}`));
  addEventListener("unhandledrejection", (event) => errors.push(`unhandled rejection: ${event.reason?.stack || event.reason}`));

  const real = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  };

  // === Řízený čas ===
  const clock = { now: 0, seq: 0, timers: new Map() };
  if (window.__FAKE_TIMERS__) {
    window.setTimeout = (fn, ms = 0, ...args) => {
      const id = ++clock.seq;
      clock.timers.set(id, { at: clock.now + Math.max(0, Number(ms) || 0), fn, args, every: 0 });
      return id;
    };
    window.setInterval = (fn, ms = 0, ...args) => {
      const id = ++clock.seq;
      const every = Math.max(1, Number(ms) || 0);
      clock.timers.set(id, { at: clock.now + every, fn, args, every });
      return id;
    };
    window.clearTimeout = window.clearInterval = (id) => clock.timers.delete(id);
  }

  // Jedna úloha smyčky událostí bez časovače – skrytá stránka má časovače přiškrcené, zprávy ne
  const tick = () =>
    new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });
  const settle = async (rounds = 5) => {
    for (let i = 0; i < rounds; i++) await tick();
  };

  async function advance(ms) {
    const end = clock.now + ms;
    for (;;) {
      await settle();
      let next = null;
      clock.timers.forEach((timer, id) => {
        if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
      });
      if (!next) break;
      clock.now = next.timer.at;
      if (next.timer.every) next.timer.at += next.timer.every;
      else clock.timers.delete(next.id);
      try {
        next.timer.fn(...next.timer.args);
      } catch (error) {
        errors.push(String(error?.stack || error));
      }
    }
    clock.now = end;
    await settle();
  }

  // Čeká, až platí podmínka (s řízeným časem po 100 ms, jinak skutečně)
  async function until(predicate, steps = 200) {
    for (let i = 0; i < steps; i++) {
      if (predicate()) return true;
      if (window.__FAKE_TIMERS__) await advance(100);
      else await new Promise((resolve) => real.setTimeout(resolve, 20));
    }
    return predicate();
  }

  // === Události ===
  const event = () => {
    const listeners = [];
    return {
      listeners,
      addListener: (listener) => listeners.push(listener),
      removeListener: (listener) => listeners.splice(listeners.indexOf(listener), 1),
      hasListener: (listener) => listeners.includes(listener),
      hasListeners: () => listeners.length > 0,
    };
  };

  // === storage ===
  const clone = (value) => (value === undefined ? undefined : structuredClone(value));
  function area(name, data, onChanged) {
    return {
      async get(keys) {
        if (keys === null || keys === undefined) return clone(data);
        if (typeof keys === "string") keys = [keys];
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, clone(data[key])]));
        return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, key in data ? clone(data[key]) : fallback]));
      },
      async set(items) {
        const changes = {};
        Object.entries(items).forEach(([key, value]) => {
          changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
          data[key] = clone(value);
        });
        tick().then(() => onChanged.listeners.forEach((listener) => listener(changes, name)));
      },
      async remove(keys) {
        const changes = {};
        [].concat(keys).forEach((key) => {
          if (!(key in data)) return;
          changes[key] = { oldValue: data[key] };
          delete data[key];
        });
        tick().then(() => onChanged.listeners.forEach((listener) => listener(changes, name)));
      },
      async clear() {
        Object.keys(data).forEach((key) => delete data[key]);
      },
      async getBytesInUse() {
        return JSON.stringify(data).length;
      },
    };
  }

  const local = {};
  const session = {};
  const onChanged = event();
  const onMessage = event();
  const alarms = new Map();
  const onAlarm = event();
  const native = [];
  const sent = [];
  const tabs = [];
  const badge = [];
  const permissionRequests = [];
  const base = "safari-web-extension://0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0/";

  const mock = {
    errors,
    clock,
    advance,
    until,
    settle,
    local,
    session,
    alarms,
    native,
    sent,
    tabs,
    badge,
    permissionRequests,
    permissionsGranted: false,
    permissionsRequestResult: true,
    nativeReply: null, // (zpráva) → odpověď aplikace; výchozí { ok: true, level: "granted" }
    dispatchMessage(message, sender = { id: "test" }) {
      onMessage.listeners.forEach((listener) => listener(message, sender, () => {}));
    },
  };

  window.chrome = {
    runtime: {
      id: "local.AlzaPriceInsight.Extension (UNSIGNED)",
      getURL: (path = "") => base + String(path).replace(/^\//, ""),
      getManifest: () => structuredClone(window.__MANIFEST__),
      getPlatformInfo: async () => ({ os: "mac", arch: "arm" }),
      sendMessage: async (message) => {
        sent.push(message);
        return undefined;
      },
      sendNativeMessage: async (application, message) => {
        native.push(clone(message));
        return mock.nativeReply ? mock.nativeReply(message) : { ok: true, level: "granted" };
      },
      openOptionsPage: async () => tabs.push(base + "src/options/options.html"),
      onMessage,
      onInstalled: event(),
      onStartup: event(),
    },
    storage: { local: area("local", local, onChanged), session: area("session", session, onChanged), onChanged },
    alarms: {
      async create(name, info = {}) {
        const scheduledTime = info.when ?? Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60000;
        alarms.set(name, { name, scheduledTime, ...(info.periodInMinutes && { periodInMinutes: info.periodInMinutes }) });
      },
      get: async (name) => clone(alarms.get(name)),
      getAll: async () => [...alarms.values()].map(clone),
      clear: async (name) => alarms.delete(name),
      onAlarm,
    },
    action: {
      setBadgeText: async (details) => badge.push({ text: details.text }),
      setBadgeBackgroundColor: async (details) => badge.push({ color: details.color }),
      setTitle: async (details) => badge.push({ title: details.title }),
    },
    i18n: {
      getMessage: (key) => ({ name: "Alza Price Insight" })[key] || "",
      getUILanguage: () => "cs-CZ",
    },
    tabs: {
      create: async (details) => tabs.push(details.url),
      query: async () => [],
      sendMessage: async () => {
        throw new Error("no receiver");
      },
    },
    permissions: {
      contains: async () => mock.permissionsGranted,
      request: async (details) => {
        permissionRequests.push(clone(details));
        if (mock.permissionsRequestResult) mock.permissionsGranted = true;
        return mock.permissionsRequestResult;
      },
      onAdded: event(),
      onRemoved: event(),
    },
  };

  // Stránky Alzy test nestahuje; obrázek produktu (náhled notifikace) je vygenerované PNG
  window.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url.startsWith("https://image.alza.cz/")) {
      const canvas = new OffscreenCanvas(60, 40);
      const context = canvas.getContext("2d");
      context.fillStyle = "#c9dd03";
      context.fillRect(0, 0, 60, 40);
      return new Response(await canvas.convertToBlob({ type: "image/png" }), { headers: { "content-type": "image/png" } });
    }
    throw new TypeError(`network disabled in test: ${url}`);
  };

  // === Výsledky ===
  let failures = 0;
  const report = (message) => window.webkit.messageHandlers.test.postMessage({ log: message });
  window.__test = {
    mock,
    log: report,
    check(name, condition, detail = "") {
      if (!condition) failures++;
      report(`${condition ? "✓" : "✗"} ${name}${!condition && detail ? `\n    ${detail}` : ""}`);
    },
    finish() {
      report(failures ? `${failures} test(y) selhal(y)` : "vše v pořádku");
      window.webkit.messageHandlers.test.postMessage({ done: failures === 0 });
    },
    fail(error) {
      report(`✗ výjimka v testu: ${error?.stack || error}`);
      window.webkit.messageHandlers.test.postMessage({ done: false });
    },
  };
})();
