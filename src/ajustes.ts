// Ajustes globales de la aplicación (no dependen de la novela abierta).

import { api } from "./api";

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
}

export const PROVEEDORES_BASE: Record<TipoProveedor, { nombre: string; url: string; modelos: string[]; necesitaClave: boolean }> = {
  "claude-code": { nombre: "Claude Code CLI", url: "", modelos: ["sonnet", "opus", "haiku"], necesitaClave: false },
  anthropic: { nombre: "Anthropic API", url: "https://api.anthropic.com/v1", modelos: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"], necesitaClave: true },
  openai: { nombre: "OpenAI", url: "https://api.openai.com/v1", modelos: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o"], necesitaClave: true },
  openrouter: { nombre: "OpenRouter", url: "https://openrouter.ai/api/v1", modelos: ["anthropic/claude-sonnet-4.5", "openai/gpt-4.1", "google/gemini-2.5-pro"], necesitaClave: true },
  ollama: { nombre: "Ollama (local)", url: "http://localhost:11434/v1", modelos: ["llama3.1"], necesitaClave: false },
  compatible: { nombre: "Compatible con OpenAI", url: "http://localhost:1234/v1", modelos: [], necesitaClave: false },
};

export const ACENTOS = ["#0053fd", "#6d2ebf", "#1f8a65", "#c25e2c", "#cf2d56", "#4c7f8c", "#17171a"];

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
