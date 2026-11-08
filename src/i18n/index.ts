// Traducción de la interfaz. El código está escrito en español y el español es
// la clave: el diccionario de cada idioma (src/i18n/<código>.json, generado con
// scripts/i18n-traducir.mjs) mapea cada texto a su traducción. Un observador
// traduce los nodos de texto y los atributos visibles (placeholder, title,
// aria-label, data-tip) en cuanto entran en el DOM, así que las vistas no
// necesitan llamar a nada. Los textos con valores (`${n} palabras`) se guardan
// como patrones con marcadores {0}, {1}…
//
// No se traduce nada dentro de [translate="no"] (contenido de la novela, chat,
// propuestas…), ni textareas ni inputs.

export interface Idioma {
  codigo: string;
  nombre: string; // en su propio idioma
  ingles: string; // para las instrucciones de la IA
}

/** Idiomas de la interfaz (con diccionario). */
export const IDIOMAS: Idioma[] = [
  { codigo: "es", nombre: "Español", ingles: "Spanish" },
  { codigo: "en", nombre: "English", ingles: "English" },
  { codigo: "pt", nombre: "Português", ingles: "Portuguese" },
  { codigo: "fr", nombre: "Français", ingles: "French" },
  { codigo: "it", nombre: "Italiano", ingles: "Italian" },
  { codigo: "de", nombre: "Deutsch", ingles: "German" },
  { codigo: "ca", nombre: "Català", ingles: "Catalan" },
  { codigo: "nl", nombre: "Nederlands", ingles: "Dutch" },
  { codigo: "pl", nombre: "Polski", ingles: "Polish" },
  { codigo: "ru", nombre: "Русский", ingles: "Russian" },
  { codigo: "uk", nombre: "Українська", ingles: "Ukrainian" },
  { codigo: "tr", nombre: "Türkçe", ingles: "Turkish" },
  { codigo: "ja", nombre: "日本語", ingles: "Japanese" },
  { codigo: "zh", nombre: "简体中文", ingles: "Simplified Chinese" },
  { codigo: "ko", nombre: "한국어", ingles: "Korean" },
];

/** Idiomas en los que puede escribir la IA (los de la interfaz y más). */
export const IDIOMAS_ESCRITURA: Idioma[] = [
  ...IDIOMAS,
  { codigo: "gl", nombre: "Galego", ingles: "Galician" },
  { codigo: "eu", nombre: "Euskara", ingles: "Basque" },
  { codigo: "pt-BR", nombre: "Português do Brasil", ingles: "Brazilian Portuguese" },
  { codigo: "es-MX", nombre: "Español de México", ingles: "Mexican Spanish" },
  { codigo: "es-AR", nombre: "Español rioplatense", ingles: "Rioplatense (Argentine) Spanish" },
  { codigo: "en-GB", nombre: "British English", ingles: "British English" },
  { codigo: "sv", nombre: "Svenska", ingles: "Swedish" },
  { codigo: "da", nombre: "Dansk", ingles: "Danish" },
  { codigo: "no", nombre: "Norsk", ingles: "Norwegian (Bokmål)" },
  { codigo: "fi", nombre: "Suomi", ingles: "Finnish" },
  { codigo: "cs", nombre: "Čeština", ingles: "Czech" },
  { codigo: "ro", nombre: "Română", ingles: "Romanian" },
  { codigo: "hu", nombre: "Magyar", ingles: "Hungarian" },
  { codigo: "el", nombre: "Ελληνικά", ingles: "Greek" },
  { codigo: "ar", nombre: "العربية", ingles: "Arabic" },
  { codigo: "he", nombre: "עברית", ingles: "Hebrew" },
  { codigo: "hi", nombre: "हिन्दी", ingles: "Hindi" },
  { codigo: "id", nombre: "Bahasa Indonesia", ingles: "Indonesian" },
  { codigo: "vi", nombre: "Tiếng Việt", ingles: "Vietnamese" },
  { codigo: "th", nombre: "ไทย", ingles: "Thai" },
  { codigo: "zh-TW", nombre: "繁體中文", ingles: "Traditional Chinese" },
  { codigo: "la", nombre: "Latina", ingles: "Latin" },
];

const cargadores = import.meta.glob<{ default: Record<string, string> }>("./*.json");

let actual = "es";
let exactos = new Map<string, string>();
let patrones: { re: RegExp; plantilla: string; pista: string; generico: boolean }[] = [];
const salidas = new Set<string>();
const cache = new Map<string, string | null>();

export function idiomaUI(): string {
  return actual;
}

/** Código BCP 47 para fechas y números. */
export function locale(): string {
  return actual === "zh" ? "zh-CN" : actual;
}

