// Vista Planificar: cuadrícula de capítulos con tarjetas de escena (arrastrar y
// soltar), esquema editable y matriz escenas × Codex.

import { avatar, opcionesPov, segmentado } from "../componentes";
import { escenasConEntrada } from "../contexto";
import { actualizarGuiaAgente, guardarMeta, novela, palabrasEscena } from "../estado";
import {
  desplazarActo,
  desplazarCapitulo,
  duplicarEscena,
  eliminarActo,
  eliminarCapitulo,
  eliminarEscena,
  moverEscena,
  nuevaEscena,
  nuevoActo,
  nuevoCapitulo,
  renombrar,
} from "../estructura";
import { ESTADOS, TIPOS_CODEX, todasLasEscenas, type Capitulo, type Escena, type TipoCodex } from "../modelo";
import { type ResultadoVista } from "../shell";
import { ajustes } from "../ajustes";
import { IDIOMAS_ESCRITURA } from "../i18n";
import { btn, campo, h, icon, menu, modal, num, select, toast, vacio } from "../ui";
import { abrirEscena, resumirEscena } from "./escribir";

type Modo = "cuadricula" | "esquema" | "matriz";
let modo: Modo = (localStorage.getItem("plan-modo") as Modo) ?? "cuadricula";
let tipoMatriz: TipoCodex = "personaje";

export function vistaPlanificar(): ResultadoVista {
  const cuerpo = h("div", { class: "plan-body" });
  const principal = h("div", { class: "plan" }, cuerpo);

  const pintar = () => {
    const y = cuerpo.scrollTop;
    const x = cuerpo.querySelector(".board")?.scrollLeft ?? 0;
    cuerpo.replaceChildren(modo === "cuadricula" ? cuadricula() : modo === "esquema" ? esquemaEditable() : matriz(pintar));
    cuerpo.scrollTop = y;
    const board = cuerpo.querySelector(".board");
    if (board) board.scrollLeft = x;
  };
  pintar();

  const acciones = [
    segmentado<Modo>(
      [
        { valor: "cuadricula", texto: "Cuadrícula", icono: "grid" },
        { valor: "esquema", texto: "Esquema", icono: "list" },
        { valor: "matriz", texto: "Matriz", icono: "matrix" },
      ],
      modo,
      (v) => {
        modo = v;
        localStorage.setItem("plan-modo", v);
        pintar();
      },
    ),
    btn("Resumir todo", { icon: "sparkle", variant: "ghost", size: "sm", onclick: () => void resumirPendientes() }),
    btn("Acto", { icon: "plus", variant: "ghost", size: "sm", onclick: () => nuevoActo() }),
    btn("Novela", { icon: "book", variant: "secondary", size: "sm", onclick: () => abrirMetadatos() }),
  ];

  let editando = false;
  principal.addEventListener("focusin", (e) => {
    if ((e.target as HTMLElement).matches("input, textarea")) editando = true;
  });
  principal.addEventListener("focusout", () => {
    editando = false;
  });

  return {
    titulo: "Planificar",
    principal,
    acciones,
    alCambiar: (c) => {
      if (c === "recarga") return false;
      // No repintar mientras se escribe en un campo (perdería el foco).
      if ((c === "meta" || c === "texto") && editando) return true;
      if (["estructura", "meta", "codex", "texto"].includes(c)) pintar();
      return true;
    },
  };
}

// ── Cuadrícula ───────────────────────────────────────────────────────────

let arrastrando: string | null = null;

