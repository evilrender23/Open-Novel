// Componentes compartidos: chips editables, selector de modelo, tarjeta
// flotante de una entrada del Codex y segmentado.

import { ajustes, modelosDisponibles, nombreModelo } from "./ajustes";
import { estado, novela } from "./estado";
import { TIPOS_CODEX, type EntradaCodex } from "./modelo";
import { iconoTipo } from "./shell";
import { h, icon, menu, type IconName, type ItemMenu } from "./ui";

/** Lista de etiquetas editable: Intro o coma añade, Retroceso borra la última. */
export function chips(valores: string[], onChange: (v: string[]) => void, placeholder = "Añadir…"): HTMLElement {
  const caja = h("div", { class: "chips" });
  const input = h("input", { class: "chips-input", placeholder });
  const pintar = () => {
    caja.replaceChildren(
      ...valores.map((v, i) =>
        h(
          "span",
          { class: "chip" },
          v,
          h(
            "button",
            {
              type: "button",
              class: "chip-x",
              attrs: { "aria-label": `Quitar ${v}` },
              onclick: () => {
                valores.splice(i, 1);
                onChange(valores);
                pintar();
              },
            },
            icon("x"),
          ),
        ),
      ),
      input,
    );
  };
  const anadir = () => {
    const t = input.value.replace(/,$/, "").trim();
    if (t && !valores.includes(t)) {
      valores.push(t);
      onChange(valores);
    }
    input.value = "";
    pintar();
    input.focus();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      anadir();
    } else if (e.key === "Backspace" && !input.value && valores.length) {
      valores.pop();
      onChange(valores);
      pintar();
      input.focus();
    }
  });
  input.addEventListener("blur", () => {
    if (input.value.trim()) anadir();
  });
  caja.addEventListener("mousedown", (e) => {
    if (e.target === caja) {
      e.preventDefault();
      input.focus();
    }
  });
  pintar();
  return caja;
}

/** Chip que abre un menú para elegir proveedor::modelo. */
export function chipModelo(actual: () => string, alElegir: (ref: string) => void, vacio = "Predeterminado"): HTMLButtonElement {
  const b = h("button", { type: "button", class: "chip-btn" });
  const pintar = () => b.replaceChildren(icon("sparkle"), h("span", null, actual() ? nombreModelo(actual()) : vacio), icon("chevronDown"));
  b.addEventListener("click", () => {
    const items: ItemMenu[] = [];
    let ultimoProv = "";
    for (const m of modelosDisponibles()) {
      if (m.proveedor !== ultimoProv) {
        items.push({ titulo: m.proveedor });
        ultimoProv = m.proveedor;
      }
      items.push({ texto: m.texto, icono: m.ref === actual() ? "check" : undefined, accion: () => (alElegir(m.ref), pintar()) });
    }
    if (!items.length) items.push({ titulo: "Configura un proveedor en Ajustes" });
    menu(items, b);
  });
  pintar();
  return b;
}

export function segmentado<T extends string>(
  opciones: { valor: T; texto: string; icono?: IconName }[],
  actual: T,
  onChange: (v: T) => void,
): HTMLElement {
  const caja = h("div", { class: "segmented", role: "tablist" });
  const pintar = (v: T) => {
    caja.replaceChildren(
      ...opciones.map((o) =>
        h(
          "button",
          {
            type: "button",
            class: `seg${o.valor === v ? " is-active" : ""}`,
            onclick: () => {
              pintar(o.valor);
              onChange(o.valor);
            },
          },
          o.icono ? icon(o.icono) : null,
          o.texto,
        ),
      ),
    );
  };
  pintar(actual);
  return caja;
}

export function avatar(e: EntradaCodex | undefined, cls = ""): HTMLElement {
  if (!e) return h("span", { class: `avatar is-empty ${cls}` }, "?");
  const inicial = Array.from(e.nombre.trim())[0]?.toUpperCase() ?? "?";
  const el = h("span", { class: `avatar ${cls}` }, inicial);
  if (e.color) el.style.setProperty("--avatar", e.color);
  return el;
}

// ── Tarjeta flotante del Codex ───────────────────────────────────────────

let tarjeta: HTMLElement | null = null;
let temporizador = 0;

export function ocultarTarjeta(): void {
  window.clearTimeout(temporizador);
  tarjeta?.remove();
  tarjeta = null;
}

export function tarjetaEntrada(e: EntradaCodex, abrir?: () => void): HTMLElement {
  const tipo = TIPOS_CODEX.find((t) => t.valor === e.tipo);
  return h(
    "div",
    { class: "cx-card" },
    h(
      "div",
      { class: "cx-card-head" },
      avatar(e),
      h("div", null, h("div", { class: "cx-card-name" }, e.nombre), h("div", { class: "cx-card-type" }, icon(iconoTipo(e.tipo)), tipo?.texto ?? e.tipo)),
    ),
    e.alias.length ? h("div", { class: "cx-card-alias" }, `También: ${e.alias.join(", ")}`) : null,
    e.campos.length
      ? h("dl", { class: "cx-card-fields" }, ...e.campos.filter((c) => c.clave).slice(0, 5).flatMap((c) => [h("dt", null, c.clave), h("dd", null, c.valor)]))
      : null,
    h("p", { class: "cx-card-desc" }, e.descripcion.trim().slice(0, 420) + (e.descripcion.length > 420 ? "…" : "") || "Sin descripción."),
    abrir ? h("button", { type: "button", class: "cx-card-open", onclick: abrir }, "Abrir en el Codex", icon("arrowRight")) : null,
  );
}

/** Muestra la tarjeta de una entrada al pasar el ratón sobre `ancla`. */
export function conTarjeta(ancla: HTMLElement, id: string, abrir: (id: string) => void): void {
  ancla.addEventListener("mouseenter", () => {
    window.clearTimeout(temporizador);
    temporizador = window.setTimeout(() => {
      const e = estado.novela?.codex.get(id);
      if (!e || !ancla.isConnected) return;
      ocultarTarjeta();
      tarjeta = tarjetaEntrada(e, () => {
        ocultarTarjeta();
        abrir(id);
      });
      tarjeta.classList.add("is-floating");
      tarjeta.addEventListener("mouseenter", () => window.clearTimeout(temporizador));
      tarjeta.addEventListener("mouseleave", () => (temporizador = window.setTimeout(ocultarTarjeta, 150)));
      document.body.append(tarjeta);
      const r = ancla.getBoundingClientRect();
      let x = r.left;
      let y = r.bottom + 6;
      if (x + tarjeta.offsetWidth > window.innerWidth - 8) x = window.innerWidth - tarjeta.offsetWidth - 8;
      if (y + tarjeta.offsetHeight > window.innerHeight - 8) y = r.top - tarjeta.offsetHeight - 6;
      tarjeta.style.left = `${Math.max(8, x)}px`;
      tarjeta.style.top = `${Math.max(8, y)}px`;
    }, 250);
  });
  ancla.addEventListener("mouseleave", () => {
    window.clearTimeout(temporizador);
    temporizador = window.setTimeout(ocultarTarjeta, 150);
  });
}

export function opcionesPov(): { valor: string; texto: string }[] {
  return [
    { valor: "", texto: "Sin punto de vista" },
    ...[...novela().codex.values()]
      .filter((e) => e.tipo === "personaje")
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((e) => ({ valor: e.id, texto: e.nombre })),
  ];
}

export const temperaturaTexto = () => `Temperatura ${ajustes.temperatura}`;