/** Idioma del sistema si hay diccionario; si no, inglés (o español si es una variante). */
export function idiomaSistema(): string {
  for (const l of navigator.languages ?? [navigator.language]) {
    const c = l.toLowerCase().split("-")[0];
    if (IDIOMAS.some((x) => x.codigo === c)) return c;
  }
  return "en";
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function cargarIdioma(codigo: string): Promise<void> {
  actual = IDIOMAS.some((x) => x.codigo === codigo) ? codigo : "es";
  document.documentElement.lang = actual;
  exactos = new Map();
  patrones = [];
  cache.clear();
  if (actual === "es") return;
  const cargar = cargadores[`./${actual}.json`];
  if (!cargar) return;
  const dic = (await cargar()).default;
  for (const [es, tr] of Object.entries(dic)) {
    if (!tr) continue;
    salidas.add(tr);
    if (/\{\d+\}/.test(es)) {
      const trozos = es.split(/\{\d+\}/);
      const fuente = es.split(/(\{\d+\})/).map((t) => (/^\{\d+\}$/.test(t) ? "([\\s\\S]*?)" : escapar(t))).join("");
      const pista = trozos.reduce((a, b) => (b.length > a.length ? b : a), "");
      // Patrón genérico («{0} de {1}», «Cap. {0}»): solo con valores numéricos, para no
      // traducir títulos ni nombres del usuario («El faro de Aldara»).
      const generico = pista.trim().replace(/[^\p{L}]/gu, "").length < 4;
      patrones.push({ re: new RegExp(`^${fuente}$`), plantilla: tr, pista, generico });
    } else exactos.set(es, tr);
  }
  // Los patrones más específicos primero.
  patrones.sort((a, b) => b.pista.length - a.pista.length);
}

/** Traduce un texto (sin espacios de los bordes) o devuelve null si no hay traducción. */
function buscar(s: string): string | null {
  if (cache.has(s)) return cache.get(s)!;
  let r: string | null = exactos.get(s) ?? null;
  if (r === null && !salidas.has(s)) {
    for (const p of patrones) {
      if (!s.includes(p.pista)) continue;
      const m = p.re.exec(s);
      if (!m) continue;
      if (p.generico && m.slice(1).some((v) => !/^[\d\s.,:%×+\-–]*$/.test(v))) continue;
      // Los valores también pueden ser textos traducibles («Nuevo {0}» → «personaje»).
      r = p.plantilla.replace(/\{(\d+)\}/g, (_, i: string) => {
        const v = m[Number(i) + 1] ?? "";
        return buscar(v.trim()) ?? v;
      });
      break;
    }
  }
  if (cache.size > 20000) cache.clear();
  cache.set(s, r);
  return r;
}

/** Para código que necesita el texto ya traducido (diálogos nativos, títulos…). */
export function t(s: string): string {
  if (actual === "es") return s;
  const limpio = s.trim();
  const r = buscar(limpio);
  return r === null ? s : s.replace(limpio, r);
}

const ATRIBUTOS = ["placeholder", "title", "aria-label", "data-tip"];

function excluido(el: Element | null): boolean {
  if (!el) return true;
  const tag = el.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "CODE" || tag === "PRE") return true;
  return !!el.closest('[translate="no"], [contenteditable="true"]');
}

function traducirTexto(n: Text): void {
  const v = n.data;
  if (!v.trim() || excluido(n.parentElement)) return;
  const tr = t(v);
  if (tr !== v) n.data = tr;
}

function traducirAtributos(el: Element): void {
  for (const a of ATRIBUTOS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const tr = t(v);
    if (tr !== v) el.setAttribute(a, tr);
  }
}

function traducirArbol(raiz: Node): void {
  if (raiz.nodeType === Node.TEXT_NODE) return traducirTexto(raiz as Text);
  if (raiz.nodeType !== Node.ELEMENT_NODE && raiz.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (raiz instanceof Element) {
    if (excluido(raiz) && raiz.tagName !== "TEXTAREA") return;
    traducirAtributos(raiz);
  }
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n instanceof Element && (n.getAttribute("translate") === "no" || n.getAttribute("contenteditable") === "true") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) traducirTexto(n as Text);
    else traducirAtributos(n as Element);
  }
}

let observador: MutationObserver | null = null;

/** Traduce lo que ya hay y todo lo que se añada después. */
export function observar(): void {
  if (actual === "es" || observador) return;
  document.title = t(document.title);
  traducirArbol(document.body);
  observador = new MutationObserver((cambios) => {
    for (const c of cambios) {
      if (c.type === "childList") c.addedNodes.forEach(traducirArbol);
      else if (c.type === "characterData") traducirTexto(c.target as Text);
      else if (c.type === "attributes") traducirAtributos(c.target as Element);
    }
  });
  observador.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
}
