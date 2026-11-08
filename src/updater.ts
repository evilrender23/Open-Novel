// Actualizaciones desde la rama `main` (como en Anime Watcher): la app instalada con
// instalar.sh / instalar.ps1 sabe de qué commit salió; el backend hace `git fetch`,
// relanza el instalador para compilar la versión nueva en segundo plano y avisa con el
// evento "actualizacion". Al cerrar la app, el instalador cambia a la versión nueva y la reabre.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { btn, errMsg, h, icon, toast } from "./ui";

export interface VersionInstalada {
  commit: string;
  rama: string;
  fecha: string | null;
}

export interface Commit {
  sha: string;
  mensaje: string | null;
  fecha: string | null;
}

export type EstadoActualizacion =
  | { estado: "inactiva" }
  | { estado: "buscando" }
  | { estado: "al_dia" }
  | { estado: "nueva"; ultimo: Commit }
  | { estado: "compilando"; paso: number; total: number; texto: string }
  | { estado: "lista"; commit: string }
  | { estado: "error"; mensaje: string };

/** Instalador (se actualiza sola) o desarrollo (`tauri dev`, compilación local). */
export type Canal = "instalador" | "desarrollo";

let actual: EstadoActualizacion = { estado: "inactiva" };
const oyentes = new Set<(e: EstadoActualizacion) => void>();
let tarjeta: HTMLElement | null = null;
/** El aviso de "lista" se cerró con «Más tarde»: no vuelve a salir solo. */
let descartado = false;
let montado = false;

export const corto = (commit: string) => commit.slice(0, 7);
export const versionInstalada = () => invoke<VersionInstalada | null>("update_info");
export const canal = () => invoke<Canal>("update_channel");
/** Busca (y, si `instalar`, compila) la versión nueva. El resultado llega por alActualizar. */
export const buscarActualizaciones = (instalar: boolean) => invoke<void>("update_check", { install: instalar });
export const aplicarActualizacion = () => invoke<void>("update_apply");
export const estadoActualizacion = () => actual;

export function alActualizar(fn: (e: EstadoActualizacion) => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function poner(e: EstadoActualizacion): void {
  actual = e;
  oyentes.forEach((fn) => fn(e));
  pintar();
}

/** Se suscribe al backend una sola vez (sobrevive a cambiar de novela o de vista). */
export function iniciarActualizador(): void {
  if (montado) return;
  montado = true;
  void listen<EstadoActualizacion>("actualizacion", (ev) => poner(ev.payload)).catch((e: unknown) => console.warn("listen actualizacion", e));
  invoke<EstadoActualizacion>("update_state").then(poner, (e: unknown) => console.warn("update_state", e));
}

/** Coloca el aviso en la barra lateral (se llama cada vez que se monta el armazón). */
export function montarAviso(host: HTMLElement): void {
  tarjeta = host;
  pintar();
}

export function describir(e: EstadoActualizacion): string {
  switch (e.estado) {
    case "buscando":
      return "Buscando actualizaciones…";
    case "al_dia":
      return "Tienes la última versión.";
    case "nueva":
      return `Hay una versión nueva (${corto(e.ultimo.sha)}${e.ultimo.mensaje ? `: ${e.ultimo.mensaje}` : ""}).`;
    case "compilando":
      return e.total ? `Compilando la versión nueva · paso ${e.paso} de ${e.total}: ${e.texto}` : "Preparando la versión nueva…";
    case "lista":
      return `La versión ${e.commit} está lista. Se instala al reiniciar la app.`;
    case "error":
      return e.mensaje;
    default:
      return "";
  }
}

function pintar(): void {
  const host = tarjeta;
  if (!host || !host.isConnected) return;
  const e = actual;
  if (e.estado === "compilando") {
    const pct = e.total ? (e.paso / e.total) * 100 : 4;
    host.replaceChildren(
      h("span", { class: "upd-icon" }, icon("import")),
      h(
        "div",
        { class: "upd-text" },
        h("strong", null, "Actualizando"),
        h("span", { class: "upd-desc" }, e.texto || "Preparando…"),
        h("span", { class: "meter meter-wide" }, h("span", { class: "meter-fill", style: `width:${pct}%` })),
      ),
    );
    host.hidden = false;
    return;
  }
  if (e.estado !== "lista" || descartado) {
    host.hidden = true;
    return;
  }
  const reiniciar = btn("Reiniciar y actualizar", {
    icon: "refresh",
    variant: "primary",
    size: "xs",
    onclick: async () => {
      reiniciar.disabled = true;
      try {
        await aplicarActualizacion();
      } catch (err) {
        reiniciar.disabled = false;
        toast(`No se pudo reiniciar: ${errMsg(err)}`, "error");
      }
    },
  });
  host.replaceChildren(
    h("span", { class: "upd-icon" }, icon("sparkle")),
    h(
      "div",
      { class: "upd-text" },
      h("strong", null, `Versión ${e.commit} lista`),
      h("span", { class: "upd-desc" }, "Se instala al reiniciar. Tus novelas y ajustes no se tocan."),
      h(
        "div",
        { class: "upd-actions" },
        reiniciar,
        btn("Más tarde", {
          variant: "text",
          size: "xs",
          onclick: () => {
            descartado = true;
            host.hidden = true;
          },
        }),
      ),
    ),
  );
  host.hidden = false;
}