function cuadricula(): HTMLElement {
  const n = novela();
  const cont = h("div", { class: "board-wrap" });
  let numCap = 0;
  for (const acto of n.meta.actos) {
    const cols: HTMLElement[] = [];
    for (const cap of acto.capitulos) {
      numCap++;
      cols.push(columnaCapitulo(cap, numCap, acto.id));
    }
    cols.push(
      h("button", { type: "button", class: "board-add-col", onclick: () => nuevoCapitulo(acto.id) }, icon("plus"), "Capítulo"),
    );
    const palabras = acto.capitulos.reduce((s, c) => s + c.escenas.reduce((t, e) => t + palabrasEscena(e.id), 0), 0);
    cont.append(
      h(
        "section",
        { class: "act" },
        h(
          "header",
          { class: "act-head" },
          h("h2", { class: "act-title" }, acto.titulo),
          h("span", { class: "muted" }, `${acto.capitulos.length} capítulos · ${num(palabras)} palabras`),
          h("span", { class: "grow" }),
          btn(null, {
            icon: "more",
            variant: "ghost",
            size: "icon-xs",
            title: "Acciones del acto",
            onclick: (e) =>
              menu(
                [
                  { texto: "Renombrar", icono: "edit", accion: () => void renombrar(acto, "acto") },
                  { texto: "Nuevo capítulo", icono: "plus", accion: () => nuevoCapitulo(acto.id) },
                  { texto: "Subir acto", icono: "arrowUp", accion: () => desplazarActo(acto.id, -1) },
                  { texto: "Bajar acto", icono: "arrowDown", accion: () => desplazarActo(acto.id, 1) },
                  { separador: true },
                  { texto: "Eliminar acto", icono: "trash", peligro: true, accion: () => void eliminarActo(acto.id) },
                ],
                e.currentTarget as HTMLElement,
              ),
          }),
        ),
        h("div", { class: "board" }, ...cols),
      ),
    );
  }
  return cont;
}

function columnaCapitulo(cap: Capitulo, numCap: number, actoId: string): HTMLElement {
  const lista = h("div", { class: "col-scenes" });
  cap.escenas.forEach((e, i) => lista.append(tarjetaEscena(e, cap.id, i)));
  // Soltar al final de la columna.
  const zonaFinal = h("div", { class: "drop-end" });
  lista.append(zonaFinal);
  lista.addEventListener("dragover", (ev) => {
    if (!arrastrando) return;
    ev.preventDefault();
    lista.classList.add("is-over");
  });
  lista.addEventListener("dragleave", (ev) => {
    if (!lista.contains(ev.relatedTarget as Node)) lista.classList.remove("is-over");
  });
  lista.addEventListener("drop", (ev) => {
    ev.preventDefault();
    lista.classList.remove("is-over");
    if (!arrastrando) return;
    const destino = (ev.target as HTMLElement).closest<HTMLElement>(".scene-card");
    const indice = destino ? Number(destino.dataset.indice) + (ev.offsetY > destino.offsetHeight / 2 ? 1 : 0) : cap.escenas.length;
    moverEscena(arrastrando, cap.id, indice);
    arrastrando = null;
  });

  const palabras = cap.escenas.reduce((s, e) => s + palabrasEscena(e.id), 0);
  const titulo = h("input", { class: "col-title", value: cap.titulo, attrs: { "aria-label": "Título del capítulo" } });
  titulo.addEventListener("change", () => {
    cap.titulo = titulo.value.trim() || cap.titulo;
    guardarMeta("meta");
  });
  return h(
    "div",
    { class: "col" },
    h(
      "header",
      { class: "col-head" },
      h("span", { class: "col-num" }, String(numCap)),
      titulo,
      btn(null, {
        icon: "more",
        variant: "ghost",
        size: "icon-xs",
        title: "Acciones del capítulo",
        onclick: (e) =>
          menu(
            [
              { texto: "Nueva escena", icono: "plus", accion: () => nuevaEscena(cap.id) },
              { texto: "Nuevo capítulo después", icono: "plus", accion: () => nuevoCapitulo(actoId, cap.id) },
              { texto: "Mover a la izquierda", icono: "arrowLeft", accion: () => desplazarCapitulo(cap.id, -1) },
              { texto: "Mover a la derecha", icono: "arrowRight", accion: () => desplazarCapitulo(cap.id, 1) },
              { separador: true },
              { texto: "Eliminar capítulo", icono: "trash", peligro: true, accion: () => void eliminarCapitulo(cap.id) },
            ],
            e.currentTarget as HTMLElement,
          ),
      }),
    ),
    h("div", { class: "col-meta" }, `${cap.escenas.length} escenas · ${num(palabras)} palabras`),
    lista,
    h("button", { type: "button", class: "col-add", onclick: () => nuevaEscena(cap.id) }, icon("plus"), "Escena"),
  );
}

