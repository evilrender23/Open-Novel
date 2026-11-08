// Vista Escribir: árbol del manuscrito en la barra lateral, editor de escena
// con resaltado de menciones del Codex, beats de escena con IA, acciones sobre
// la selección, panel de contexto, historial, modo lectura y modo foco.

import { ajustes } from "../ajustes";
import { avatar, chipModelo, chips, conTarjeta, ocultarTarjeta, opcionesPov, tarjetaEntrada } from "../componentes";
import { entradasMencionadas, menciones, primerasPalabras, ultimasPalabras } from "../contexto";
import {
  estado,
  guardarCodex,
  guardarMeta,
  guardarTexto,
  instantanea,
  listarInstantaneas,
  novela,
  palabrasEscena,
} from "../estado";
import {
  desplazarCapitulo,
  desplazarEscena,
  duplicarEscena,
  eliminarActo,
  eliminarCapitulo,
  eliminarEscena,
  nuevaEscena,
  nuevoActo,
  nuevoCapitulo,
  renombrar,
} from "../estructura";
import { api } from "../api";
import { Buscador } from "../buscador";
import { markdown } from "../markdown";
import { buscarEscena, contarPalabras, entradaNueva, ESTADOS, todasLasEscenas, TIPOS_CODEX, type AccionPrompt, type TipoCodex } from "../modelo";
import { generarDirecto, Propuesta } from "../propuesta";
import { irA, modoFoco, type ResultadoVista, actualizarEstado } from "../shell";
import { btn, confirmar, errMsg, fechaCorta, h, icon, menu, modal, num, select, toast, vacio, type ItemMenu } from "../ui";

let editorActivo: EditorEscena | null = null;

/** Activa o desactiva el modo lectura (menú Visualización). */
export function alternarLectura(): void {
  const b = document.querySelector<HTMLButtonElement>(".btn-lectura");
  if (b) b.click();
  else lectura = !lectura;
}

/** ⌘F / ⌘⌥F / ⌘G desde los atajos globales. Devuelve false si no hay editor. */
export function atajoBuscar(accion: "buscar" | "reemplazar" | "siguiente" | "anterior"): boolean {
  const ed = editorActivo;
  if (!ed) return false;
  if (lectura) {
    toast("Sal del modo lectura para buscar en el texto.", "info");
    return true;
  }
  ed.buscar(accion);
  return true;
}

const plegados = new Set<string>(JSON.parse(localStorage.getItem("plegados") ?? "[]") as string[]);
let lectura = false;
let panelVisible = localStorage.getItem("panel-escribir") !== "0";

export function abrirEscena(id: string): void {
  estado.escenaActual = id;
  irA("escribir");
}

