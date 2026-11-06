// Vstup služby na pozadí v Chromu (manifest background.service_worker). Firefox načítá stejné skripty
// ze seznamu background.scripts – pořadí musí odpovídat.
importScripts("../shared/core.js", "../shared/store.js", "product-pages.js", "../background.js");
