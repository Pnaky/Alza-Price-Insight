// Safari: API notifikací (chrome.notifications) rozšíření v Safari zatím nemají. Bez něj by služba na pozadí
// spadla hned na chrome.notifications.onClicked. Tento soubor ho nahradí mostem do nativní aplikace
// (Alza Price Insight.app, SafariWebExtensionHandler): notifikaci zobrazí macOS jménem aplikace a kliknutí na ni
// otevře produkt v Safari (obsluhuje aplikace – události onClicked / onClosed se sem proto nikdy nevrátí).
//
// Načítá se jako první skript stránky na pozadí a v průvodci nastavením (getPermissionLevel). Když Safari API
// notifikací jednou dostane, použije se jeho vlastní a tento soubor nic nedělá.
(() => {
  if (typeof chrome === "undefined" || chrome.notifications?.create) return;
  if (typeof chrome.runtime?.sendNativeMessage !== "function") return;

  // Safari identifikátor aplikace nečte – zpráva jde vždy do aplikace, která rozšíření obsahuje
  const NATIVE_APP = "application.id";
  // Cíl kliknutí si background.js (createNotification) ukládá do storage.session před vytvořením notifikace
  const targetKey = (notificationId) => `notifyTarget_${notificationId}`;

  async function sendNative(message) {
    const reply = await chrome.runtime.sendNativeMessage(NATIVE_APP, message);
    if (!reply?.ok) throw new Error(`Alza Price Insight.app: ${reply?.error || "bez odpovědi"}`);
    return reply;
  }

  async function readTarget(notificationId) {
    try {
      const key = targetKey(notificationId);
      const { [key]: url } = await chrome.storage.session.get(key);
      return typeof url === "string" ? url : null;
    } catch {
      return null;
    }
  }

  const event = () => {
    const listeners = new Set();
    return {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
      hasListener: (listener) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
    };
  };

  const notifications = {
    safariNativeBridge: true,

    async create(notificationId, options) {
      if (notificationId && typeof notificationId === "object") [notificationId, options] = [undefined, notificationId];
      const id = String(notificationId || `alza-safari-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      const url = await readTarget(id);
      // Obrázek produktu přichází jako data URL (loadProductIcon) – ikonu rozšíření ukáže macOS sám (ikona aplikace)
      const image = typeof options?.iconUrl === "string" && options.iconUrl.startsWith("data:image/") ? options.iconUrl : null;
      await sendNative({
        type: "notify",
        id,
        title: String(options?.title ?? ""),
        message: String(options?.message ?? ""),
        url,
        image,
      });
      // Kliknutí obslouží aplikace a onClosed nepřijde – uložený cíl už není potřeba. Po chybě zůstane:
      // background.js zkusí notifikaci znovu bez obrázku a cíl pak uklidí sám
      if (url) chrome.storage.session.remove(targetKey(id)).catch(() => {});
      return id;
    },

    async clear(notificationId) {
      try {
        await sendNative({ type: "clear", id: String(notificationId) });
        return true;
      } catch {
        return false;
      }
    },

    // "granted" / "denied"; dokud uživatel notifikace v macOS nepovolil ani nezakázal, undefined (průvodce nabídne zkoušku)
    async getPermissionLevel() {
      const { level } = await sendNative({ type: "permission" });
      if (level === "denied") return "denied";
      if (level === "granted" || level === "provisional" || level === "ephemeral") return "granted";
      return undefined;
    },

    async getAll() {
      return {};
    },

    async update() {
      return false;
    },

    onClicked: event(),
    onClosed: event(),
    onButtonClicked: event(),
    onShown: event(),
    onPermissionLevelChanged: event(),
    onShowSettings: event(),
  };

  // Objekt chrome je v Safari obyčejně rozšiřitelný; kdyby nebyl, zkusit definici vlastnosti a nakonec obal
  const install = (namespace) => {
    if (!namespace || namespace.notifications?.create) return namespace;
    try {
      namespace.notifications = notifications;
    } catch {
      // nelze přiřadit
    }
    if (namespace.notifications === notifications) return namespace;
    try {
      Object.defineProperty(namespace, "notifications", { value: notifications, configurable: true, enumerable: true });
    } catch {
      // nelze definovat
    }
    if (namespace.notifications === notifications) return namespace;
    return new Proxy(namespace, { get: (target, property) => (property === "notifications" ? notifications : Reflect.get(target, property)) });
  };

  const patched = install(chrome);
  if (patched !== chrome) {
    try {
      globalThis.chrome = patched;
    } catch (error) {
      console.error("Alza Price Insight (Safari): náhradu API notifikací se nepodařilo nainstalovat", error);
    }
  }
  if (typeof browser !== "undefined" && browser !== chrome) {
    const patchedBrowser = install(browser);
    if (patchedBrowser !== browser) {
      try {
        globalThis.browser = patchedBrowser;
      } catch {
        // browser.* rozšíření nepoužívá
      }
    }
  }
})();