export function vistaEscribir(): ResultadoVista {
  const n = novela();
  if (!buscarEscena(n.meta, estado.escenaActual)) estado.escenaActual = todasLasEscenas(n.meta)[0]?.escena.id ?? "";

  const arbol = h("div", { class: "tree" });
  const columna = h("div", { class: "ed-column" });
  const scroller = h("div", { class: "ed-scroll" }, columna);
  const panel = h("aside", { class: "ed-panel" });
  const area = h("div", { class: "ed-area" }, scroller);
  const principal = h("div", { class: `write${panelVisible ? "" : " no-panel"}` }, area, panel);

  let editor: EditorEscena | null = null;
  let timerArbol = 0;

  // ── Árbol ──────────────────────────────────────────────────────────────
  const pintarArbol = () => {
    const filas: Node[] = [];
    let numCap = 0;
    for (const acto of n.meta.actos) {
      const plegadoActo = plegados.has(acto.id);
      filas.push(
        filaArbol({
          nivel: 0,
          texto: acto.titulo,
          plegable: true,
          plegado: plegadoActo,
          clase: "tree-act",
          alPlegar: () => alternarPliegue(acto.id),
          menu: () => [
            { texto: "Renombrar", icono: "edit", accion: () => void renombrar(acto, "acto") },
            { texto: "Nuevo capítulo", icono: "plus", accion: () => nuevoCapitulo(acto.id) },
            { separador: true },
            { texto: "Eliminar acto", icono: "trash", peligro: true, accion: () => void eliminarActo(acto.id) },
          ],
        }),
      );
      for (const cap of acto.capitulos) {
        numCap++;
        if (plegadoActo) continue;
        const plegadoCap = plegados.has(cap.id);
        const palabrasCap = cap.escenas.reduce((s, e) => s + contarPalabras(n.textos.get(e.id) ?? ""), 0);
        filas.push(
          filaArbol({
            nivel: 1,
            texto: `${numCap}. ${cap.titulo}`,
            meta: palabrasCap ? num(palabrasCap) : "",
            plegable: true,
            plegado: plegadoCap,
            clase: "tree-chapter",
            alPlegar: () => alternarPliegue(cap.id),
            menu: () => [
              { texto: "Renombrar", icono: "edit", accion: () => void renombrar(cap, "capítulo") },
              { texto: "Nueva escena", icono: "plus", accion: () => seleccionar(nuevaEscena(cap.id).id) },
              { texto: "Nuevo capítulo después", icono: "plus", accion: () => nuevoCapitulo(acto.id, cap.id) },
              { separador: true },
              { texto: "Subir", icono: "arrowUp", accion: () => desplazarCapitulo(cap.id, -1) },
              { texto: "Bajar", icono: "arrowDown", accion: () => desplazarCapitulo(cap.id, 1) },
              { separador: true },
              { texto: "Eliminar capítulo", icono: "trash", peligro: true, accion: () => void eliminarCapitulo(cap.id) },
            ],
          }),
        );
        if (plegadoCap) continue;
        for (const esc of cap.escenas) {
          const fila = filaArbol({
            nivel: 2,
            texto: esc.titulo || "Sin título",
            meta: num(palabrasEscena(esc.id)),
            activo: esc.id === estado.escenaActual,
            clase: "tree-scene",
            punto: esc.estado,
            alClic: () => seleccionar(esc.id),
            menu: () => menuEscena(esc.id, cap.id),
          });
          fila.dataset.escena = esc.id;
          filas.push(fila);
        }
      }
    }
    arbol.replaceChildren(...filas);
  };

  const menuEscena = (id: string, capId: string): ItemMenu[] => {
    const u = buscarEscena(n.meta, id);
    if (!u) return [];
    return [
      { texto: "Renombrar", icono: "edit", accion: () => void renombrar(u.escena, "escena") },
      { texto: "Duplicar", icono: "duplicate", accion: () => duplicarEscena(id) },
      { texto: "Nueva escena después", icono: "plus", accion: () => seleccionar(nuevaEscena(capId, id).id) },
      { separador: true },
      { texto: "Resumir con IA", icono: "sparkle", accion: () => void resumirEscena(id) },
      { texto: "Subir", icono: "arrowUp", accion: () => desplazarEscena(id, -1) },
      { texto: "Bajar", icono: "arrowDown", accion: () => desplazarEscena(id, 1) },
      { separador: true },
      { texto: "Eliminar escena", icono: "trash", peligro: true, accion: () => void eliminarEscena(id) },
    ];
  };

  const alternarPliegue = (id: string) => {
    if (plegados.has(id)) plegados.delete(id);
    else plegados.add(id);
    localStorage.setItem("plegados", JSON.stringify([...plegados]));
    pintarArbol();
  };

  const seleccionar = (id: string) => {
    editor?.guardarYa();
    estado.escenaActual = id;
    pintarArbol();
    pintarEditor();
    actualizarEstado();
  };

  // ── Editor ─────────────────────────────────────────────────────────────
  const pintarEditor = () => {
    ocultarTarjeta();
    editor?.destruir();
    editor = null;
    const u = buscarEscena(n.meta, estado.escenaActual);
    if (!u) {
      columna.replaceChildren(
        vacio("No hay escenas", "Crea un capítulo y una escena para empezar a escribir.", btn("Nueva escena", { icon: "plus", variant: "primary", onclick: () => crearPrimera() })),
      );
      panel.replaceChildren();
      return;
    }
    editor = editorActivo = new EditorEscena(u.escena.id, columna, panel, {
      alCambiarTexto: () => {
        const fila = arbol.querySelector<HTMLElement>(`[data-escena="${u.escena.id}"] .tree-meta`);
        if (fila) fila.textContent = num(palabrasEscena(u.escena.id));
        window.clearTimeout(timerArbol);
        timerArbol = window.setTimeout(pintarArbol, 1200);
      },
      seleccionar,
    });
    scroller.scrollTop = 0;
  };

  const crearPrimera = () => {
    if (!n.meta.actos.length) nuevoActo();
    const acto = n.meta.actos[0];
    if (!acto.capitulos.length) nuevoCapitulo(acto.id);
    seleccionar(nuevaEscena(acto.capitulos[0].id).id);
  };

  pintarArbol();
  pintarEditor();

  const lateral = h(
    "div",
    { class: "sb-section" },
    h(
      "div",
      { class: "sb-section-head" },
      h("span", null, "Manuscrito"),
      btn(null, {
        icon: "plus",
        variant: "ghost",
        size: "icon-xs",
        title: "Añadir",
        onclick: (ev) => {
          const u = buscarEscena(n.meta, estado.escenaActual);
          menu(
            [
              ...(u ? [{ texto: "Escena en este capítulo", icono: "plus" as const, accion: () => seleccionar(nuevaEscena(u.capitulo.id, u.escena.id).id) }] : []),
              ...(u ? [{ texto: "Capítulo en este acto", icono: "plus" as const, accion: () => {
                const c = nuevoCapitulo(u.acto.id, u.capitulo.id);
                seleccionar(c.escenas[0].id);
              } }] : []),
              { texto: "Acto nuevo", icono: "plus", accion: () => {
                const a = nuevoActo();
                seleccionar(a.capitulos[0].escenas[0].id);
              } },
            ],
            ev.currentTarget as HTMLElement,
          );
        },
      }),
    ),
    arbol,
  );

  const acciones = [
    btn(null, {
      icon: "eye",
      variant: "ghost",
      size: "icon-sm",
      title: "Modo lectura",
      class: `btn-lectura${lectura ? " is-on" : ""}`,
      onclick: (e) => {
        lectura = !lectura;
        (e.currentTarget as HTMLElement).classList.toggle("is-on", lectura);
        pintarEditor();
      },
    }),
    btn(null, { icon: "history", variant: "ghost", size: "icon-sm", title: "Historial de la escena", onclick: () => void abrirHistorial(estado.escenaActual, () => pintarEditor()) }),
    btn(null, { icon: "focus", variant: "ghost", size: "icon-sm", title: "Modo foco (⌘⇧F)", onclick: () => modoFoco() }),
    btn(null, {
      icon: "codex",
      variant: "ghost",
      size: "icon-sm",
      title: "Panel de la escena",
      class: panelVisible ? "is-on" : "",
      onclick: (e) => {
        panelVisible = !panelVisible;
        localStorage.setItem("panel-escribir", panelVisible ? "1" : "0");
        principal.classList.toggle("no-panel", !panelVisible);
        (e.currentTarget as HTMLElement).classList.toggle("is-on", panelVisible);
      },
    }),
  ];

  return {
    titulo: "Escribir",
    principal,
    lateral,
    acciones,
    alCambiar: (c, id) => {
      if (c === "meta") {
        // Cambios de título/resumen mientras se escribe: no tocar los campos con foco.
        pintarArbol();
        return true;
      }
      if (c === "estructura") {
        pintarArbol();
        if (!buscarEscena(n.meta, estado.escenaActual)) pintarEditor();
        else editor?.refrescarCabecera();
        return true;
      }
      if (c === "codex") {
        editor?.refrescarPanel();
        editor?.pintarFondo();
        return true;
      }
      if (c === "texto") {
        if (id !== estado.escenaActual) pintarArbol();
        return true;
      }
      if (c === "recarga") {
        const actualNovela = novela();
        if (actualNovela !== n) return false; // objeto nuevo: remontar
        return true;
      }
      return true;
    },
    desmontar: () => {
      editor?.guardarYa();
      editor?.destruir();
      editorActivo = null;
      ocultarTarjeta();
    },
  };
}

