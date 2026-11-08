// Ajustes globales de la aplicación (no dependen de la novela abierta).

import { api } from "./api";
import { IDIOMAS, IDIOMAS_ESCRITURA, idiomaUI } from "./i18n";

export type TipoProveedor = "claude-code" | "anthropic" | "openai" | "openrouter" | "ollama" | "compatible";

export interface Proveedor {
  id: string;
  tipo: TipoProveedor;
  nombre: string;
  clave: string;
  url: string;
  modelos: string[];
}

export type Funcion = "escritura" | "chat" | "codex" | "resumen";

export interface Ajustes {
  tema: "sistema" | "claro" | "oscuro";
  acento: string;
  fuenteEditor: "serif" | "sans" | "mono";
  tamanoEditor: number;
  anchoEditor: number;
  interlineado: number;
  resaltarCodex: boolean;
  proveedores: Proveedor[];
  modelos: Record<Funcion, string>; // "idProveedor::modelo"
  temperatura: number;
  maxTokens: number;
  claudeRuta: string;
  agente: { modelo: string; permisos: string; esfuerzo: string };
  palabrasContexto: number;
  /** Lo lee también el backend (update.rs) para decidir si compila solo las versiones nuevas. */
  actualizacionesAuto: boolean;
  /** Nombres, palabras y frases típicas de la IA que nunca debe usar (una por línea). */
  palabrasEvitar: string;
  /** Idioma de la interfaz ("" = el del sistema). */
  idioma: string;
  /** Idioma en que escribe la IA: "novela" (el de cada novela), "interfaz" o un idioma concreto. */
  idiomaIA: string;
  /** Añadir a todo prompt la orden de escribir solo en ese idioma. */
  forzarIdioma: boolean;
}

