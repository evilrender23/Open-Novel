// Vista Notas: apuntes libres de la novela (investigación, ideas, fragmentos).

import { nuevoId } from "../api";
import { borrarNota, estado, guardarNota, novela } from "../estado";
import { markdown } from "../markdown";
import type { Nota } from "../modelo";
import { type ResultadoVista } from "../shell";
import { btn, confirmar, conMenu, fechaCorta, h, icon, menu, vacio, type ItemMenu } from "../ui";

let previa = false;

export function vistaNotas(): ResultadoVista {
  const n = novela();
  const lista = h("div", { class: "list" });
  const principal = h("div", { class: "notes" });
  const filtroInput = h("input", { class: "input input-sm sb-filter", placeholder: "Buscar en notas…" });
  filtroInput.addEventListener("input", () => pintarLista());

  const pintarLista = () => {
    const f = filtroInput.value.trim().toLocaleLowerCase();
    const notas = [...n.notas.values()]
      .filter((x) => !f || x.titulo.toLocaleLowerCase().includes(f) || x.cuerpo.toLocaleLowerCase().includes(f))
      .sort((a, b) => Number(b.fijada) - Number(a.fijada) || b.modificado - a.modificado);
    lista.replaceChildren(
      ...(notas.length
        ? notas.map((x) =>
            conMenu(
              h(
                "button",
                { type: "button", class: `list-row list-row-2${x.id === estado.notaActual ? " is-active" : ""}`, onclick: () => abrir(x.id) },
                icon(x.fijada ? "pin" : "note"),
                h("span", { class: "list-stack" }, h("span", { class: "list-text" }, x.titulo || "Sin título"), h("span", { class: "list-sub" }, x.cuerpo.replace(/\s+/g, " ").slice(0, 60) || "Vacía")),
                h("span", { class: "list-meta" }, fechaCorta(x.modificado)),
              ),
              () => accionesNota(x),
            ),
          )
        : [h("p", { class: "panel-empty" }, f ? "Sin resultados." : "Sin notas.")]),
    );
  };

  const abrir = (id: string) => {
    estado.notaActual = id;
    pintarLista();
    pintar();
  };

  const accionesNota = (x: Nota): ItemMenu[] => [
    { texto: "Abrir", icono: "note", accion: () => abrir(x.id) },
    { texto: x.fijada ? "Desfijar" : "Fijar arriba", icono: "pin", accion: () => {
      x.fijada = !x.fijada;
      guardarNota(x);
      pintarLista();
    } },
    { texto: "Duplicar", icono: "duplicate", accion: () => {
      const copia: Nota = { ...x, id: nuevoId("n"), titulo: `${x.titulo || "Sin título"} (copia)`, fijada: false, modificado: Date.now() };
      guardarNota(copia);
      abrir(copia.id);
    } },
    { texto: "Copiar el texto", icono: "copy", accion: () => void navigator.clipboard.writeText(x.cuerpo) },
    { separador: true },
    { texto: "Eliminar nota", icono: "trash", peligro: true, accion: async () => {
      if (!(await confirmar("Eliminar nota", `Se eliminará «${x.titulo || "Sin título"}».`))) return;
      if (estado.notaActual === x.id) estado.notaActual = "";
      await borrarNota(x.id);
      pintarLista();
      pintar();
    } },
  ];

  const nueva = () => {
    const nota: Nota = { id: nuevoId("n"), titulo: "", fijada: false, cuerpo: "", modificado: Date.now() };
    guardarNota(nota);
    abrir(nota.id);
    requestAnimationFrame(() => principal.querySelector<HTMLInputElement>(".note-title")?.focus());
  };

  const pintar = () => {
    const nota = n.notas.get(estado.notaActual);
    if (!nota) {
      principal.replaceChildren(
        h("div", { class: "page" }, vacio("Notas de la novela", "Investigación, ideas sueltas, fragmentos descartados… Puedes incluirlas en el contexto del chat.", btn("Nueva nota", { icon: "plus", variant: "primary", onclick: nueva }))),
      );
      return;
    }
    const titulo = h("input", { class: "note-title", value: nota.titulo, placeholder: "Título" });
    titulo.addEventListener("input", () => {
      nota.titulo = titulo.value;
      guardarNota(nota, false);
      pintarLista();
    });
    const cuerpo = h("textarea", { class: "note-body", placeholder: "Escribe en Markdown…" });
    cuerpo.value = nota.cuerpo;
    cuerpo.addEventListener("input", () => {
      nota.cuerpo = cuerpo.value;
      guardarNota(nota, false);
    });
    cuerpo.addEventListener("change", () => pintarLista());
    const contenido = previa ? h("div", { class: "note-preview" }, markdown(nota.cuerpo || "*Vacía*")) : cuerpo;
    principal.replaceChildren(
      h(
        "div",
        { class: "page note-page" },
        h(
          "header",
          { class: "note-head" },
          titulo,
          btn(null, {
            icon: "pin",
            variant: "ghost",
            size: "icon-sm",
            title: nota.fijada ? "Desfijar" : "Fijar",
            class: nota.fijada ? "is-on" : "",
            onclick: () => {
              nota.fijada = !nota.fijada;
              guardarNota(nota);
              pintar();
            },
          }),
          btn(null, { icon: "eye", variant: "ghost", size: "icon-sm", title: previa ? "Editar" : "Vista previa", class: previa ? "is-on" : "", onclick: () => ((previa = !previa), pintar()) }),
          btn(null, {
            icon: "more",
            variant: "ghost",
            size: "icon-sm",
            title: "Acciones",
            onclick: (ev) =>
              menu(
                [
                  { texto: "Copiar", icono: "copy", accion: () => void navigator.clipboard.writeText(nota.cuerpo) },
                  { separador: true },
                  { texto: "Eliminar nota", icono: "trash", peligro: true, accion: async () => {
                    if (!(await confirmar("Eliminar nota", `Se eliminará «${nota.titulo || "Sin título"}».`))) return;
                    estado.notaActual = "";
                    await borrarNota(nota.id);
                  } },
                ],
                ev.currentTarget as HTMLElement,
              ),
          }),
        ),
        contenido,
      ),
    );
  };

  pintarLista();
  pintar();

  return {
    titulo: "Notas",
    principal,
    lateral: h(
      "div",
      { class: "sb-section" },
      h("div", { class: "sb-section-head" }, h("span", null, "Notas"), btn(null, { icon: "plus", variant: "ghost", size: "icon-xs", title: "Nueva nota", onclick: nueva })),
      filtroInput,
      lista,
    ),
    acciones: [btn("Nueva nota", { icon: "plus", variant: "secondary", size: "sm", onclick: nueva })],
    alCambiar: (c) => {
      if (c === "recarga") return false;
      if (c === "notas") {
        pintarLista();
        if (!n.notas.has(estado.notaActual)) pintar();
      }
      return true;
    },
  };
}
