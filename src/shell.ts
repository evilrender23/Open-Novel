// Armazón de la aplicación con la disposición de Hermes: barra lateral con
// navegación + lista contextual, columna principal con barra de título
// arrastrable, contenido y barra de estado.

import { getCurrentWindow } from "@tauri-apps/api/window";

import { ajustes, guardarAjustes, esOscuro, nombreModelo } from "./ajustes";
import { alCambiar, estado, hayPendientes, novela, palabrasEscena, type Cambio, type Vista } from "./estado";
import { palabrasHoy, palabrasNovela, todasLasEscenas, TIPOS_CODEX } from "./modelo";
import { btn, h, icon, kbd, num, type IconName } from "./ui";
import { montarAviso } from "./updater";

export interface ResultadoVista {
  titulo: string;
  principal: HTMLElement;
  lateral?: HTMLElement;
  acciones?: Node[];
  /** Si devuelve true, la vista gestionó el cambio y no hace falta remontarla. */
  alCambiar?: (c: Cambio, id?: string) => boolean | void;
  desmontar?: () => void;
}

export type FabricaVista = () => ResultadoVista;

export const NAV: { vista: Vista; texto: string; icono: IconName; atajo: string }[] = [
  { vista: "planificar", texto: "Planificar", icono: "plan", atajo: "1" },
  { vista: "escribir", texto: "Escribir", icono: "write", atajo: "2" },
  { vista: "codex", texto: "Codex", icono: "codex", atajo: "3" },
  { vista: "chat", texto: "Chat", icono: "chat", atajo: "4" },
  { vista: "agente", texto: "Agente", icono: "agent", atajo: "5" },
  { vista: "notas", texto: "Notas", icono: "note", atajo: "6" },
  { vista: "prompts", texto: "Prompts", icono: "prompt", atajo: "7" },
  { vista: "exportar", texto: "Exportar", icono: "export", atajo: "8" },
];

let fabricas: Record<Vista, FabricaVista>;
let actual: ResultadoVista | null = null;
let raiz: HTMLElement;
let refs: {
  lateral: HTMLElement;
  nav: HTMLElement;
  titulo: HTMLElement;
  acciones: HTMLElement;
  contenido: HTMLElement;
  estadoIzq: HTMLElement;
  estadoDer: HTMLElement;
  nombreNovela: HTMLElement;
};
let hooks: { biblioteca: () => void; ajustes: () => void; novela: () => void; paleta: () => void };

export function registrarVistas(f: Record<Vista, FabricaVista>, h2: typeof hooks): void {
  fabricas = f;
  hooks = h2;
}

/** Zona arrastrable de la ventana (barra de título superpuesta en macOS). */
export function arrastrable(el: HTMLElement): HTMLElement {
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a, [data-no-drag]")) return;
    if (e.detail === 2) void getCurrentWindow().toggleMaximize();
    else void getCurrentWindow().startDragging();
  });
  return el;
}

export function montarShell(contenedor: HTMLElement): void {
  const nav = h("nav", { class: "nav" });
  const lateral = h("div", { class: "sidebar-list" });
  const nombreNovela = h("span", { class: "sb-novel-title" });
  const temaBtn = btn(null, {
    icon: esOscuro() ? "sun" : "moon",
    variant: "ghost",
    size: "icon-xs",
    title: "Cambiar tema",
    onclick: () => {
      ajustes.tema = esOscuro() ? "claro" : "oscuro";
      guardarAjustes();
      temaBtn.replaceChildren(icon(esOscuro() ? "sun" : "moon"));
    },
  });
  const sidebar = h(
    "aside",
    { class: "sidebar" },
    arrastrable(h("div", { class: "sb-drag" })),
    h(
      "div",
      { class: "sb-head" },
      h(
        "button",
        { type: "button", class: "sb-novel", onclick: () => hooks.novela() },
        h("span", { class: "sb-mark" }, icon("book")),
        nombreNovela,
        icon("chevronDown", "icon sb-caret"),
      ),
    ),
    h(
      "button",
      { type: "button", class: "sb-search", onclick: () => hooks.paleta() },
      icon("search"),
      h("span", null, "Buscar o saltar…"),
      h("span", { class: "sb-kbd" }, kbd("⌘"), kbd("K")),
    ),
    nav,
    lateral,
    avisoActualizacion(),
    h(
      "div",
      { class: "sb-foot" },
      btn("Biblioteca", { icon: "library", variant: "ghost", size: "sm", onclick: () => hooks.biblioteca() }),
      h("span", { class: "grow" }),
      temaBtn,
      btn(null, { icon: "settings", variant: "ghost", size: "icon-xs", title: "Ajustes (⌘,)", onclick: () => hooks.ajustes() }),
    ),
  );
  const titulo = h("div", { class: "tb-title" });
  const acciones = h("div", { class: "tb-actions" });
  const contenido = h("div", { class: "content" });
  const estadoIzq = h("div", { class: "sbar-left" });
  const estadoDer = h("div", { class: "sbar-right" });
  const main = h(
    "main",
    { class: "main" },
    arrastrable(h("header", { class: "titlebar" }, titulo, acciones)),
    contenido,
    h("footer", { class: "statusbar" }, estadoIzq, estadoDer),
  );
  raiz = h("div", { class: "shell" }, sidebar, main);
  contenedor.replaceChildren(raiz);
  refs = { lateral, nav, titulo, acciones, contenido, estadoIzq, estadoDer, nombreNovela };

  for (const it of NAV) {
    const b = h(
      "button",
      { type: "button", class: "nav-item", dataset: { vista: it.vista }, onclick: () => irA(it.vista) },
      icon(it.icono),
      h("span", null, it.texto),
      h("span", { class: "nav-kbd" }, `⌘${it.atajo}`),
    );
    nav.append(b);
  }
  alCambiar(onCambio);
  irA(estado.vista);
}