function filaArbol(o: {
  nivel: number;
  texto: string;
  meta?: string;
  plegable?: boolean;
  plegado?: boolean;
  activo?: boolean;
  clase: string;
  punto?: string;
  alPlegar?: () => void;
  alClic?: () => void;
  menu: () => ItemMenu[];
}): HTMLElement {
  const fila = h(
    "div",
    { class: `tree-row ${o.clase}${o.activo ? " is-active" : ""}`, style: `--lvl:${o.nivel}`, role: "treeitem", tabIndex: 0 },
    o.plegable
      ? h("span", { class: `tree-caret${o.plegado ? " is-closed" : ""}` }, icon("chevronDown"))
      : o.punto
        ? h("span", { class: `status-dot is-${o.punto}` })
        : null,
    h("span", { class: "tree-text", attrs: { translate: "no" } }, o.texto),
    o.meta ? h("span", { class: "tree-meta" }, o.meta) : null,
    h("button", { type: "button", class: "tree-more", attrs: { "aria-label": "Acciones" }, onclick: (e: MouseEvent) => {
      e.stopPropagation();
      menu(o.menu(), e.currentTarget as HTMLElement);
    } }, icon("more")),
  );
  fila.addEventListener("click", () => (o.alClic ? o.alClic() : o.alPlegar?.()));
  fila.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fila.click();
  });
  fila.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    menu(o.menu(), { x: e.clientX, y: e.clientY });
  });
  return fila;
}

// ── Editor de una escena ─────────────────────────────────────────────────

const LONGITUDES = [
  { valor: "150", texto: "Corto" },
  { valor: "400", texto: "Medio" },
  { valor: "800", texto: "Largo" },
];

class EditorEscena {
  private ta: HTMLTextAreaElement;
  private fondo: HTMLElement;
  private cabecera: HTMLElement;
  private zonaPropuesta: HTMLElement;
  private barraSel: HTMLElement;
  private beat: HTMLTextAreaElement;
  private cursor = -1;
  private raf = 0;
  private propuesta: Propuesta | null = null;
  private longitud = localStorage.getItem("longitud-beat") ?? "400";
  private modeloBeat = "";
  private capaBusqueda: HTMLElement;
  private selDerecho: { a: number; b: number } | null = null;
  private buscador: Buscador;

