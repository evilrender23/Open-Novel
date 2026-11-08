// Utilidades de interfaz: construcción segura del DOM (sin innerHTML), iconos,
// avisos, diálogos, menús contextuales y popovers con el lenguaje visual de Hermes.

import { locale } from "./i18n";

export type Child = Node | string | number | null | undefined | false;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], "style" | "dataset" | "className" | "children">
> & {
  class?: string;
  style?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
};

/** Crea un elemento. Los textos se insertan como nodos de texto, nunca como HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props<K> | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    const { class: cls, style, dataset, attrs, ...rest } = props;
    if (cls) el.className = cls;
    if (style) el.style.cssText = style;
    if (dataset) Object.assign(el.dataset, dataset);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    Object.assign(el, rest);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "number" ? String(child) : child);
  }
  return el;
}

/** Mensaje legible de un error (el backend rechaza con strings en español). */
export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  book: "M4 5.5C6.5 4.5 9.5 4.5 12 6v13c-2.5-1.5-5.5-1.5-8-.5z M20 5.5c-2.5-1-5.5-1-8 .5v13c2.5-1.5 5.5-1.5 8-.5z",
  plan: "M4 4h6v7H4z M14 4h6v4h-6z M14 12h6v8h-6z M4 15h6v5H4z",
  write: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z M14 7l3 3",
  codex: "M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M4.5 20a7.5 7.5 0 0 1 15 0",
  chat: "M4 5h16v11H9l-5 4z",
  agent: "M4 6l5 5-5 5 M12 18h8",
  note: "M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5",
  prompt: "M5 4h14v16H5z M8.5 9l2.5 2.5L8.5 14 M13 14h3",
  export: "M12 3v12 M7.5 7.5L12 3l4.5 4.5 M5 14v6h14v-6",
  settings: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4z M9 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4z",
  library: "M4 4h4v16H4z M10 4h4v16h-4z M16.5 4.8l3.8-1 3.2 15.5-3.8 1z",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20 20l-4.2-4.2",
  plus: "M12 5v14 M5 12h14",
  x: "M6 6l12 12 M18 6L6 18",
  check: "M5 12l5 5L20 7",
  trash: "M4 7h16 M9 7V4.5h6V7 M6.5 7l1 13h9l1-13",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  chevronLeft: "M15 6l-6 6 6 6",
  sparkle: "M12 3.5l1.8 4.9 4.9 1.8-4.9 1.8L12 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  send: "M12 19V5 M6 11l6-6 6 6",
  stop: "M7 7h10v10H7z",
  copy: "M9 9h10.5v11H9z M5 15.5V4.5h10.5",
  folder: "M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z",
  history: "M3 12a9 9 0 1 0 2.6-6.4 M3 4v5h5 M12 8v4l3 2",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z",
  focus: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  user: "M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M5 20c1-3.5 4-5 7-5s6 1.5 7 5",
  place: "M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z M12 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4z",
  item: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9",
  lore: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  thread: "M5 5c6 0 6 14 14 14 M5 19c6 0 6-14 14-14",
  tag: "M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z M8 8h.01",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  grid: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  list: "M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01",
  matrix: "M4 4h16v16H4z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16",
  arrowUp: "M12 19V5 M6 11l6-6 6 6",
  arrowDown: "M12 5v14 M6 13l6 6 6-6",
  arrowLeft: "M19 12H5 M11 6l-6 6 6 6",
  arrowRight: "M5 12h14 M13 6l6 6-6 6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7",
  tool: "M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17v3h3l5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z",
  info: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 11v5 M12 7.5h.01",
  alert: "M12 9v4 M12 16.5h.01 M10.3 4.2L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z",
  pin: "M9 4h6l-1 6 3 3H7l3-3z M12 13v8",
  dot: "M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z",
  drag: "M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  duplicate: "M8 8h12v12H8z M4 16V4h12",
  import: "M12 15V3 M7.5 10.5L12 15l4.5-4.5 M5 14v6h14v-6",
  target: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z",
  wand: "M4 20L15 9 M13 7l4 4 M17 3v3 M15.5 4.5h3 M20 8v2 M19 9h2",
  terminal: "M4 5h16v14H4z M7.5 9.5l2.5 2.5-2.5 2.5 M12 15h4",
  file: "M6 3h9l4 4v14H6z M14 3v5h5",
  edit: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z",
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

type BtnVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "text";

/** Botón único (como el primitivo `Button` de Hermes): variante + tamaño. */
export function btn(
  label: string | null,
  opts: {
    icon?: IconName;
    variant?: BtnVariant;
    size?: "default" | "xs" | "sm" | "icon" | "icon-sm" | "icon-xs";
    onclick?: (ev: MouseEvent) => void;
    title?: string;
    disabled?: boolean;
    class?: string;
  } = {},
): HTMLButtonElement {
  const v = opts.variant ?? "secondary";
  const s = opts.size ?? (label ? "default" : "icon-sm");
  const b = h(
    "button",
    {
      type: "button",
      class: `btn btn-${v} btn-${s}${opts.class ? " " + opts.class : ""}`,
      disabled: !!opts.disabled,
      attrs: opts.title ? { "aria-label": opts.title, "data-tip": opts.title } : {},
    },
    opts.icon ? icon(opts.icon) : null,
    label ? h("span", null, label) : null,
  );
  if (opts.onclick) b.addEventListener("click", opts.onclick);
  return b;
}

export function kbd(key: string): HTMLElement {
  return h("kbd", { class: "kbd" }, key);
}

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: "ok" | "error" | "info" = "info"): void {
  if (!toastHost) {
    toastHost = h("div", { class: "toasts" });
    document.body.append(toastHost);
  }
  const el = h(
    "div",
    { class: `toast toast-${kind}`, role: "status" },
    icon(kind === "error" ? "alert" : kind === "ok" ? "check" : "info"),
    h("span", null, message),
  );
  toastHost.append(el);
  window.setTimeout(() => {
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 220);
  }, kind === "error" ? 6000 : 3000);
}

// ── Diálogos ─────────────────────────────────────────────────────────────

export interface Modal {
  el: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

/** Panel flotante con `shadow-nous` sobre un fondo atenuado. */
export function modal(title: string, opts: { wide?: boolean; onClose?: () => void; subtitle?: string } = {}): Modal {
  const body = h("div", { class: "modal-body" });
  const footer = h("div", { class: "modal-footer" });
  const prev = document.activeElement as HTMLElement | null;
  const backdrop = h("div", { class: "modal-backdrop" });
  const close = () => {
    backdrop.classList.add("leaving");
    document.removeEventListener("keydown", onKey, true);
    window.setTimeout(() => backdrop.remove(), 140);
    opts.onClose?.();
    prev?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && backdrop.isConnected && backdrop === document.querySelector(".modal-backdrop:last-of-type")) {
      e.stopPropagation();
      close();
    }
  };
  const panel = h(
    "div",
    { class: `modal${opts.wide ? " modal-wide" : ""}`, role: "dialog", attrs: { "aria-modal": "true", "aria-label": title } },
    h(
      "header",
      { class: "modal-header" },
      h("div", null, h("h2", { class: "modal-title" }, title), opts.subtitle ? h("p", { class: "modal-sub" }, opts.subtitle) : null),
      btn(null, { icon: "x", variant: "ghost", size: "icon-xs", title: "Cerrar", onclick: close }),
    ),
    body,
    footer,
  );
  backdrop.append(panel);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  return { el: panel, body, footer, close };
}