export function irA(vista: Vista): void {
  estado.vista = vista;
  montarVista();
}

function montarVista(): void {
  if (!estado.novela || !refs) return;
  actual?.desmontar?.();
  const r = fabricas[estado.vista]();
  actual = r;
  refs.nombreNovela.textContent = estado.novela.meta.titulo || "Sin título";
  refs.titulo.replaceChildren(h("span", { class: "tb-crumb" }, estado.novela.meta.titulo), icon("chevronRight", "icon tb-sep"), h("span", { class: "tb-current" }, r.titulo));
  refs.acciones.replaceChildren(...(r.acciones ?? []));
  refs.contenido.replaceChildren(r.principal);
  refs.lateral.replaceChildren(...(r.lateral ? [r.lateral] : []));
  for (const b of refs.nav.querySelectorAll<HTMLElement>(".nav-item")) b.classList.toggle("is-active", b.dataset.vista === estado.vista);
  raiz.dataset.vista = estado.vista;
  actualizarEstado();
}

export function remontar(): void {
  montarVista();
}

function onCambio(c: Cambio, id?: string): void {
  if (!estado.novela) return;
  if (c === "guardado" || c === "texto") actualizarEstado();
  if (c === "guardado") return;
  if (c === "meta" && refs) refs.nombreNovela.textContent = estado.novela.meta.titulo;
  const gestionado = actual?.alCambiar?.(c, id);
  if (!gestionado && c === "recarga") montarVista();
}

export function modoFoco(activo?: boolean): void {
  raiz.classList.toggle("is-focus", activo ?? !raiz.classList.contains("is-focus"));
}

let agenteActivo = false;
export function indicarAgente(activo: boolean): void {
  agenteActivo = activo;
  actualizarEstado();
}

export function actualizarEstado(): void {
  if (!estado.novela || !refs) return;
  const n = novela();
  const izq: Node[] = [];
  if (estado.errorGuardado) izq.push(h("span", { class: "sbar-item is-error" }, icon("alert"), "Error al guardar"));
  else if (hayPendientes()) izq.push(h("span", { class: "sbar-item" }, h("span", { class: "dot is-busy" }), "Guardando…"));
  else izq.push(h("span", { class: "sbar-item" }, h("span", { class: "dot is-ok" }), "Guardado"));
  if (agenteActivo) izq.push(h("button", { type: "button", class: "sbar-item sbar-link", onclick: () => irA("agente") }, h("span", { class: "dot is-run" }), "Claude Code trabajando…"));
  izq.push(h("span", { class: "sbar-item sbar-muted" }, `${n.codex.size} entradas · ${todasLasEscenas(n.meta).length} escenas`));
  refs.estadoIzq.replaceChildren(...izq);

  const total = palabrasNovela(n);
  const der: Node[] = [];
  if (estado.vista === "escribir" && estado.escenaActual) der.push(h("span", { class: "sbar-item" }, `Escena ${num(palabrasEscena(estado.escenaActual))}`));
  der.push(h("span", { class: "sbar-item" }, `Hoy +${num(palabrasHoy(n, total))}`));
  const obj = n.meta.objetivoPalabras || 0;
  const pct = obj ? Math.min(100, (total / obj) * 100) : 0;
  der.push(
    h(
      "span",
      { class: "sbar-item", attrs: obj ? { "data-tip": `${pct.toFixed(1)} % del objetivo de ${num(obj)} palabras` } : {} },
      `${num(total)} palabras`,
      obj ? h("span", { class: "meter" }, h("span", { class: "meter-fill", style: `width:${pct}%` })) : null,
    ),
  );
  der.push(h("button", { type: "button", class: "sbar-item sbar-link", onclick: () => hooks.ajustes() }, icon("sparkle"), nombreModelo(ajustes.modelos.escritura)));
  refs.estadoDer.replaceChildren(...der);
}

/** Icono del tipo de una entrada del Codex. */
export function iconoTipo(tipo: string): IconName {
  return TIPOS_CODEX.find((t) => t.valor === tipo)?.icono ?? "tag";
}

/** Hueco del aviso de actualización (compilando / lista para reiniciar). */
export function avisoActualizacion(): HTMLElement {
  const el = h("div", { class: "upd-card", hidden: true, role: "status" });
  montarAviso(el);
  return el;
}
