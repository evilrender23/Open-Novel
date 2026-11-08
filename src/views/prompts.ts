// Vista Prompts: biblioteca de prompts integrados y personalizados con
// plantillas {{variables}}, prompt activo por acción y vista previa.

import { nuevoId } from "../api";
import { chipModelo } from "../componentes";
import { conCodex, PROMPTS_INTEGRADOS, renderizar, todosLosPrompts, VARIABLES_DOC, variablesBase, ultimasPalabras } from "../contexto";
import { borrarPrompt, estado, guardarMeta, guardarPrompt, novela } from "../estado";
import type { AccionPrompt, Prompt } from "../modelo";
import { type ResultadoVista } from "../shell";
import { btn, confirmar, conMenu, h, icon, modal, select, toast } from "../ui";

export const ACCIONES: { valor: AccionPrompt; texto: string }[] = [
  { valor: "beat", texto: "Beat de escena" },
  { valor: "continuar", texto: "Continuar" },
  { valor: "reescribir", texto: "Reescribir" },
  { valor: "expandir", texto: "Expandir" },
  { valor: "acortar", texto: "Acortar" },
  { valor: "describir", texto: "Mostrar, no contar" },
  { valor: "resumir", texto: "Resumir escena" },
  { valor: "codex", texto: "Codex" },
  { valor: "chat", texto: "Chat (sistema)" },
  { valor: "general", texto: "General" },
];

let actual = "int-beat";