function tarjetaEscena(e: Escena, capId: string, i: number): HTMLElement {
  const n = novela();
  const resumen = h("textarea", { class: "card-summary", rows: 3, placeholder: "Resumen de la escena…" });
  resumen.value = e.resumen;
  resumen.addEventListener("input", () => {
    e.resumen = resumen.value;
    resumen.style.height = "auto";
    resumen.style.height = `${resumen.scrollHeight}px`;
    guardarMeta("meta");
  });
  requestAnimationFrame(() => {
    resumen.style.height = "auto";
    resumen.style.height = `${Math.max(48, resumen.scrollHeight)}px`;
  });
  const titulo = h("input", { class: "card-title", value: e.titulo });
  titulo.addEventListener("input", () => {
    e.titulo = titulo.value;
    guardarMeta("meta");
  });
  const pov = n.codex.get(e.pov);
  const palabras = palabrasEscena(e.id);
  const card = h(
    "article",
    { class: `scene-card is-${e.estado}`, draggable: true, dataset: { indice: String(i), id: e.id } },
    h(
      "div",
      { class: "card-head" },
      h("span", { class: "card-grip" }, icon("drag")),
      titulo,
      btn(null, {
        icon: "more",
        variant: "ghost",
        size: "icon-xs",
        title: "Acciones de la escena",
        onclick: (ev) =>
          menu(
            [
              { texto: "Abrir en el editor", icono: "write", accion: () => abrirEscena(e.id) },
              { texto: "Resumir con IA", icono: "sparkle", accion: () => void resumirEscena(e.id) },
              { texto: "Duplicar", icono: "duplicate", accion: () => duplicarEscena(e.id) },
              { texto: "Nueva escena después", icono: "plus", accion: () => nuevaEscena(capId, e.id) },
              { separador: true },
              { titulo: "Estado" },
              ...ESTADOS.map((s) => ({
                texto: s.texto,
                icono: s.valor === e.estado ? ("check" as const) : undefined,
                accion: () => {
                  e.estado = s.valor;
                  guardarMeta();
                },
              })),
              { separador: true },
              { texto: "Eliminar", icono: "trash", peligro: true, accion: () => void eliminarEscena(e.id) },
            ],
            ev.currentTarget as HTMLElement,
          ),
      }),
    ),
    resumen,
    h(
      "div",
      { class: "card-foot" },
      h("span", { class: `status-pill is-${e.estado}` }, ESTADOS.find((s) => s.valor === e.estado)?.texto ?? e.estado),
      pov ? h("span", { class: "card-pov" }, avatar(pov, "avatar-xs"), pov.nombre) : null,
      h("span", { class: "grow" }),
      h("button", { type: "button", class: "card-words", onclick: () => abrirEscena(e.id) }, palabras ? `${num(palabras)} pal.` : "Escribir", icon("arrowRight")),
    ),
  );
  card.addEventListener("dragstart", (ev) => {
    if ((ev.target as HTMLElement).matches("input, textarea")) return ev.preventDefault();
    arrastrando = e.id;
    card.classList.add("is-dragging");
    ev.dataTransfer?.setData("text/plain", e.id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
    arrastrando = null;
  });
  card.addEventListener("dblclick", (ev) => {
    if (!(ev.target as HTMLElement).matches("input, textarea")) abrirEscena(e.id);
  });
  return card;
}

// ── Esquema ──────────────────────────────────────────────────────────────

function esquemaEditable(): HTMLElement {
  const n = novela();
  const cont = h("div", { class: "outline" });
  let numCap = 0;
  for (const acto of n.meta.actos) {
    cont.append(h("h2", { class: "outline-act" }, acto.titulo));
    for (const cap of acto.capitulos) {
      numCap++;
      cont.append(
        h(
          "div",
          { class: "outline-chapter" },
          h("span", { class: "col-num" }, String(numCap)),
          h("h3", null, cap.titulo),
          h("span", { class: "grow" }),
          btn("Escena", { icon: "plus", variant: "ghost", size: "xs", onclick: () => nuevaEscena(cap.id) }),
        ),
      );
      for (const e of cap.escenas) {
        const t = h("textarea", { class: "outline-summary", rows: 2, placeholder: "Resumen…" });
        t.value = e.resumen;
        t.addEventListener("input", () => {
          e.resumen = t.value;
          t.style.height = "auto";
          t.style.height = `${t.scrollHeight}px`;
          guardarMeta("meta");
        });
        requestAnimationFrame(() => {
          t.style.height = "auto";
          t.style.height = `${t.scrollHeight}px`;
        });
        const pov = select(opcionesPov(), e.pov, (v) => {
          e.pov = v;
          guardarMeta("meta");
        }, "select select-ghost");
        cont.append(
          h(
            "div",
            { class: "outline-scene" },
            h(
              "div",
              { class: "outline-scene-head" },
              h("span", { class: `status-dot is-${e.estado}` }),
              h("button", { type: "button", class: "outline-scene-title", onclick: () => abrirEscena(e.id) }, e.titulo),
              h("span", { class: "muted" }, `${num(palabrasEscena(e.id))} pal.`),
              h("span", { class: "grow" }),
              pov,
            ),
            t,
          ),
        );
      }
    }
  }
  return cont;
}

// ── Matriz ───────────────────────────────────────────────────────────────

function matriz(repintar: () => void): HTMLElement {
  const n = novela();
  const entradas = [...n.codex.values()].filter((e) => e.tipo === tipoMatriz).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const filtro = select(TIPOS_CODEX.map((t) => ({ valor: t.valor, texto: t.plural })), tipoMatriz, (v) => {
    tipoMatriz = v;
    repintar();
  });
  const cabecera = h("div", { class: "matrix-bar" }, h("span", { class: "muted" }, "Apariciones de"), filtro, h("span", { class: "muted" }, "en cada escena (menciones detectadas y punto de vista)."));
  if (!entradas.length) return h("div", { class: "matrix-wrap" }, cabecera, vacio("No hay entradas de este tipo en el Codex.", "Crea entradas en la vista Codex para ver sus apariciones."));
  const apariciones = new Map(entradas.map((e) => [e.id, new Map(escenasConEntrada(n, e.id).map((x) => [x.escenaId, x]))]));
  const tabla = h("table", { class: "matrix" });
  tabla.append(
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        h("th", { class: "matrix-corner" }, "Escena"),
        ...entradas.map((e) => h("th", { class: "matrix-col" }, h("span", null, avatar(e, "avatar-xs"), e.nombre))),
      ),
    ),
  );
  const tbody = h("tbody");
  let capAnterior = "";
  for (const u of todasLasEscenas(n.meta)) {
    if (u.capitulo.id !== capAnterior) {
      capAnterior = u.capitulo.id;
      tbody.append(h("tr", { class: "matrix-chapter" }, h("td", { colSpan: entradas.length + 1 }, `Capítulo ${u.numCapitulo}: ${u.capitulo.titulo}`)));
    }
    tbody.append(
      h(
        "tr",
        null,
        h("td", { class: "matrix-scene" }, h("button", { type: "button", onclick: () => abrirEscena(u.escena.id) }, u.escena.titulo)),
        ...entradas.map((e) => {
          const a = apariciones.get(e.id)?.get(u.escena.id);
          if (!a) return h("td", { class: "matrix-cell" });
          const cel = h("td", { class: `matrix-cell is-on${a.pov ? " is-pov" : ""}` }, h("span", { class: "matrix-dot", style: e.color ? `--dot:${e.color}` : "" }, a.pov ? "PDV" : String(a.veces)));
          return cel;
        }),
      ),
    );
  }
  tabla.append(tbody);
  return h("div", { class: "matrix-wrap" }, cabecera, h("div", { class: "matrix-scroll" }, tabla));
}

