// Buscar y reemplazar dentro del escrito (⌘F / Ctrl+F): en la escena abierta o
// en toda la novela, sin distinguir acentos por defecto, con resaltado de las
// coincidencias en una capa bajo el texto, navegación (Intro / ⇧Intro, ⌘G) y
// reemplazo de una o de todas.

import { novela } from "./estado";
import { todasLasEscenas } from "./modelo";
import { btn, h, icon, num } from "./ui";

export interface Coincidencia {
  inicio: number;
  fin: number;
}

export interface Opciones {
  mayusculas: boolean;
  palabra: boolean;
  acentos: boolean; // true = distinguir acentos
}

/** Estado que sobrevive al cambiar de escena (búsqueda en toda la novela). */
const memoria = {
  consulta: "",
  reemplazo: "",
  verReemplazo: false,
  alcance: "escena" as "escena" | "novela",
  opciones: { mayusculas: false, palabra: false, acentos: false } as Opciones,
  /** Al saltar a otra escena desde la lista: la coincidencia que hay que marcar. */
  pendiente: null as { escenaId: string; inicio: number } | null,
};

/** Quita acentos manteniendo la longitud (cada unidad UTF-16 → una). */
function sinAcentos(s: string): string {
  let out = "";
  for (const c of s.split("")) out += c.normalize("NFD")[0] ?? c;
  return out;
}

function escaparRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buscarEn(texto: string, consulta: string, o: Opciones): Coincidencia[] {
  if (!consulta) return [];
  let t = texto;
  let q = consulta;
  if (!o.acentos) {
    t = sinAcentos(t);
    q = sinAcentos(q);
  }
  const fuente = o.palabra ? `(?<![\\p{L}\\p{N}])${escaparRe(q)}(?![\\p{L}\\p{N}])` : escaparRe(q);
  const re = new RegExp(fuente, o.mayusculas ? "gu" : "giu");
  const out: Coincidencia[] = [];
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (!m[0].length) {
      re.lastIndex++;
      continue;
    }
    out.push({ inicio: m.index, fin: m.index + m[0].length });
    if (out.length > 5000) break;
  }
  return out;
}

export interface EditorBuscable {
  escenaId: string;
  textarea: HTMLTextAreaElement;
  /** Capa bajo el texto (mismas métricas) donde se pintan las coincidencias. */
  capa: HTMLElement;
  /** Contenedor con scroll del editor. */
  scroller: HTMLElement;
  /** Zona donde se coloca la barra (posición relativa). */
  anclaje: HTMLElement;
  reemplazar: (inicio: number, fin: number, texto: string) => void;
  abrirEscena: (id: string) => void;
}

export class Buscador {
  private barra: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private inputReemplazo!: HTMLInputElement;
  private contador!: HTMLElement;
  private listaNovela!: HTMLElement;
  private filaReemplazo!: HTMLElement;
  private hits: Coincidencia[] = [];
  private actual = -1;

  constructor(private ed: EditorBuscable) {
    // Si venimos de un resultado de "toda la novela", abrir ya con esa coincidencia.
    const p = memoria.pendiente;
    if (p && p.escenaId === ed.escenaId) {
      memoria.pendiente = null;
      // Tras montar el editor (la altura del texto se ajusta en el siguiente ciclo).
      window.setTimeout(() => {
        this.abrir(false);
        const i = this.hits.findIndex((x) => x.inicio === p.inicio);
        this.ir(i >= 0 ? i : 0);
      }, 30);
    }
  }

  get abierto(): boolean {
    return !!this.barra?.isConnected;
  }

  abrir(conSeleccion = true): void {
    const ta = this.ed.textarea;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (conSeleccion && sel && !sel.includes("\n") && sel.length < 120) memoria.consulta = sel;
    if (!this.abierto) this.montar();
    this.input.value = memoria.consulta;
    this.input.focus();
    this.input.select();
    this.actualizar(true);
  }

  cerrar(enfocarTexto = true): void {
    this.barra?.remove();
    this.barra = null;
    this.ed.capa.replaceChildren();
    const h0 = this.hits[this.actual];
    if (enfocarTexto && h0) {
      this.ed.textarea.focus();
      this.ed.textarea.setSelectionRange(h0.inicio, h0.fin);
    }
    this.hits = [];
    this.actual = -1;
  }

  /** Llamar cuando cambia el texto: recalcula sin mover la vista. */
  alCambiarTexto(): void {
    if (this.abierto) this.actualizar(false);
  }

  siguiente(delta = 1): void {
    if (!this.abierto) return this.abrir();
    if (!this.hits.length) return;
    this.ir((this.actual + delta + this.hits.length) % this.hits.length);
  }