  constructor(
    private id: string,
    private columna: HTMLElement,
    private panel: HTMLElement,
    private cb: { alCambiarTexto: () => void; seleccionar: (id: string) => void },
  ) {
    const n = novela();
    this.cabecera = h("div", { class: "ed-header" });
    this.ta = h("textarea", { class: "ed-text", spellcheck: true, placeholder: "Empieza a escribir… o describe un beat abajo y deja que la IA te proponga prosa." });
    this.ta.value = n.textos.get(id) ?? "";
    this.fondo = h("div", { class: "ed-backdrop", attrs: { "aria-hidden": "true", translate: "no" } });
    this.capaBusqueda = h("div", { class: "ed-backdrop ed-find-layer", attrs: { "aria-hidden": "true", translate: "no" } });
    this.zonaPropuesta = h("div", { class: "ed-proposals" });
    this.barraSel = h("div", { class: "selbar", hidden: true });
    this.beat = h("textarea", { class: "composer-input", rows: 1, placeholder: "Beat: ¿qué ocurre a continuación? (⌘↵ genera prosa)" });

    this.refrescarCabecera();
    const cuerpo = lectura ? this.vistaLectura() : h("div", { class: "ed-wrap" }, this.fondo, this.capaBusqueda, this.ta);
    this.columna.replaceChildren(
      this.cabecera,
      cuerpo,
      this.zonaPropuesta,
      lectura ? h("div") : this.composer(),
      this.navegacion(),
    );
    this.columna.append(this.barraSel);
    const scroller = this.columna.parentElement!;
    this.buscador = new Buscador({
      escenaId: id,
      textarea: this.ta,
      capa: this.capaBusqueda,
      scroller,
      anclaje: scroller.parentElement ?? scroller,
      reemplazar: (a, b, t) => this.aplicar(a, b, t),
      abrirEscena: (escena) => this.cb.seleccionar(escena),
    });

    this.ta.addEventListener("input", () => this.alEscribir());
    for (const ev of ["keyup", "mouseup", "select", "focus"]) this.ta.addEventListener(ev, () => this.alSeleccionar());
    this.ta.addEventListener("keydown", (e) => this.atajos(e));
    // El botón derecho (o ⌃clic) mueve el cursor en el mousedown y la selección
    // se pierde antes del menú: si hay texto seleccionado, se conserva.
    this.ta.addEventListener("mousedown", (e) => {
      const derecho = e.button === 2 || (e.button === 0 && e.ctrlKey);
      if (!derecho) return;
      const a = this.ta.selectionStart;
      const b = this.ta.selectionEnd;
      if (b > a) {
        e.preventDefault();
        this.selDerecho = { a, b };
      } else this.selDerecho = null;
    });
    this.ta.addEventListener("contextmenu", (e) => this.menuContextual(e));
    this.ta.addEventListener("blur", () => window.setTimeout(() => this.alSeleccionar(), 150));
    requestAnimationFrame(() => {
      this.ajustarAltura();
      this.pintarFondo();
    });
    this.refrescarPanel();
  }

  buscar(accion: "buscar" | "reemplazar" | "siguiente" | "anterior"): void {
    if (accion === "buscar") this.buscador.abrir();
    else if (accion === "reemplazar") this.buscador.mostrarReemplazo(true);
    else this.buscador.siguiente(accion === "siguiente" ? 1 : -1);
  }

  destruir(): void {
    this.buscador.cerrar(false);
    cancelAnimationFrame(this.raf);
    this.propuesta?.cerrar();
  }

  guardarYa(): void {
    const n = estado.novela;
    if (!n || lectura) return;
    if ((n.textos.get(this.id) ?? "") !== this.ta.value) guardarTexto(this.id, this.ta.value);
  }