export function confirmar(titulo: string, texto: string, accion = "Eliminar", peligro = true): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal(titulo, { onClose: () => resolve(ok) });
    m.body.append(h("p", { class: "modal-text" }, texto));
    const si = btn(accion, {
      variant: peligro ? "danger" : "primary",
      onclick: () => {
        ok = true;
        m.close();
      },
    });
    m.footer.append(btn("Cancelar", { variant: "text", onclick: () => m.close() }), si);
    si.focus();
  });
}

export function pedirTexto(titulo: string, etiqueta: string, inicial = "", accion = "Aceptar"): Promise<string | null> {
  return new Promise((resolve) => {
    let valor: string | null = null;
    const m = modal(titulo, { onClose: () => resolve(valor) });
    const input = h("input", { class: "input", value: inicial, type: "text" });
    const enviar = () => {
      valor = input.value.trim();
      m.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") enviar();
    });
    m.body.append(campo(etiqueta, input));
    m.footer.append(btn("Cancelar", { variant: "text", onclick: () => m.close() }), btn(accion, { variant: "primary", onclick: enviar }));
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 10);
  });
}

/** Etiqueta + control (formularios). */
export function campo(etiqueta: string, control: HTMLElement, ayuda?: string): HTMLElement {
  return h(
    "label",
    { class: "field" },
    h("span", { class: "field-label" }, etiqueta),
    control,
    ayuda ? h("span", { class: "field-help" }, ayuda) : null,
  );
}

export function select<T extends string>(
  opciones: { valor: T; texto: string }[],
  actual: T,
  onchange: (v: T) => void,
  cls = "select",
): HTMLSelectElement {
  const s = h("select", { class: cls });
  for (const o of opciones) s.append(h("option", { value: o.valor, selected: o.valor === actual }, o.texto));
  s.addEventListener("change", () => onchange(s.value as T));
  return s;
}

// ── Menú contextual / popover ─────────────────────────────────────────────

export type ItemMenu =
  | { texto: string; icono?: IconName; accion: () => void; peligro?: boolean; atajo?: string; deshabilitado?: boolean }
  | { separador: true }
  | { titulo: string };

let menuAbierto: HTMLElement | null = null;
let teclasMenu: ((e: KeyboardEvent) => void) | null = null;

export function cerrarMenu(): void {
  menuAbierto?.remove();
  menuAbierto = null;
  if (teclasMenu) document.removeEventListener("keydown", teclasMenu, true);
  teclasMenu = null;
}

/** Abre un menú en (x, y) o anclado bajo un elemento. */
export function menu(items: ItemMenu[], pos: { x: number; y: number } | HTMLElement, opciones: { mantenerFoco?: boolean } = {}): void {
  cerrarMenu();
  const el = h("div", { class: "menu", role: "menu" });
  // Con mantenerFoco (menú contextual del editor) el campo de texto conserva el foco y la
  // selección se sigue viendo: ni el menú ni sus botones roban el foco al pulsarlos.
  if (opciones.mantenerFoco) el.addEventListener("mousedown", (e) => e.preventDefault());
  const botones: HTMLButtonElement[] = [];
  for (const it of items) {
    if ("separador" in it) el.append(h("div", { class: "menu-sep" }));
    else if ("titulo" in it) el.append(h("div", { class: "menu-title" }, it.titulo));
    else {
      const b = h(
        "button",
        { type: "button", class: `menu-item${it.peligro ? " is-danger" : ""}`, disabled: !!it.deshabilitado, role: "menuitem" },
        it.icono ? icon(it.icono) : h("span", { class: "icon" }),
        h("span", { class: "menu-text" }, it.texto),
        it.atajo ? h("span", { class: "menu-kbd" }, it.atajo) : null,
      );
      b.addEventListener("click", () => {
        cerrarMenu();
        it.accion();
      });
      botones.push(b);
      el.append(b);
    }
  }
  document.body.append(el);
  menuAbierto = el;
  let x: number;
  let y: number;
  if (pos instanceof HTMLElement) {
    const r = pos.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
  } else {
    x = pos.x;
    y = pos.y;
  }
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  if (x + w > window.innerWidth - 6) x = Math.max(6, window.innerWidth - w - 6);
  if (y + hgt > window.innerHeight - 6) y = Math.max(6, y - hgt - (pos instanceof HTMLElement ? pos.offsetHeight + 8 : 0));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  let foco = -1;
  if (opciones.mantenerFoco) {
    // Teclado sin mover el foco: flechas resaltan, Intro ejecuta, Esc cierra.
    teclasMenu = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        botones[foco]?.classList.remove("is-focus");
        foco = (foco + (e.key === "ArrowDown" ? 1 : -1) + botones.length) % botones.length;
        botones[foco]?.classList.add("is-focus");
      } else if (e.key === "Enter" && foco >= 0) {
        e.preventDefault();
        e.stopPropagation();
        botones[foco].click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cerrarMenu();
      } else cerrarMenu();
    };
    document.addEventListener("keydown", teclasMenu, true);
    return;
  }
  el.tabIndex = -1;
  el.focus();
  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      foco = (foco + (e.key === "ArrowDown" ? 1 : -1) + botones.length) % botones.length;
      botones[foco]?.focus();
    } else if (e.key === "Escape") cerrarMenu();
  });
}