  private montar(): void {
    const o = memoria.opciones;
    this.input = h("input", { class: "find-input", placeholder: "Buscar", spellcheck: false });
    this.inputReemplazo = h("input", { class: "find-input", placeholder: "Reemplazar por", spellcheck: false, value: memoria.reemplazo });
    this.contador = h("span", { class: "find-count" });
    this.listaNovela = h("div", { class: "find-results", hidden: true });

    const alternar = (texto: string, tip: string, clave: keyof Opciones) => {
      const b = h("button", { type: "button", class: `find-opt${o[clave] ? " is-on" : ""}`, attrs: { "aria-label": tip, "data-tip": tip, "aria-pressed": String(o[clave]) } }, texto);
      b.addEventListener("click", () => {
        o[clave] = !o[clave];
        b.classList.toggle("is-on", o[clave]);
        b.setAttribute("aria-pressed", String(o[clave]));
        this.actualizar(true);
        this.input.focus();
      });
      return b;
    };
    const alcance = h("button", { type: "button", class: `find-opt find-scope${memoria.alcance === "novela" ? " is-on" : ""}`, attrs: { "data-tip": "Buscar en toda la novela" } }, icon("book"));
    alcance.addEventListener("click", () => {
      memoria.alcance = memoria.alcance === "novela" ? "escena" : "novela";
      alcance.classList.toggle("is-on", memoria.alcance === "novela");
      this.actualizar(true);
      this.input.focus();
    });

    const toggleReemplazo = h("button", { type: "button", class: `find-toggle${memoria.verReemplazo ? " is-open" : ""}`, attrs: { "aria-label": "Mostrar reemplazar", "data-tip": "Reemplazar (⌘⌥F)" } }, icon("chevronRight"));
    toggleReemplazo.addEventListener("click", () => this.mostrarReemplazo(!memoria.verReemplazo, toggleReemplazo));

    this.filaReemplazo = h(
      "div",
      { class: "find-row", hidden: !memoria.verReemplazo },
      h("span", { class: "find-spacer" }),
      this.inputReemplazo,
      btn("Reemplazar", { variant: "ghost", size: "xs", onclick: () => this.reemplazarActual() }),
      btn("Todas", { variant: "ghost", size: "xs", onclick: () => this.reemplazarTodas() }),
    );

    this.barra = h(
      "div",
      { class: "findbar", role: "search" },
      h(
        "div",
        { class: "find-row" },
        toggleReemplazo,
        this.input,
        alternar("Aa", "Distinguir mayúsculas", "mayusculas"),
        alternar("ab", "Palabra completa", "palabra"),
        alternar("á", "Distinguir acentos", "acentos"),
        alcance,
        this.contador,
        btn(null, { icon: "arrowUp", variant: "ghost", size: "icon-xs", title: "Anterior (⇧Intro)", onclick: () => this.siguiente(-1) }),
        btn(null, { icon: "arrowDown", variant: "ghost", size: "icon-xs", title: "Siguiente (Intro)", onclick: () => this.siguiente(1) }),
        btn(null, { icon: "x", variant: "ghost", size: "icon-xs", title: "Cerrar (Esc)", onclick: () => this.cerrar() }),
      ),
      this.filaReemplazo,
      this.listaNovela,
    );

    this.input.addEventListener("input", () => {
      memoria.consulta = this.input.value;
      this.actualizar(true);
    });
    this.inputReemplazo.addEventListener("input", () => (memoria.reemplazo = this.inputReemplazo.value));
    const teclas = (e: KeyboardEvent, enReemplazo: boolean) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.cerrar();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (enReemplazo) {
          if (e.metaKey || e.ctrlKey) this.reemplazarTodas();
          else this.reemplazarActual();
        } else this.siguiente(e.shiftKey ? -1 : 1);
      }
    };
    this.input.addEventListener("keydown", (e) => teclas(e, false));
    this.inputReemplazo.addEventListener("keydown", (e) => teclas(e, true));
    this.ed.anclaje.append(this.barra);
  }

  mostrarReemplazo(ver: boolean, boton?: HTMLElement): void {
    if (!this.abierto) this.abrir();
    memoria.verReemplazo = ver;
    this.filaReemplazo.hidden = !ver;
    (boton ?? this.barra?.querySelector(".find-toggle"))?.classList.toggle("is-open", ver);
    (ver ? this.inputReemplazo : this.input).focus();
  }

  private actualizar(mover: boolean): void {
    const texto = this.ed.textarea.value;
    const anterior = this.hits[this.actual]?.inicio ?? this.ed.textarea.selectionStart;
    this.hits = buscarEn(texto, memoria.consulta, memoria.opciones);
    if (!this.hits.length) this.actual = -1;
    else {
      // La primera coincidencia desde la posición anterior (o el cursor).
      const i = this.hits.findIndex((x) => x.inicio >= anterior);
      this.actual = i >= 0 ? i : 0;
    }
    this.pintar();
    if (mover && this.actual >= 0) this.desplazar();
    this.pintarNovela();
  }

  private ir(i: number): void {
    if (i < 0 || i >= this.hits.length) return;
    this.actual = i;
    this.pintar();
    this.desplazar();
  }

  private pintar(): void {
    const texto = this.ed.textarea.value;
    const nodos: Node[] = [];
    let ultimo = 0;
    this.hits.forEach((x, i) => {
      if (x.inicio > ultimo) nodos.push(document.createTextNode(texto.slice(ultimo, x.inicio)));
      nodos.push(h("mark", { class: `find-hit${i === this.actual ? " is-current" : ""}` }, texto.slice(x.inicio, x.fin)));
      ultimo = x.fin;
    });
    nodos.push(document.createTextNode(texto.slice(ultimo) + "\n "));
    this.ed.capa.replaceChildren(...nodos);
    const consulta = memoria.consulta;
    this.contador.textContent = !consulta ? "" : this.hits.length ? `${num(this.actual + 1)} de ${num(this.hits.length)}` : "Sin resultados";
    this.contador.classList.toggle("is-empty", !!consulta && !this.hits.length);
  }

  private desplazar(): void {
    const marca = this.ed.capa.querySelector<HTMLElement>(".find-hit.is-current");
    if (!marca) return;
    const s = this.ed.scroller;
    const r = marca.getBoundingClientRect();
    const rs = s.getBoundingClientRect();
    // Deja hueco para la barra de búsqueda arriba y el composer abajo.
    if (r.top < rs.top + 90 || r.bottom > rs.bottom - 140) s.scrollTop += r.top - rs.top - rs.height / 3;
  }

  private reemplazarActual(): void {
    const x = this.hits[this.actual];
    if (!x) return;
    const posicion = x.inicio + memoria.reemplazo.length;
    this.ed.reemplazar(x.inicio, x.fin, memoria.reemplazo);
    this.hits = buscarEn(this.ed.textarea.value, memoria.consulta, memoria.opciones);
    const i = this.hits.findIndex((y) => y.inicio >= posicion);
    this.actual = this.hits.length ? (i >= 0 ? i : 0) : -1;
    this.pintar();
    this.desplazar();
    this.inputReemplazo.focus();
  }

  private reemplazarTodas(): void {
    if (!this.hits.length) return;
    const texto = this.ed.textarea.value;
    let nuevo = "";
    let ultimo = 0;
    for (const x of this.hits) {
      nuevo += texto.slice(ultimo, x.inicio) + memoria.reemplazo;
      ultimo = x.fin;
    }
    nuevo += texto.slice(ultimo);
    const total = this.hits.length;
    // Una sola operación: se deshace de golpe con ⌘Z.
    this.ed.reemplazar(0, texto.length, nuevo);
    this.actualizar(false);
    this.contador.textContent = `${num(total)} reemplazadas`;
    this.inputReemplazo.focus();
  }

  /** Resultados en el resto de escenas (alcance «toda la novela»). */
  private pintarNovela(): void {
    const lista = this.listaNovela;
    if (memoria.alcance !== "novela" || !memoria.consulta) {
      lista.hidden = true;
      return;
    }
    const n = novela();
    const filas: Node[] = [];
    let total = 0;
    for (const u of todasLasEscenas(n.meta)) {
      const texto = u.escena.id === this.ed.escenaId ? this.ed.textarea.value : (n.textos.get(u.escena.id) ?? "");
      const hits = buscarEn(texto, memoria.consulta, memoria.opciones);
      if (!hits.length) continue;
      total += hits.length;
      const esta = u.escena.id === this.ed.escenaId;
      filas.push(
        h(
          "div",
          { class: `find-scene${esta ? " is-current" : ""}` },
          h("span", null, `Cap. ${u.numCapitulo} · ${u.escena.titulo}`),
          h("span", { class: "muted" }, String(hits.length)),
        ),
      );
      for (const x of hits.slice(0, 8)) {
        const antes = texto.slice(Math.max(0, x.inicio - 40), x.inicio).replace(/\s+/g, " ");
        const despues = texto.slice(x.fin, x.fin + 60).replace(/\s+/g, " ");
        const fila = h(
          "button",
          { type: "button", class: "find-snippet" },
          h("span", { class: "muted" }, (x.inicio > 40 ? "…" : "") + antes),
          h("mark", { class: "find-hit" }, texto.slice(x.inicio, x.fin)),
          h("span", { class: "muted" }, despues + "…"),
        );
        fila.addEventListener("click", () => {
          if (esta) {
            const i = this.hits.findIndex((y) => y.inicio === x.inicio);
            this.ir(i);
          } else {
            memoria.pendiente = { escenaId: u.escena.id, inicio: x.inicio };
            this.ed.abrirEscena(u.escena.id);
          }
        });
        filas.push(fila);
      }
      if (hits.length > 8) filas.push(h("div", { class: "find-more muted" }, `y ${hits.length - 8} más`));
    }
    lista.replaceChildren(
      h("div", { class: "find-summary" }, total ? `${num(total)} coincidencias en la novela` : "Sin resultados en la novela"),
      ...filas,
    );
    lista.hidden = false;
  }
}
