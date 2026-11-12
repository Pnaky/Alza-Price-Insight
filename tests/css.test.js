// Pravidla v css/main.css, která hlídají layout cen na stránkách Alzy: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const content = fs.readFileSync(path.join(ROOT, "src/content.js"), "utf8");

// Selektory všech pravidel s deklaracemi: [[selektor, deklarace]]
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, body]) =>
  selectors.split(",").map((selector) => [selector.trim(), body])
);

// Spinner načítání ceny v seznamu se vkládá ZA poslední cenu (addSpinnerToItem). Poslední cena pak už není :last-child
// a dostala by pravý okraj – ceny řádku uskočily doleva (2026-11-10). Každé pravidlo „poslední cena“ musí platit
// i pro cenu, za kterou je už jen spinner, se stejnými deklaracemi
test("poslední cena se spinnerem za sebou má stejné styly jako bez něj (ceny při načítání neuskočí)", () => {
  assert.match(content, /priceContainer\.appendChild\(spinnerContainer\)/, "spinner se vkládá jako poslední prvek bloku ceny");
  const spinnerSuffix = ":has(+ .alza-price-tracker-spinner-container:last-child)";
  const lastChild = rules.filter(([selector]) => /^\.alza-price-tracker-price[\w-]*:last-child$/.test(selector));
  assert.ok(lastChild.length >= 2, "pravidla :last-child pro ceny v main.css");
  for (const [selector, body] of lastChild) {
    const withSpinner = selector.replace(/:last-child$/, spinnerSuffix);
    const twin = rules.find(([other]) => other === withSpinner);
    assert.ok(twin, `chybí ${withSpinner}`);
    assert.equal(twin[1].replace(/\s+/g, ""), body.replace(/\s+/g, ""), `jiné deklarace u ${withSpinner}`);
  }
  // Spinner sám layout neovlivní
  const spinner = rules.find(([selector]) => selector === ".alza-price-tracker-spinner-container");
  assert.match(spinner?.[1] || "", /position:\s*absolute/);
});
