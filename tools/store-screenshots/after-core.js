// Po načtení core.js: doména snímku (stránky jsou file://, rozšíření by jinak bralo alza.cz)
AlzaCore.getDomainKey = () => window.MARKET.domain;
// Snímky nemají službu na pozadí – zápisy (AlzaStore) se provedou rovnou do náhrady storage
if (window.AlzaStore) AlzaStore.isWriter = true;