export const PROVEEDORES_BASE: Record<TipoProveedor, { nombre: string; url: string; modelos: string[]; necesitaClave: boolean }> = {
  "claude-code": { nombre: "Claude Code CLI", url: "", modelos: ["sonnet", "opus", "haiku"], necesitaClave: false },
  anthropic: { nombre: "Anthropic API", url: "https://api.anthropic.com/v1", modelos: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"], necesitaClave: true },
  openai: { nombre: "OpenAI", url: "https://api.openai.com/v1", modelos: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o"], necesitaClave: true },
  openrouter: { nombre: "OpenRouter", url: "https://openrouter.ai/api/v1", modelos: ["anthropic/claude-sonnet-4.5", "openai/gpt-4.1", "google/gemini-2.5-pro"], necesitaClave: true },
  ollama: { nombre: "Ollama (local)", url: "http://localhost:11434/v1", modelos: ["llama3.1"], necesitaClave: false },
  compatible: { nombre: "Compatible con OpenAI", url: "http://localhost:1234/v1", modelos: [], necesitaClave: false },
};

/** Bloque para el prompt de sistema: se añade a TODA generación (prompts propios incluidos). */
export function instruccionEvitar(): string {
  const lineas = (ajustes.palabrasEvitar ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lineas.length) return "";
  return `<estilo_a_evitar>
PROHIBIDO usar estas palabras, nombres y frases (ni variantes, ni plurales, ni traducciones). Son muletillas que delatan texto escrito por una IA:
${lineas.map((l) => `- ${l}`).join("\n")}
Qué hacer en su lugar (no sustituyas una muletilla por un sinónimo):
- Nombre propio nuevo: sobrio y coherente con el mundo, la época y la lengua de la novela; mira cómo se llaman los del Codex.
- Imagen o comparación: un objeto, sonido o gesto concreto que ya esté en la escena, no una abstracción.
- Emoción: lo que el personaje hace, dice o toca; no la nombres ni la expliques después.
- Evita la estructura «no era X, era Y», los tríos de adjetivos y los cierres de párrafo que resumen lo que se acaba de mostrar.
</estilo_a_evitar>`;
}

/** Nombre del idioma de la interfaz en su propia lengua (valor por defecto de las novelas nuevas). */
export function nombreIdiomaUI(): string {
  return IDIOMAS.find((x) => x.codigo === idiomaUI())?.nombre ?? "Español";
}

/**
 * Idioma en que debe escribir la IA. `idiomaNovela` es el campo «Idioma de la
 * prosa» de la novela abierta (texto libre: «español», «English», «Galego»…).
 */
export function idiomaEscritura(idiomaNovela?: string): string {
  const elegido = ajustes.idiomaIA === "interfaz" ? nombreIdiomaUI() : ajustes.idiomaIA === "novela" || !ajustes.idiomaIA ? idiomaNovela?.trim() || nombreIdiomaUI() : ajustes.idiomaIA;
  const c = elegido.trim().toLocaleLowerCase();
  const conocido = IDIOMAS_ESCRITURA.find((x) => x.codigo.toLowerCase() === c || x.nombre.toLocaleLowerCase() === c || x.ingles.toLowerCase() === c);
  // Con el nombre en inglés al lado, los modelos no dudan («Català (Catalan)»).
  return conocido && conocido.nombre !== conocido.ingles ? `${conocido.nombre} (${conocido.ingles})` : elegido;
}

/** Orden de idioma para el prompt de sistema (vacía si no se fuerza). */
export function instruccionIdioma(idiomaNovela?: string): string {
  if (!ajustes.forzarIdioma) return "";
  const idioma = idiomaEscritura(idiomaNovela);
  return `IDIOMA OBLIGATORIO: escribe toda tu respuesta en ${idioma}, aunque estas instrucciones, el contexto, el Codex, el texto anterior o el mensaje del usuario estén en otro idioma. No traduzcas los nombres propios ni mezcles idiomas (salvo diálogos que lo exijan en la historia). Usa la ortografía, la puntuación y las comillas de diálogo propias de ese idioma.
LANGUAGE: write your entire answer in ${idioma}, whatever the language of these instructions or the context.`;
}

export const ACENTOS = ["#0053fd", "#6d2ebf", "#1f8a65", "#c25e2c", "#cf2d56", "#4c7f8c", "#17171a"];

/** Muletillas, nombres y clichés que delatan texto escrito por IA. */
export const PALABRAS_EVITAR_DEFECTO = [
  "# Nombres inventados típicos de la IA",
  "Valdoria, Eldoria, Aldoria, Eldrin, Vess, Vesper, Kael, Kaelen, Elara, Lyra, Lyria, Seraphina, Thorne, Zephyr, Aria, Nyx, Eira, Aethel, Elysia, Caelum, Sylas, Orin, Mira Voss, Voss, Ashcroft, Blackwood, Nightshade",
  "# Palabras comodín",
  "ecos, eco de, tapiz, sinfonía de, danza de, crisol, mosaico de, testamento de, palpable, etéreo, inefable, susurro de, resonar, reverberar, ozono, petricor, cacofonía, vorágine, umbral (como metáfora), entramado, amalgama, faro de esperanza, en el corazón de, un mar de",
  "# Frases hechas",
  "un escalofrío le recorrió la espalda",
  "soltó un aliento que no sabía que estaba conteniendo",
  "no pudo evitar sonreír",
  "algo cambió en su interior",
  "el peso de sus palabras",
  "una mezcla de miedo y determinación",
  "sus ojos brillaron con",
  "el silencio se hizo denso",
  "el aire estaba cargado de",
  "una sonrisa que no le llegó a los ojos",
  "como si el mundo contuviera la respiración",
  "y por primera vez en mucho tiempo",
  "no era solo X, era Y",
].join("\n");

function predeterminados(): Ajustes {
  return {
    tema: "sistema",
    acento: "#0053fd",
    fuenteEditor: "serif",
    tamanoEditor: 17,
    anchoEditor: 42,
    interlineado: 1.7,
    resaltarCodex: true,
    proveedores: [{ id: "claude", tipo: "claude-code", nombre: "Claude Code CLI", clave: "", url: "", modelos: ["sonnet", "opus", "haiku"] }],
    modelos: { escritura: "claude::sonnet", chat: "claude::sonnet", codex: "claude::sonnet", resumen: "claude::haiku" },
    temperatura: 0.8,
    maxTokens: 2048,
    claudeRuta: "",
    agente: { modelo: "sonnet", permisos: "acceptEdits", esfuerzo: "" },
    palabrasContexto: 1500,
    actualizacionesAuto: true,
    palabrasEvitar: PALABRAS_EVITAR_DEFECTO,
    idioma: "",
    idiomaIA: "novela",
    forzarIdioma: true,
  };
}

export let ajustes: Ajustes = predeterminados();

export async function cargarAjustes(): Promise<void> {
  try {
    const json = await api.ajustesLeer();
    if (json) {
      const g = JSON.parse(json) as Partial<Ajustes>;
      const p = predeterminados();
      ajustes = { ...p, ...g, modelos: { ...p.modelos, ...(g.modelos ?? {}) }, agente: { ...p.agente, ...(g.agente ?? {}) } };
      if (!ajustes.proveedores?.length) ajustes.proveedores = p.proveedores;
    }
  } catch (e) {
    console.warn("Ajustes por defecto:", e);
  }
  aplicarApariencia();
}

let timer = 0;
export function guardarAjustes(): void {
  aplicarApariencia();
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void api.ajustesGuardar(JSON.stringify(ajustes, null, 2)), 300);
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", () => aplicarApariencia());

export function esOscuro(): boolean {
  return ajustes.tema === "oscuro" || (ajustes.tema === "sistema" && media.matches);
}

export function aplicarApariencia(): void {
  const root = document.documentElement;
  root.classList.toggle("dark", esOscuro());
  root.style.setProperty("--theme-primary", ajustes.acento);
  // En oscuro, el acento se aclara (como el `#4a84fe` del skin Nous).
  root.style.setProperty("--theme-midground", esOscuro() ? `color-mix(in srgb, ${ajustes.acento} 72%, #fff)` : ajustes.acento);
  const fuentes = {
    serif: "var(--font-serif)",
    sans: "var(--font-sans)",
    mono: "var(--font-mono)",
  };
  root.style.setProperty("--editor-font", fuentes[ajustes.fuenteEditor]);
  root.style.setProperty("--editor-size", `${ajustes.tamanoEditor}px`);
  root.style.setProperty("--editor-width", `${ajustes.anchoEditor}rem`);
  root.style.setProperty("--editor-leading", String(ajustes.interlineado));
}

export function proveedor(id: string): Proveedor | undefined {
  return ajustes.proveedores.find((p) => p.id === id);
}

/** Todas las combinaciones proveedor::modelo disponibles. */
export function modelosDisponibles(): { ref: string; texto: string; proveedor: string }[] {
  return ajustes.proveedores.flatMap((p) => p.modelos.map((m) => ({ ref: `${p.id}::${m}`, texto: m, proveedor: p.nombre })));
}

export function nombreModelo(ref: string): string {
  const [pid, m] = ref.split("::");
  const p = proveedor(pid);
  return p ? `${m} · ${p.nombre}` : ref || "—";
}