export function vistaPrompts(): ResultadoVista {
  const n = novela();
  const lista = h("div", { class: "list" });
  const principal = h("div", { class: "prompts" });

  const activo = (p: Prompt) => (n.meta.promptsActivos[p.accion] ?? PROMPTS_INTEGRADOS.find((x) => x.accion === p.accion)?.id) === p.id;

  const pintarLista = () => {
    const nodos: Node[] = [];
    for (const a of ACCIONES) {
      const grupo = todosLosPrompts(n).filter((p) => p.accion === a.valor);
      if (!grupo.length) continue;
      nodos.push(h("div", { class: "list-group" }, a.texto));
      for (const p of grupo)
        nodos.push(
          conMenu(
            h(
              "button",
              { type: "button", class: `list-row${p.id === actual ? " is-active" : ""}`, onclick: () => ((actual = p.id), pintarLista(), pintar()) },
              icon(p.integrado ? "prompt" : "edit"),
              h("span", { class: "list-text" }, p.nombre),
              activo(p) ? h("span", { class: "badge is-accent" }, "activo") : null,
            ),
            () => [
              { texto: "Abrir", icono: "prompt", accion: () => ((actual = p.id), pintarLista(), pintar()) },
              { texto: "Usar para esta acción", icono: "check", deshabilitado: activo(p), accion: () => {
                n.meta.promptsActivos[p.accion] = p.id;
                guardarMeta("prompts");
                pintarLista();
                pintar();
              } },
              { texto: "Duplicar", icono: "duplicate", accion: () => nuevo(p) },
              ...(p.integrado
                ? []
                : [
                    { separador: true as const },
                    { texto: "Eliminar prompt", icono: "trash" as const, peligro: true, accion: async () => {
                      if (!(await confirmar("Eliminar prompt", `Se eliminará «${p.nombre}».`))) return;
                      if (n.meta.promptsActivos[p.accion] === p.id) {
                        delete n.meta.promptsActivos[p.accion];
                        guardarMeta("prompts");
                      }
                      await borrarPrompt(p.id);
                      if (actual === p.id) actual = "int-beat";
                      pintarLista();
                      pintar();
                    } },
                  ]),
            ],
          ),
        );
    }
    lista.replaceChildren(...nodos);
  };

  const nuevo = (base?: Prompt) => {
    const p: Prompt = base
      ? { ...structuredClone(base), id: nuevoId("p"), nombre: `${base.nombre} (copia)`, integrado: undefined }
      : { id: nuevoId("p"), nombre: "Prompt nuevo", accion: "general", descripcion: "", modelo: "", sistema: "Eres un asistente de escritura creativa que escribe en {{idioma}}.", usuario: "{{#si codex}}<codex>\n{{codex}}\n</codex>{{/si}}\n\n{{seleccion}}" };
    delete p.integrado;
    guardarPrompt(p);
    actual = p.id;
    pintarLista();
    pintar();
  };

  const pintar = () => {
    const p = todosLosPrompts(n).find((x) => x.id === actual) ?? PROMPTS_INTEGRADOS[0];
    const soloLectura = !!p.integrado;
    const nombre = h("input", { class: "cx-name", value: p.nombre, readOnly: soloLectura });
    nombre.addEventListener("input", () => ((p.nombre = nombre.value), guardarPrompt(p, false), pintarLista()));
    const descripcion = h("input", { class: "input", value: p.descripcion, readOnly: soloLectura, placeholder: "Para qué sirve" });
    descripcion.addEventListener("input", () => ((p.descripcion = descripcion.value), guardarPrompt(p, false)));
    const sistema = h("textarea", { class: "textarea mono", rows: 7, readOnly: soloLectura });
    sistema.value = p.sistema;
    sistema.addEventListener("input", () => ((p.sistema = sistema.value), guardarPrompt(p, false)));
    const usuario = h("textarea", { class: "textarea mono", rows: 16, readOnly: soloLectura });
    usuario.value = p.usuario;
    usuario.addEventListener("input", () => ((p.usuario = usuario.value), guardarPrompt(p, false)));
    const accion = select(ACCIONES, p.accion, (v) => ((p.accion = v), guardarPrompt(p, false), pintarLista()), "select");
    accion.disabled = soloLectura;

    const insertarVar = (v: string) => {
      if (soloLectura) return;
      const t = document.activeElement === sistema ? sistema : usuario;
      t.setRangeText(`{{${v}}}`, t.selectionStart, t.selectionEnd, "end");
      t.dispatchEvent(new Event("input"));
      t.focus();
    };

    principal.replaceChildren(
      h(
        "div",
        { class: "page prompt-page" },
        h(
          "header",
          { class: "cx-head" },
          h("span", { class: "ag-logo" }, icon("prompt")),
          h("div", { class: "cx-head-main" }, nombre, h("div", { class: "cx-head-meta" }, soloLectura ? h("span", { class: "badge is-muted" }, "integrado · solo lectura") : h("span", { class: "badge" }, "personalizado"), activo(p) ? h("span", { class: "badge is-accent" }, `activo para «${ACCIONES.find((a) => a.valor === p.accion)?.texto}»`) : null)),
          activo(p)
            ? null
            : btn("Usar para esta acción", {
                icon: "check",
                variant: "primary",
                size: "sm",
                onclick: () => {
                  n.meta.promptsActivos[p.accion] = p.id;
                  guardarMeta("prompts");
                  pintarLista();
                  pintar();
                  toast(`«${p.nombre}» se usará para ${ACCIONES.find((a) => a.valor === p.accion)?.texto}`, "ok");
                },
              }),
          btn("Duplicar", { icon: "duplicate", variant: "secondary", size: "sm", onclick: () => nuevo(p) }),
          btn("Vista previa", { icon: "eye", variant: "secondary", size: "sm", onclick: () => vistaPrevia(p) }),
          soloLectura
            ? null
            : btn(null, {
                icon: "trash",
                variant: "ghost",
                size: "icon-sm",
                title: "Eliminar prompt",
                onclick: async () => {
                  if (!(await confirmar("Eliminar prompt", `Se eliminará «${p.nombre}».`))) return;
                  if (n.meta.promptsActivos[p.accion] === p.id) {
                    delete n.meta.promptsActivos[p.accion];
                    guardarMeta("prompts");
                  }
                  await borrarPrompt(p.id);
                  actual = "int-beat";
                  pintarLista();
                  pintar();
                },
              }),
        ),
        h(
          "div",
          { class: "cx-cols" },
          h(
            "div",
            { class: "cx-main" },
            h("div", { class: "form-grid" }, h("label", { class: "field" }, h("span", { class: "field-label" }, "Acción"), accion), h("label", { class: "field" }, h("span", { class: "field-label" }, "Modelo"), chipModelo(() => p.modelo, (r) => {
              if (soloLectura) return toast("Duplica el prompt para cambiar su modelo.", "info");
              p.modelo = r;
              guardarPrompt(p, false);
            }, "El de la función"))),
            h("label", { class: "field" }, h("span", { class: "field-label" }, "Descripción"), descripcion),
            h("label", { class: "field" }, h("span", { class: "field-label" }, "Instrucciones de sistema"), sistema),
            h("label", { class: "field" }, h("span", { class: "field-label" }, "Mensaje (plantilla)"), usuario),
            soloLectura ? h("p", { class: "muted" }, "Los prompts integrados no se pueden editar. Duplica este para personalizarlo y márcalo como activo.") : null,
          ),
          h(
            "aside",
            { class: "cx-side" },
            h(
              "section",
              { class: "panel-sec" },
              h("div", { class: "panel-head" }, h("span", null, "Variables")),
              h("p", { class: "panel-empty" }, "Clic para insertar. ", h("code", null, "{{#si x}}…{{/si}}"), " omite el bloque si x está vacía."),
              h(
                "div",
                { class: "vars" },
                ...VARIABLES_DOC.map((v) => h("button", { type: "button", class: "var", onclick: () => insertarVar(v.nombre) }, h("code", null, `{{${v.nombre}}}`), h("span", null, v.desc))),
              ),
            ),
          ),
        ),
      ),
    );
  };

  pintarLista();
  pintar();

  return {
    titulo: "Prompts",
    principal,
    lateral: h(
      "div",
      { class: "sb-section" },
      h("div", { class: "sb-section-head" }, h("span", null, "Prompts"), btn(null, { icon: "plus", variant: "ghost", size: "icon-xs", title: "Nuevo prompt", onclick: () => nuevo() })),
      lista,
    ),
    acciones: [btn("Nuevo prompt", { icon: "plus", variant: "secondary", size: "sm", onclick: () => nuevo() })],
    alCambiar: (c) => {
      if (c === "recarga") return false;
      if (c === "prompts") pintarLista();
      return true;
    },
  };
}

function vistaPrevia(p: Prompt): void {
  const n = novela();
  const id = estado.escenaActual;
  const texto = n.textos.get(id) ?? "";
  const vars = conCodex(
    n,
    {
      ...variablesBase(n, id),
      texto_previo: ultimasPalabras(texto, 300),
      beat: "(tu beat aparecerá aquí)",
      seleccion: ultimasPalabras(texto, 80) || "(texto seleccionado)",
      palabras: "400",
      contexto: "(contexto elegido en el chat)",
      "entrada.nombre": "(entrada)",
      "entrada.descripcion": "(descripción)",
    },
    id,
  );
  const m = modal(`Vista previa · ${p.nombre}`, { wide: true, subtitle: "Con los datos de la escena actual" });
  m.body.append(
    h("div", { class: "field-label" }, "Sistema"),
    h("pre", { class: "ag-pre preview-pre" }, renderizar(p.sistema, vars)),
    h("div", { class: "field-label" }, "Mensaje"),
    h("pre", { class: "ag-pre preview-pre" }, renderizar(p.usuario, vars)),
  );
  m.footer.append(btn("Cerrar", { variant: "primary", onclick: () => m.close() }));
}
