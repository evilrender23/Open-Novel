// Envoltorios tipados de los comandos del backend (Rust).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ResumenNovela {
  carpeta: string;
  ruta: string;
  meta: string | null;
  modificado: number;
}

export const api = {
  ajustesLeer: () => invoke<string | null>("ajustes_leer"),
  ajustesGuardar: (json: string) => invoke<void>("ajustes_guardar", { json }),
  bibliotecaRaiz: () => invoke<string>("biblioteca_raiz"),
  bibliotecaFijarRaiz: (ruta: string) => invoke<void>("biblioteca_fijar_raiz", { ruta }),
  novelasListar: () => invoke<ResumenNovela[]>("novelas_listar"),
  novelaCrear: (titulo: string) => invoke<string>("novela_crear", { titulo }),
  novelaEliminar: (carpeta: string) => invoke<void>("novela_eliminar", { carpeta }),
  novelaLeer: (carpeta: string) => invoke<Record<string, string>>("novela_leer", { carpeta }),
  novelaRuta: (carpeta: string) => invoke<string>("novela_ruta", { carpeta }),
  archivoLeer: (carpeta: string, ruta: string) => invoke<string | null>("archivo_leer", { carpeta, ruta }),
  archivoEscribir: (carpeta: string, ruta: string, contenido: string) =>
    invoke<void>("archivo_escribir", { carpeta, ruta, contenido }),
  archivoBorrar: (carpeta: string, ruta: string) => invoke<void>("archivo_borrar", { carpeta, ruta }),
  archivoListar: (carpeta: string, sub: string) => invoke<string[]>("archivo_listar", { carpeta, sub }),
  exportarTexto: (ruta: string, contenido: string) => invoke<void>("exportar_texto", { ruta, contenido }),
  exportarBinario: (ruta: string, bytes: number[]) => invoke<void>("exportar_binario", { ruta, bytes }),
  externoLeer: (ruta: string) => invoke<string>("externo_leer", { ruta }),
  claudeInfo: (ruta?: string) => invoke<{ ruta: string; version: string }>("claude_info", { ruta: ruta || null }),
  claudeEjecutar: (p: { id: string; args: string[]; carpeta: string | null; entrada: string; ruta?: string }) =>
    invoke<void>("claude_ejecutar", { ...p, ruta: p.ruta || null }),
  claudeCancelar: (id: string) => invoke<boolean>("claude_cancelar", { id }),
  llmStream: (p: { id: string; url: string; cabeceras: Record<string, string>; cuerpo: string }) =>
    invoke<void>("llm_stream", p),
  llmGet: (url: string, cabeceras: Record<string, string>) => invoke<string>("llm_get", { url, cabeceras }),
  llmCancelar: (id: string) => invoke<boolean>("llm_cancelar", { id }),
};

// ── Eventos de streaming, repartidos por id ──────────────────────────────

type Manejador<T> = (p: T) => void;
const manejadores = new Map<string, { datos?: Manejador<any>; fin?: Manejador<any> }>();
let escuchando: Promise<void> | null = null;

export interface FinClaude {
  id: string;
  codigo: number | null;
  cancelado: boolean;
  stderr: string;
}
export interface FinLlm {
  id: string;
  estado: number;
  error: string | null;
  cancelado: boolean;
}

/** Registra los oyentes globales una sola vez. */
export function iniciarEventos(): Promise<void> {
  if (!escuchando) {
    escuchando = Promise.all([
      listen<{ id: string; linea: string }>("claude://linea", (e) => manejadores.get(e.payload.id)?.datos?.(e.payload.linea)),
      listen<FinClaude>("claude://fin", (e) => {
        const m = manejadores.get(e.payload.id);
        manejadores.delete(e.payload.id);
        m?.fin?.(e.payload);
      }),
      listen<{ id: string; texto: string }>("llm://datos", (e) => manejadores.get(e.payload.id)?.datos?.(e.payload.texto)),
      listen<FinLlm>("llm://fin", (e) => {
        const m = manejadores.get(e.payload.id);
        manejadores.delete(e.payload.id);
        m?.fin?.(e.payload);
      }),
    ]).then(() => undefined);
  }
  return escuchando;
}

export function suscribir<D, F>(id: string, datos: Manejador<D>, fin: Manejador<F>): void {
  manejadores.set(id, { datos, fin });
}

export function nuevoId(prefijo = ""): string {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return prefijo + Array.from(r, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}