  // Cabecera: capítulo, título editable, estado y PDV.
  refrescarCabecera(): void {
    const n = novela();
    const u = buscarEscena(n.meta, this.id);
    if (!u) return;
    const titulo = h("input", { class: "ed-title", value: u.escena.titulo, placeholder: "Título de la escena" });
    titulo.addEventListener("input", () => {
      u.escena.titulo = titulo.value;
      guardarMeta("meta");
    });
    titulo.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.ta.focus();
      }
    });
    const estadoSel = select(ESTADOS, u.escena.estado, (v) => {
      u.escena.estado = v;
      guardarMeta();
    }, "select select-ghost");
    const pov = select(opcionesPov(), u.escena.pov, (v) => {
      u.escena.pov = v;
      guardarMeta("meta");
      this.refrescarPanel();
    }, "select select-ghost");
    this.cabecera.replaceChildren(
      h("div", { class: "ed-kicker" }, `${u.acto.titulo} · Capítulo ${u.numCapitulo}: ${u.capitulo.titulo}`),
      titulo,
      h("div", { class: "ed-meta" }, h("span", { class: `status-dot is-${u.escena.estado}` }), estadoSel, icon("user"), pov),
    );
  }

  private alEscribir(): void {
    this.ajustarAltura();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.pintarFondo());
    guardarTexto(this.id, this.ta.value);
    this.cb.alCambiarTexto();
    this.buscador.alCambiarTexto();
    this.cursor = this.ta.selectionEnd;
    window.clearTimeout(this.timerPanel);
    this.timerPanel = window.setTimeout(() => this.refrescarPanel(), 800);
  }
  private timerPanel = 0;

  private ajustarAltura(): void {
    const scroller = this.columna.parentElement;
    const y = scroller?.scrollTop ?? 0;
    this.ta.style.height = "auto";
    this.ta.style.height = `${Math.max(320, this.ta.scrollHeight)}px`;
    if (scroller) scroller.scrollTop = y;
  }

  /** Capa trasera con el mismo texto y las menciones del Codex resaltadas. */
  pintarFondo(): void {
    if (lectura) return;
    const texto = this.ta.value;
    const nodos: Node[] = [];
    if (ajustes.resaltarCodex) {
      let ultimo = 0;
      for (const m of menciones(novela(), texto)) {
        if (m.inicio > ultimo) nodos.push(document.createTextNode(texto.slice(ultimo, m.inicio)));
        const mark = h("mark", { class: `mention is-${m.entrada.tipo}` }, texto.slice(m.inicio, m.fin));
        if (m.entrada.color) mark.style.setProperty("--mention", m.entrada.color);
        nodos.push(mark);
        ultimo = m.fin;
      }
      nodos.push(document.createTextNode(texto.slice(ultimo) + "\n "));
    } else nodos.push(document.createTextNode(texto + "\n "));
    this.fondo.replaceChildren(...nodos);
  }

  private vistaLectura(): HTMLElement {
    const texto = novela().textos.get(this.id) ?? "";
    const cont = h("div", { class: "reader" });
    if (!texto.trim()) {
      cont.append(h("p", { class: "muted" }, "Esta escena aún no tiene texto."));
      return cont;
    }
    const md = markdown(texto, "reader-md");
    // Convierte las menciones en enlaces con tarjeta flotante.
    const recorrer = (nodo: Node) => {
      for (const hijo of [...nodo.childNodes]) {
        if (hijo.nodeType === Node.TEXT_NODE) {
          const t = hijo.textContent ?? "";
          const ms = menciones(novela(), t);
          if (!ms.length) continue;
          const frag = document.createDocumentFragment();
          let ultimo = 0;
          for (const m of ms) {
            if (m.inicio > ultimo) frag.append(t.slice(ultimo, m.inicio));
            const span = h("span", { class: `mention-link is-${m.entrada.tipo}` }, t.slice(m.inicio, m.fin));
            conTarjeta(span, m.entrada.id, (id) => abrirEntrada(id));
            frag.append(span);
            ultimo = m.fin;
          }
          frag.append(t.slice(ultimo));
          hijo.replaceWith(frag);
        } else recorrer(hijo);
      }
    };
    recorrer(md);
    cont.append(md);
    return cont;
  }

  // ── Selección ──────────────────────────────────────────────────────────
  private alSeleccionar(): void {
    if (document.activeElement === this.ta) this.cursor = this.ta.selectionEnd;
    const a = this.ta.selectionStart;
    const b = this.ta.selectionEnd;
    const sel = this.ta.value.slice(a, b);
    if (document.activeElement !== this.ta || b - a < 2 || !sel.trim()) {
      if (!this.barraSel.matches(":hover")) this.barraSel.hidden = true;
      return;
    }
    const acc = (texto: string, accion: AccionPrompt) =>
      btn(texto, { variant: "ghost", size: "xs", onclick: () => this.transformar(accion, a, b) });
    this.barraSel.replaceChildren(
      h("span", { class: "selbar-count" }, `${num(contarPalabras(sel))} palabras`),
      acc("Reescribir", "reescribir"),
      acc("Expandir", "expandir"),
      acc("Acortar", "acortar"),
      acc("Mostrar, no contar", "describir"),
      btn("Otra…", { variant: "ghost", size: "xs", onclick: () => this.transformarLibre(a, b) }),
      h("span", { class: "selbar-sep" }),
      btn("Al Codex", { icon: "plus", variant: "ghost", size: "xs", onclick: () => this.crearEntrada(sel.trim()) }),
    );
    this.barraSel.hidden = false;
  }

  private menuContextual(e: MouseEvent): void {
    const guardada = this.selDerecho;
    this.selDerecho = null;
    const a = guardada?.a ?? this.ta.selectionStart;
    const b = guardada?.b ?? this.ta.selectionEnd;
    if (guardada) this.ta.setSelectionRange(a, b);
    const sel = this.ta.value.slice(a, b).trim();
    const items: ItemMenu[] = [];
    if (sel) {
      items.push(
        { titulo: "Selección" },
        { texto: "Reescribir", icono: "wand", accion: () => this.transformar("reescribir", a, b) },
        { texto: "Expandir", icono: "wand", accion: () => this.transformar("expandir", a, b) },
        { texto: "Acortar", icono: "wand", accion: () => this.transformar("acortar", a, b) },
        { texto: "Mostrar, no contar", icono: "wand", accion: () => this.transformar("describir", a, b) },
        { texto: "Otra instrucción…", icono: "sparkle", accion: () => this.transformarLibre(a, b) },
        { separador: true },
        { texto: "Crear entrada del Codex", icono: "codex", accion: () => this.crearEntrada(sel) },
        { texto: "Copiar", icono: "copy", accion: () => void navigator.clipboard.writeText(sel) },
        { texto: "Cortar", icono: "copy", accion: () => {
          void navigator.clipboard.writeText(this.ta.value.slice(a, b));
          this.aplicar(a, b, "");
        } },
      );
    }
    items.push(
      { titulo: "Escena" },
      { texto: "Continuar escribiendo", icono: "sparkle", accion: () => this.continuar() },
      { texto: "Pegar", icono: "copy", accion: () => void navigator.clipboard.readText().then((t) => this.aplicar(a, b, t)) },
      { texto: "Guardar instantánea", icono: "history", accion: () => void instantanea(this.id).then(() => toast("Instantánea guardada", "ok")) },
    );
    e.preventDefault();
    this.ta.focus();
    menu(items, { x: e.clientX, y: e.clientY }, { mantenerFoco: true });
  }

  private atajos(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      this.continuar();
    } else if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      this.envolver("*");
    } else if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      this.envolver("**");
    }
  }

  private envolver(marca: string): void {
    const a = this.ta.selectionStart;
    const b = this.ta.selectionEnd;
    const sel = this.ta.value.slice(a, b);
    this.aplicar(a, b, `${marca}${sel}${marca}`);
    if (!sel) this.ta.setSelectionRange(a + marca.length, a + marca.length);
  }

  /** Inserta/reemplaza conservando el historial de deshacer del textarea. */
  private aplicar(a: number, b: number, texto: string): void {
    this.ta.focus();
    this.ta.setSelectionRange(a, b);
    const ok = document.execCommand("insertText", false, texto);
    if (!ok) {
      this.ta.setRangeText(texto, a, b, "end");
      this.alEscribir();
    }
  }

  // ── IA ─────────────────────────────────────────────────────────────────
  private posicion(): number {
    const p = this.cursor >= 0 ? this.cursor : this.ta.value.length;
    return Math.min(p, this.ta.value.length);
  }

  private mostrarPropuesta(p: Propuesta): void {
    this.propuesta?.cerrar();
    this.propuesta = p;
    this.zonaPropuesta.replaceChildren(p.el);
    p.iniciar();
    p.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private insertarEn(pos: number, texto: string): void {
    const antes = this.ta.value.slice(0, pos);
    let prefijo = "";
    if (antes.trim()) {
      if (/^[\p{Ll},;:)]/u.test(texto)) prefijo = /\s$/.test(antes) ? "" : " ";
      else prefijo = antes.endsWith("\n\n") ? "" : antes.endsWith("\n") ? "\n" : "\n\n";
    }
    void instantanea(this.id, "antes-ia");
    this.aplicar(pos, pos, prefijo + texto);
  }

  private generarProsa(accion: "beat" | "continuar", beat: string): void {
    const pos = this.posicion();
    const texto = this.ta.value;
    this.mostrarPropuesta(
      new Propuesta({
        titulo: accion === "beat" ? "Prosa desde el beat" : "Continuación",
        accion,
        escenaId: this.id,
        modelo: this.modeloBeat || undefined,
        vars: () => ({
          beat,
          texto_previo: ultimasPalabras(texto.slice(0, pos), ajustes.palabrasContexto),
          texto_posterior: primerasPalabras(texto.slice(pos), 200),
          palabras: this.longitud,
        }),
        acciones: [
          {
            texto: "Insertar",
            icono: "check",
            primaria: true,
            fn: (t) => {
              this.insertarEn(pos, t);
              if (accion === "beat") {
                this.beat.value = "";
                this.beat.style.height = "";
              }
            },
          },
        ],
        alCerrar: () => (this.propuesta = null),
      }),
    );
  }

  private continuar(): void {
    const beat = this.beat.value.trim();
    this.generarProsa(beat ? "beat" : "continuar", beat);
  }

  private transformar(accion: AccionPrompt, a: number, b: number, instrucciones = ""): void {
    const original = this.ta.value.slice(a, b);
    const titulos: Partial<Record<AccionPrompt, string>> = {
      reescribir: "Reescritura",
      expandir: "Expansión",
      acortar: "Versión condensada",
      describir: "Mostrar, no contar",
    };
    this.barraSel.hidden = true;
    this.mostrarPropuesta(
      new Propuesta({
        titulo: titulos[accion] ?? "Propuesta",
        accion,
        escenaId: this.id,
        vars: () => ({
          seleccion: original,
          texto_previo: ultimasPalabras(this.ta.value.slice(0, a), 300),
          instrucciones,
        }),
        acciones: [
          {
            texto: "Reemplazar",
            icono: "check",
            primaria: true,
            fn: (t) => {
              let i = a;
              if (this.ta.value.slice(a, b) !== original) i = this.ta.value.indexOf(original);
              if (i < 0) return toast("La selección original ha cambiado; copia la propuesta a mano.", "error");
              void instantanea(this.id, "antes-ia");
              this.aplicar(i, i + original.length, t);
            },
          },
          { texto: "Insertar debajo", icono: "plus", fn: (t) => this.insertarEn(b, t) },
        ],
        alCerrar: () => (this.propuesta = null),
      }),
    );
  }

  private transformarLibre(a: number, b: number): void {
    const m = modal("Instrucción personalizada", { subtitle: "Qué hacer con el texto seleccionado" });
    const t = h("textarea", { class: "textarea", rows: 3, placeholder: "p. ej. «Hazlo más tenso, con frases cortas», «Pásalo a primera persona»…" });
    const ir = () => {
      if (!t.value.trim()) return;
      m.close();
      this.transformar("reescribir", a, b, t.value.trim());
    };
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ir();
    });
    m.body.append(t);
    m.footer.append(btn("Cancelar", { variant: "text", onclick: () => m.close() }), btn("Aplicar", { variant: "primary", icon: "sparkle", onclick: ir }));
    window.setTimeout(() => t.focus(), 10);
  }

  private crearEntrada(nombre: string): void {
    const m = modal("Nueva entrada del Codex");
    const input = h("input", { class: "input", value: nombre.slice(0, 80) });
    let tipo: TipoCodex = "personaje";
    m.body.append(
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Nombre"), input),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Tipo"), select(TIPOS_CODEX.map((t) => ({ valor: t.valor, texto: t.texto })), tipo, (v) => (tipo = v))),
    );
    m.footer.append(
      btn("Cancelar", { variant: "text", onclick: () => m.close() }),
      btn("Crear", {
        variant: "primary",
        onclick: () => {
          if (!input.value.trim()) return;
          const e = entradaNueva(input.value.trim(), tipo);
          guardarCodex(e);
          m.close();
          toast(`«${e.nombre}» añadido al Codex`, "ok");
        },
      }),
    );
  }

  private composer(): HTMLElement {
    this.beat.addEventListener("input", () => {
      this.beat.style.height = "auto";
      this.beat.style.height = `${Math.min(200, this.beat.scrollHeight)}px`;
    });
    this.beat.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.continuar();
      }
    });
    const longitud = select(LONGITUDES, this.longitud, (v) => {
      this.longitud = v;
      localStorage.setItem("longitud-beat", v);
    }, "select select-chip");
    return h(
      "div",
      { class: "composer ed-composer" },
      this.beat,
      h(
        "div",
        { class: "composer-row" },
        chipModelo(() => this.modeloBeat || ajustes.modelos.escritura, (r) => (this.modeloBeat = r)),
        longitud,
        h("span", { class: "grow" }),
        btn("Continuar", { variant: "ghost", size: "xs", icon: "sparkle", onclick: () => this.generarProsa("continuar", "") }),
        h("button", { type: "button", class: "send", attrs: { "aria-label": "Generar (⌘↵)", "data-tip": "Generar (⌘↵)" }, onclick: () => this.continuar() }, icon("send")),
      ),
    );
  }

  private navegacion(): HTMLElement {
    const todas = todasLasEscenas(novela().meta);
    const i = todas.findIndex((u) => u.escena.id === this.id);
    const prev = todas[i - 1];
    const sig = todas[i + 1];
    return h(
      "nav",
      { class: "ed-nav" },
      prev ? h("button", { type: "button", class: "ed-nav-btn", onclick: () => this.cb.seleccionar(prev.escena.id) }, icon("arrowLeft"), h("span", null, prev.escena.titulo)) : h("span"),
      sig ? h("button", { type: "button", class: "ed-nav-btn is-next", onclick: () => this.cb.seleccionar(sig.escena.id) }, h("span", null, sig.escena.titulo), icon("arrowRight")) : h("span"),
    );
  }

  // ── Panel lateral derecho ──────────────────────────────────────────────
  refrescarPanel(): void {
    const n = novela();
    const u = buscarEscena(n.meta, this.id);
    if (!u) return;
    const resumen = h("textarea", { class: "textarea panel-summary", rows: 5, placeholder: "¿Qué ocurre en esta escena? El resumen guía a la IA y alimenta «la historia hasta ahora»." });
    resumen.value = u.escena.resumen;
    resumen.addEventListener("input", () => {
      u.escena.resumen = resumen.value;
      guardarMeta("meta");
    });
    const objetivo = h("input", { class: "input input-sm", type: "number", min: "0", step: "100", value: String(u.escena.objetivo || "") , placeholder: "—" });
    objetivo.addEventListener("change", () => {
      u.escena.objetivo = Math.max(0, Number(objetivo.value) || 0);
      guardarMeta("meta");
    });
    const palabras = palabrasEscena(this.id);
    const pct = u.escena.objetivo ? Math.min(100, (palabras / u.escena.objetivo) * 100) : 0;

    const textoActual = this.ta.value || (n.textos.get(this.id) ?? "");
    const conteo = entradasMencionadas(n, textoActual, u.escena.resumen);
    const siempre = [...n.codex.values()].filter((e) => e.incluir === "siempre" && !conteo.has(e.id));
    const detectadas = [...conteo.entries()]
      .map(([id, veces]) => ({ e: n.codex.get(id)!, veces }))
      .filter((x) => x.e)
      .sort((a, b) => b.veces - a.veces);

    const filaEntrada = (e: ReturnType<typeof n.codex.get> & object, extra: string) => {
      const fila = h(
        "button",
        { type: "button", class: "ctx-row", onclick: () => this.verEntrada(e.id) },
        avatar(e, "avatar-sm"),
        h("span", { class: "ctx-name" }, e.nombre),
        h("span", { class: "ctx-meta" }, extra),
      );
      return fila;
    };

    const btnResumir = btn(null, { icon: "sparkle", variant: "ghost", size: "icon-xs", title: "Resumir con IA", onclick: () => void resumirEscena(this.id).then(() => this.refrescarPanel()) });

    this.panel.replaceChildren(
      h(
        "section",
        { class: "panel-sec" },
        h("div", { class: "panel-head" }, h("span", null, "Resumen"), btnResumir),
        resumen,
      ),
      h(
        "section",
        { class: "panel-sec" },
        h("div", { class: "panel-head" }, h("span", null, "Progreso")),
        h("div", { class: "panel-stat" }, h("strong", null, num(palabras)), h("span", null, " palabras"), h("span", { class: "grow" }), h("span", { class: "muted" }, "Objetivo"), objetivo),
        u.escena.objetivo ? h("span", { class: "meter meter-wide" }, h("span", { class: "meter-fill", style: `width:${pct}%` })) : null,
      ),
      h(
        "section",
        { class: "panel-sec" },
        h("div", { class: "panel-head" }, h("span", null, "Etiquetas")),
        chips(u.escena.etiquetas, (v) => {
          u.escena.etiquetas = v;
          guardarMeta("meta");
        }, "Añadir etiqueta…"),
      ),
      h(
        "section",
        { class: "panel-sec" },
        h("div", { class: "panel-head" }, h("span", null, "Codex en esta escena"), h("span", { class: "muted" }, String(detectadas.length))),
        detectadas.length
          ? h("div", { class: "ctx-list" }, ...detectadas.map((x) => filaEntrada(x.e, `×${x.veces}`)))
          : h("p", { class: "panel-empty" }, "Ninguna entrada mencionada. Las menciones de nombres y alias se detectan solas."),
        siempre.length ? h("div", { class: "panel-sub" }, "Siempre en contexto") : null,
        siempre.length ? h("div", { class: "ctx-list" }, ...siempre.map((e) => filaEntrada(e, "fijada"))) : null,
      ),
    );
  }

  private verEntrada(id: string): void {
    const e = novela().codex.get(id);
    if (!e) return;
    const m = modal(e.nombre);
    m.body.append(tarjetaEntrada(e));
    m.footer.append(btn("Cerrar", { variant: "text", onclick: () => m.close() }), btn("Abrir en el Codex", { variant: "primary", onclick: () => (m.close(), abrirEntrada(id)) }));
  }
}