// ── Resumen en lote ──────────────────────────────────────────────────────

async function resumirPendientes(): Promise<void> {
  const n = novela();
  const pendientes = todasLasEscenas(n.meta).filter((u) => !u.escena.resumen.trim() && (n.textos.get(u.escena.id) ?? "").trim());
  if (!pendientes.length) return toast("Todas las escenas con texto ya tienen resumen.", "info");
  for (const u of pendientes) await resumirEscena(u.escena.id);
}

// ── Metadatos de la novela ───────────────────────────────────────────────

export function abrirMetadatos(): void {
  const n = novela();
  const m = modal("Datos de la novela", { wide: true, subtitle: n.ruta });
  const meta = n.meta;
  const texto = (k: "titulo" | "subtitulo" | "autor" | "serie" | "genero" | "idioma", placeholder = "") => {
    const i = h("input", { class: "input", value: meta[k], placeholder });
    i.addEventListener("input", () => {
      meta[k] = i.value;
      guardarMeta("meta");
    });
    return i;
  };
  const area = (k: "sinopsis" | "estilo", rows: number, placeholder: string) => {
    const t = h("textarea", { class: "textarea", rows, placeholder });
    t.value = meta[k];
    t.addEventListener("input", () => {
      meta[k] = t.value;
      guardarMeta("meta");
    });
    return t;
  };
  const objetivo = h("input", { class: "input", type: "number", step: "1000", min: "0", value: String(meta.objetivoPalabras || "") });
  objetivo.addEventListener("input", () => {
    meta.objetivoPalabras = Math.max(0, Number(objetivo.value) || 0);
    guardarMeta("meta");
  });
  m.body.append(
    h(
      "div",
      { class: "form-grid" },
      campo("Título", texto("titulo")),
      campo("Subtítulo", texto("subtitulo")),
      campo("Autor/a", texto("autor")),
      campo("Serie", texto("serie", "Opcional")),
      campo("Género", texto("genero", "p. ej. fantasía oscura, thriller…")),
      campo(
        "Idioma de la prosa",
        (() => {
          const i = texto("idioma");
          i.setAttribute("list", "idiomas-escritura");
          return h("div", null, i, h("datalist", { id: "idiomas-escritura" }, ...IDIOMAS_ESCRITURA.map((x) => h("option", { value: x.nombre }))));
        })(),
        ajustes.idiomaIA === "novela" ? "La IA escribe esta novela en este idioma." : "Ahora mismo la IA usa el idioma fijado en Ajustes → Inteligencia artificial.",
      ),
      campo("Objetivo de palabras", objetivo),
    ),
    campo("Sinopsis", area("sinopsis", 4, "De qué trata la novela. La IA la usa como contexto."), "Se incluye en los prompts del Codex y del chat."),
    campo(
      "Guía de estilo para la IA",
      area("estilo", 4, "Voz, tiempo verbal, punto de vista, influencias, cosas a evitar…"),
      "Se añade al prompt de sistema de toda la prosa generada.",
    ),
  );
  m.footer.append(btn("Listo", { variant: "primary", onclick: () => m.close() }));
  m.el.addEventListener("focusout", () => actualizarGuiaAgente());
}
