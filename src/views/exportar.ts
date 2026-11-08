// Vista Exportar: manuscrito en Markdown, texto, HTML imprimible y EPUB 3,
// además de una copia completa del proyecto.

import { save } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import { api } from "../api";
import { aCopia, aEpub, aHtml, aMarkdown, aTexto, OPCIONES_DEFECTO, type OpcionesExportar } from "../exportar";
import { novela, vaciarGuardado } from "../estado";
import { contarPalabras, palabrasNovela, todasLasEscenas } from "../modelo";
import { type ResultadoVista } from "../shell";
import { errMsg, h, icon, num, toast, type IconName } from "../ui";

const opciones: OpcionesExportar = { ...OPCIONES_DEFECTO, ...JSON.parse(localStorage.getItem("exportar") ?? "{}") };

export function vistaExportar(): ResultadoVista {
  const n = novela();
  const guardarOpciones = () => localStorage.setItem("exportar", JSON.stringify(opciones));

  const casilla = (k: "titulosActos" | "titulosCapitulos" | "titulosEscenas" | "soloFinal", texto: string) => {
    const c = h("input", { type: "checkbox", checked: opciones[k] });
    c.addEventListener("change", () => ((opciones[k] = c.checked), guardarOpciones()));
    return h("label", { class: "check" }, c, h("span", null, texto));
  };
  const separador = h("input", { class: "input input-sm", value: opciones.separador, placeholder: "* * *" });
  separador.addEventListener("input", () => ((opciones.separador = separador.value), guardarOpciones()));

  const base = n.meta.titulo.replace(/[\\/:*?"<>|]/g, "").trim() || "novela";

  const exportar = async (ext: string, nombre: string, generar: () => string | Uint8Array, abrir = false) => {
    try {
      await vaciarGuardado();
      const ruta = await save({ defaultPath: `${base}.${ext}`, filters: [{ name: nombre, extensions: [ext] }] });
      if (!ruta) return;
      const datos = generar();
      if (typeof datos === "string") await api.exportarTexto(ruta, datos);
      else await api.exportarBinario(ruta, Array.from(datos));
      toast(`Exportado: ${ruta.replace(/^.*\//, "")}`, "ok");
      if (abrir) await openPath(ruta);
      else await revealItemInDir(ruta);
    } catch (e) {
      toast(`No se pudo exportar: ${errMsg(e)}`, "error");
    }
  };

  const tarjeta = (ic: IconName, titulo: string, desc: string, accion: () => void) =>
    h("button", { type: "button", class: "export-card", onclick: accion }, h("span", { class: "export-icon" }, icon(ic)), h("span", { class: "export-title" }, titulo), h("span", { class: "export-desc" }, desc));

  const escenas = todasLasEscenas(n.meta);
  const conTexto = escenas.filter((u) => contarPalabras(n.textos.get(u.escena.id) ?? "") > 0).length;

  const principal = h(
    "div",
    { class: "page export" },
    h("h1", { class: "page-title" }, "Exportar"),
    h("p", { class: "page-sub" }, `${num(palabrasNovela(n))} palabras · ${conTexto} de ${escenas.length} escenas con texto`),
    h(
      "div",
      { class: "export-grid" },
      tarjeta("book", "EPUB", "Libro electrónico EPUB 3 con índice, listo para lectores.", () => void exportar("epub", "EPUB", () => aEpub(n, opciones))),
      tarjeta("file", "HTML imprimible", "Ábrelo en el navegador e imprime como PDF con formato de manuscrito.", () => void exportar("html", "HTML", () => aHtml(n, opciones), true)),
      tarjeta("write", "Markdown", "Texto con formato ligero; ideal para Pandoc, Word o Google Docs.", () => void exportar("md", "Markdown", () => aMarkdown(n, opciones))),
      tarjeta("note", "Texto plano", "Sin formato, una línea en blanco entre párrafos.", () => void exportar("txt", "Texto", () => aTexto(n, opciones))),
      tarjeta("duplicate", "Copia de seguridad", "Todo el proyecto (manuscrito, Codex, notas, prompts y chats) en un archivo .opennovel.", () => void exportar("opennovel", "Open Novel", () => aCopia(n))),
      tarjeta("folder", "Carpeta del proyecto", "Los archivos originales en Markdown. Puedes versionarlos con Git.", () => void openPath(n.ruta)),
    ),
    h(
      "section",
      { class: "panel-sec export-opts" },
      h("div", { class: "panel-head" }, h("span", null, "Opciones del manuscrito")),
      casilla("titulosActos", "Incluir títulos de los actos"),
      casilla("titulosCapitulos", "Incluir títulos de los capítulos"),
      casilla("titulosEscenas", "Incluir títulos de las escenas"),
      casilla("soloFinal", "Solo escenas en estado «Final»"),
      h("label", { class: "field field-inline" }, h("span", { class: "field-label" }, "Separador entre escenas"), separador),
    ),
  );

  return { titulo: "Exportar", principal };
}