export function abrirEntrada(id: string): void {
  estado.entradaActual = id;
  irA("codex");
}

export async function resumirEscena(id: string): Promise<void> {
  const n = novela();
  const u = buscarEscena(n.meta, id);
  if (!u) return;
  if (!(n.textos.get(id) ?? "").trim()) {
    toast("La escena no tiene texto que resumir.", "info");
    return;
  }
  toast(`Resumiendo «${u.escena.titulo}»…`);
  try {
    const t = (await generarDirecto("resumir", {}, id).promesa).trim();
    if (t) {
      u.escena.resumen = t;
      guardarMeta("meta");
      toast("Resumen actualizado", "ok");
    }
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

// ── Historial ────────────────────────────────────────────────────────────

async function abrirHistorial(id: string, alRestaurar: () => void): Promise<void> {
  const n = novela();
  const u = buscarEscena(n.meta, id);
  if (!u) return;
  const m = modal(`Historial · ${u.escena.titulo}`, { wide: true, subtitle: "Instantáneas guardadas antes de cambios de la IA y manualmente." });
  const lista = h("div", { class: "hist-list" });
  const vista = h("div", { class: "hist-view" }, h("p", { class: "muted" }, "Elige una instantánea."));
  m.body.append(h("div", { class: "hist" }, lista, vista));
  m.footer.append(
    btn("Guardar instantánea ahora", { icon: "history", variant: "secondary", onclick: async () => {
      await instantanea(id);
      toast("Instantánea guardada", "ok");
      await cargar();
    } }),
    h("span", { class: "grow" }),
    btn("Cerrar", { variant: "text", onclick: () => m.close() }),
  );
  const cargar = async () => {
    const items = await listarInstantaneas(id);
    if (!items.length) {
      lista.replaceChildren(h("p", { class: "panel-empty" }, "Aún no hay instantáneas."));
      return;
    }
    lista.replaceChildren(
      ...items.map((it) => {
        const b = h(
          "button",
          { type: "button", class: "hist-item" },
          h("span", null, fechaCorta(it.fecha)),
          h("span", { class: "muted" }, it.motivo === "antes-ia" ? "antes de IA" : it.motivo === "antes-agente" ? "antes del agente" : it.motivo),
        );
        b.addEventListener("click", async () => {
          for (const x of lista.querySelectorAll(".hist-item")) x.classList.remove("is-active");
          b.classList.add("is-active");
          const texto = (await api.archivoLeer(n.carpeta, it.ruta)) ?? "";
          vista.replaceChildren(
            h("div", { class: "hist-actions" }, h("span", { class: "muted" }, `${num(contarPalabras(texto))} palabras`), h("span", { class: "grow" }), btn("Restaurar esta versión", {
              icon: "history",
              variant: "primary",
              size: "sm",
              onclick: async () => {
                if (!(await confirmar("Restaurar versión", "El texto actual se guardará como instantánea y se reemplazará por esta versión.", "Restaurar", false))) return;
                await instantanea(id, "antes-restaurar");
                guardarTexto(id, texto);
                m.close();
                alRestaurar();
                toast("Versión restaurada", "ok");
              },
            })),
            h("pre", { class: "hist-text" }, texto),
          );
        });
        return b;
      }),
    );
  };
  await cargar();
}
