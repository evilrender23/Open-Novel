// Extrae los textos de interfaz (en español) del código a src/i18n/fuente.json.
// Recorre los literales de TypeScript con el compilador de TS y las cadenas de
// Rust (mensajes de error que llegan a la interfaz). Los `${…}` y `{…}` se
// convierten en marcadores {0}, {1}… que el traductor conserva.
//
//   node scripts/i18n-extraer.mjs && node scripts/i18n-traducir.mjs

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const raiz = path.resolve(import.meta.dirname, "..");
const textos = new Set();
/** Textos de los bloques ignorados: nunca se traducen, aunque aparezcan en otro sitio. */
const ignorados = new Set();
const explicitos = new Set(); // los de t("…") se traducen siempre

/** ¿Es texto para personas (y no una clase CSS, una clave, una ruta…)? */
function esTexto(s) {
  s = s.trim();
  if (s.length < 2 || s.length > 320 || s.includes("\n") || s.includes("{{")) return false;
  if (!/\p{L}/u.test(s)) return false;
  if (/^(plugin:|https?:|\.\/|#|--|data-|aria-)/.test(s)) return false;
  if (/^M-?[\d.]/.test(s) || /[<>%]|"\]|\[data-/.test(s)) return false; // trazos SVG, HTML, selectores
  if (/(=>|::|\.ts$|\.md$|\.json$|^[a-z0-9_-]+(\.[a-z0-9_-]+)+$)/.test(s)) return false;
  if (!s.includes(" ")) {
    // Una sola palabra: con mayúscula inicial o con letras no ASCII (Planificar, Sí, Título…).
    if (/[./:_=<>|\\]/.test(s)) return false;
    if (!/^\p{Lu}/u.test(s) && !/[^\x00-\x7F]/.test(s)) return false;
    if (/^[A-Z0-9_]+$/.test(s) && s.length > 2) return false; // CONSTANTES
  }
  // Selectores y listas de clases.
  if (/^[a-z][\w-]*( [a-z][\w-]*)+$/.test(s) && /-/.test(s)) return false;
  return true;
}

function añadir(s) {
  const t = s.replace(/\s+/g, " ").trim();
  if (esTexto(t.replace(/\{\d+\}/g, "x"))) textos.add(t);
}

function recorrerTs(archivo) {
  // Los bloques entre «// i18n-ignorar» y «// i18n-fin» son contenido (novela de ejemplo…).
  const codigo = fs.readFileSync(archivo, "utf8").replace(/\/\/ i18n-ignorar[\s\S]*?\/\/ i18n-fin/g, (m) => {
    for (const s of m.matchAll(/"((?:[^"\\]|\\.)*)"/g)) ignorados.add(s[1]);
    return m.replace(/[^\n]/g, " ");
  });
  const sf = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true);
  const visitar = (n) => {
    // Las importaciones y las claves de tipos no son texto de interfaz.
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
    const llamada = n.parent && ts.isCallExpression(n.parent) ? n.parent.expression.getText() : "";
    const pos = llamada ? n.parent.arguments.indexOf(n) : -1;
    // t("…"), hijos de h(tag, props, …) y la etiqueta de btn("…"): siempre son texto visible.
    const enT = llamada === "t" || (llamada === "h" && pos >= 2) || (llamada === "btn" && pos === 0);
    if (enT && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) {
      const s = n.text.replace(/\s+/g, " ").trim();
      if (s) textos.add(s);
      if (s && llamada === "t") explicitos.add(s);
    }
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) añadir(n.text);
    else if (ts.isTemplateExpression(n)) {
      let s = n.head.text;
      n.templateSpans.forEach((sp, i) => (s += `{${i}}` + sp.literal.text));
      // Plantillas largas con varios trozos de texto: se extraen los trozos sueltos también.
      añadir(s);
      for (const parte of [n.head.text, ...n.templateSpans.map((sp) => sp.literal.text)]) añadir(parte);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
}

function recorrerRs(archivo) {
  const codigo = fs.readFileSync(archivo, "utf8").replace(/#\[cfg\(test\)\][\s\S]*$/, "");
  for (const m of codigo.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    let i = 0;
    const s = m[1].replace(/\\"/g, '"').replace(/\{[^{}]*\}/g, () => `{${i++}}`);
    if (/[áéíóúñ¿¡]|^[A-ZÁÉÍÓÚ][a-záéíóúñ]+ /.test(s)) añadir(s);
  }
}

function listar(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "i18n" ? [] : listar(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });
}

for (const f of listar(path.join(raiz, "src"), ".ts")) recorrerTs(f);
for (const f of listar(path.join(raiz, "src-tauri/src"), ".rs")) recorrerRs(f);

const salida = [...textos].filter((s) => explicitos.has(s) || !ignorados.has(s)).sort((a, b) => a.localeCompare(b, "es"));
fs.writeFileSync(path.join(raiz, "src/i18n/fuente.json"), JSON.stringify(salida, null, 1) + "\n");
console.log(`${salida.length} textos en src/i18n/fuente.json`);
