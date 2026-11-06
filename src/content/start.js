// Content script: spuštění AlzaPriceTracker – až po načtení všech jeho částí (content.js, content/*.js)
// Inicializace
AlzaPriceTracker.init();
window.AlzaPriceTracker = AlzaPriceTracker; // Pro debugging v konzoli (kontext rozšíření, ne stránky)