document.addEventListener(
  "mousedown",
  (e) => {
    if (menuAbierto && !menuAbierto.contains(e.target as Node)) cerrarMenu();
  },
  true,
);
window.addEventListener("blur", cerrarMenu);
window.addEventListener("wheel", (e) => {
  if (menuAbierto && !menuAbierto.contains(e.target as Node)) cerrarMenu();
});

// ── Tooltips temáticos (sin `title=` nativo, como en Hermes) ──────────────

let tip: HTMLElement | null = null;
let tipTimer = 0;
let tipCaliente = 0;

function ocultarTip() {
  window.clearTimeout(tipTimer);
  if (tip) {
    tip.remove();
    tip = null;
    tipCaliente = Date.now();
  }
}

document.addEventListener("mouseover", (e) => {
  const t = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
  if (!t) return;
  window.clearTimeout(tipTimer);
  const mostrar = () => {
    ocultarTip();
    if (!t.isConnected) return;
    tip = h("div", { class: "tip" }, t.dataset.tip ?? "");
    document.body.append(tip);
    const r = t.getBoundingClientRect();
    let x = r.left + r.width / 2 - tip.offsetWidth / 2;
    x = Math.max(6, Math.min(window.innerWidth - tip.offsetWidth - 6, x));
    let y = r.top - tip.offsetHeight - 6;
    if (y < 4) y = r.bottom + 6;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  if (Date.now() - tipCaliente < 300) mostrar();
  else tipTimer = window.setTimeout(mostrar, 200);
  t.addEventListener("mouseleave", ocultarTip, { once: true });
});
document.addEventListener("mousedown", ocultarTip, true);

// ── Varios ───────────────────────────────────────────────────────────────

export function vacio(texto: string, pista?: string, accion?: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "empty" },
    h("p", { class: "empty-title" }, texto),
    pista ? h("p", { class: "empty-hint" }, pista) : null,
    accion ?? null,
  );
}

export function autoAltura(t: HTMLTextAreaElement, max = 400): void {
  const ajustar = () => {
    t.style.height = "auto";
    t.style.height = `${Math.min(max, t.scrollHeight)}px`;
  };
  t.addEventListener("input", ajustar);
  requestAnimationFrame(ajustar);
}

export function fechaCorta(ms: number): string {
  const d = new Date(ms);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: d.getFullYear() === hoy.getFullYear() ? undefined : "numeric" });
}

export function num(n: number): string {
  return n.toLocaleString(locale());
}

/** Spinner de glifos (como el `glyph-spinner` de Hermes). */
export function spinner(): HTMLElement {
  return h("span", { class: "spinner", attrs: { "aria-hidden": "true" } });
}
