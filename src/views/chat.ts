// Vista Chat: conversaciones con la IA con el contexto de la novela
// (esquema, Codex, escena o capítulo actual, notas) elegido por el usuario.

import { nuevoId } from "../api";
import { ajustes, instruccionEvitar, instruccionIdioma } from "../ajustes";
import { chipModelo } from "../componentes";
import { bloqueMaestro, contextoCodex, esquema, instruccionModo, MODOS_CHAT, promptActivo, renderizar, variablesBase } from "../contexto";
import { borrarChat, estado, guardarChat, guardarNota, guardarTexto, novela } from "../estado";
import { generar, type Generacion } from "../ia";
import { markdown } from "../markdown";
import { buscarEscena, type Chat, type MensajeChat } from "../modelo";
import { type ResultadoVista } from "../shell";
import { btn, confirmar, conMenu, errMsg, fechaCorta, h, icon, menu, pedirTexto, spinner, toast, vacio, type ItemMenu } from "../ui";

const enCurso = new Map<string, { gen: Generacion; texto: string; repintar: () => void }>();

function chatNuevo(): Chat {
  const ahora = Date.now();
  return {
    id: nuevoId("h"),
    titulo: "Nueva conversación",
    modelo: "",
    contexto: { esquema: true, codex: "fijadas", escena: true, capitulo: false, notas: false },
    mensajes: [],
    creado: ahora,
    modificado: ahora,
  };
}

export function vistaChat(): ResultadoVista {
  const n = novela();
  const lista = h("div", { class: "list" });
  const principal = h("div", { class: "chat" });
  let pintarHilo: (() => void) | null = null;

  const pintarLista = () => {
    const chats = [...n.chats.values()].sort((a, b) => b.modificado - a.modificado);
    lista.replaceChildren(
      ...(chats.length
        ? chats.map((c) =>
            conMenu(
              h(
                "button",
                { type: "button", class: `list-row${c.id === estado.chatActual ? " is-active" : ""}`, onclick: () => abrir(c.id) },
                enCurso.has(c.id) ? spinner() : icon("chat"),
                h("span", { class: "list-text" }, c.titulo),
                h("span", { class: "list-meta" }, fechaCorta(c.modificado)),
              ),
              () => accionesChat(c, () => abrir(c.id)),
            ),
          )
        : [h("p", { class: "panel-empty" }, "Sin conversaciones.")]),
    );
  };

  const abrir = (id: string) => {
    estado.chatActual = id;
    pintarLista();
    pintar();
  };

  const nuevo = () => {
    const c = chatNuevo();
    guardarChat(c);
    abrir(c.id);
    requestAnimationFrame(() => principal.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
  };

  const pintar = () => {
    const c = n.chats.get(estado.chatActual);
    if (!c) {
      pintarHilo = null;
      principal.replaceChildren(
        h(
          "div",
          { class: "page" },
          vacio(
            "Habla con tu novela",
            "Lluvia de ideas, dudas de trama, preguntas sobre personajes, críticas de un capítulo… El chat recibe el contexto que elijas: esquema, Codex, escena o capítulo actual y notas.",
            btn("Nueva conversación", { icon: "plus", variant: "primary", onclick: nuevo }),
          ),
        ),
      );
      return;
    }
    const r = hilo(c, pintarLista);
    pintarHilo = r.repintar;
    principal.replaceChildren(r.el);
  };

  pintarLista();
  pintar();

  return {
    titulo: "Chat",
    principal,
    lateral: h(
      "div",
      { class: "sb-section" },
      h("div", { class: "sb-section-head" }, h("span", null, "Conversaciones"), btn(null, { icon: "plus", variant: "ghost", size: "icon-xs", title: "Nueva conversación", onclick: nuevo })),
      lista,
    ),
    acciones: [btn("Nueva", { icon: "plus", variant: "secondary", size: "sm", onclick: nuevo })],
    alCambiar: (c) => {
      if (c === "recarga") return false;
      if (c === "chats") {
        pintarLista();
        if (!n.chats.has(estado.chatActual)) pintar();
        else pintarHilo?.();
      }
      return true;
    },
  };
}

function construirContexto(c: Chat): string {
  const n = novela();
  const partes: string[] = [];
  const u = buscarEscena(n.meta, estado.escenaActual);
  if (n.meta.sinopsis) partes.push(`<sinopsis>\n${n.meta.sinopsis}\n</sinopsis>`);
  if (c.contexto.esquema) partes.push(`<esquema>\n${esquema(n)}\n</esquema>`);
  if (c.contexto.codex !== "ninguna") {
    const textos = c.mensajes.slice(-6).map((m) => m.texto);
    if (u && c.contexto.escena) textos.push(n.textos.get(u.escena.id) ?? "");
    const cx = contextoCodex(n, textos, c.contexto.codex === "todas" ? "todas" : "auto", u?.escena.id);
    if (cx) partes.push(`<codex>\n${cx}\n</codex>`);
  }
  if (u && c.contexto.capitulo) {
    const texto = u.capitulo.escenas.map((e) => `### ${e.titulo}\n\n${n.textos.get(e.id) ?? ""}`).join("\n\n");
    partes.push(`<capitulo_actual titulo="${u.capitulo.titulo}">\n${texto}\n</capitulo_actual>`);
  } else if (u && c.contexto.escena) {
    partes.push(`<escena_actual titulo="${u.escena.titulo}">\nResumen: ${u.escena.resumen}\n\n${n.textos.get(u.escena.id) ?? ""}\n</escena_actual>`);
  }
  if (c.contexto.notas) {
    const notas = [...n.notas.values()].filter((x) => x.fijada || n.notas.size <= 8);
    if (notas.length) partes.push(`<notas>\n${notas.map((x) => `## ${x.titulo}\n${x.cuerpo}`).join("\n\n")}\n</notas>`);
  }
  return partes.join("\n\n");
}

function hilo(c: Chat, alCambiarLista: () => void): { el: HTMLElement; repintar: () => void } {
  const n = novela();
  const mensajes = h("div", { class: "thread" });
  const scroller = h("div", { class: "thread-scroll" }, mensajes);
  const entrada = h("textarea", { class: "composer-input", rows: 1, placeholder: "Pregunta, pide ideas o críticas… (Intro envía, ⇧Intro salto de línea)" });
  const enviarBtn = h("button", { type: "button", class: "send", attrs: { "aria-label": "Enviar" } }, icon("send"));

  const titulo = h("input", { class: "thread-title", value: c.titulo });
  titulo.addEventListener("change", () => {
    c.titulo = titulo.value.trim() || "Conversación";
    guardarChat(c);
  });

  const repintar = () => {
    const abajo = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    mensajes.replaceChildren(
      ...(c.mensajes.length ? c.mensajes.map((m, i) => burbuja(c, m, i)) : [sugerencias((t) => ((entrada.value = t), enviar()))]),
    );
    const vivo = enCurso.get(c.id);
    if (vivo) {
      const md = vivo.texto ? markdown(vivo.texto, "md") : h("div", { class: "md" }, spinner());
      mensajes.append(h("div", { class: "msg msg-ai is-live" }, md));
    }
    enviarBtn.replaceChildren(icon(vivo ? "stop" : "send"));
    enviarBtn.classList.toggle("is-stop", !!vivo);
    if (abajo) scroller.scrollTop = scroller.scrollHeight;
  };

  const enviar = async (regenerar = false) => {
    const vivo = enCurso.get(c.id);
    if (vivo) {
      vivo.gen.cancelar();
      return;
    }
    const texto = entrada.value.trim();
    if (!regenerar) {
      if (!texto) return;
      c.mensajes.push({ id: nuevoId("m"), rol: "usuario", texto, fecha: Date.now() });
      if (c.mensajes.length === 1) c.titulo = texto.slice(0, 48) + (texto.length > 48 ? "…" : "");
      titulo.value = c.titulo;
      entrada.value = "";
      entrada.style.height = "";
      guardarChat(c, false);
    }
    const p = promptActivo(n, "chat");
    const vars = { ...variablesBase(n, estado.escenaActual), contexto: construirContexto(c) };
    const sistema = [renderizar(p.sistema, vars), bloqueMaestro(n, "chat", p.sistema), instruccionEvitar(), instruccionIdioma(n.meta.idioma), renderizar(p.usuario, vars), instruccionModo(c.modo)].filter(Boolean).join("\n\n").trim();
    const modelo = c.modelo || p.modelo || ajustes.modelos.chat;
    const estadoVivo = { gen: null as unknown as Generacion, texto: "", repintar };
    const gen = generar({
      modelo,
      sistema,
      mensajes: c.mensajes.filter((m) => !m.error).map((m) => ({ rol: m.rol, texto: m.texto })),
      onTexto: (_d, total) => {
        estadoVivo.texto = total;
        estadoVivo.repintar();
      },
    });
    estadoVivo.gen = gen;
    enCurso.set(c.id, estadoVivo);
    alCambiarLista();
    repintar();
    scroller.scrollTop = scroller.scrollHeight;
    try {
      const t = await gen.promesa;
      if (t.trim()) c.mensajes.push({ id: nuevoId("m"), rol: "asistente", texto: t.trim(), modelo, fecha: Date.now() });
    } catch (e) {
      c.mensajes.push({ id: nuevoId("m"), rol: "asistente", texto: errMsg(e), modelo, fecha: Date.now(), error: true });
    } finally {
      enCurso.delete(c.id);
      guardarChat(c);
    }
  };

  entrada.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void enviar();
    }
  });
  entrada.addEventListener("input", () => {
    entrada.style.height = "auto";
    entrada.style.height = `${Math.min(220, entrada.scrollHeight)}px`;
  });
  enviarBtn.addEventListener("click", () => void enviar());

  const toggle = (texto: string, valor: () => boolean, cambiar: () => void) => {
    const b = h("button", { type: "button", class: `ctx-toggle${valor() ? " is-on" : ""}` }, texto);
    b.addEventListener("click", () => {
      cambiar();
      b.classList.toggle("is-on", valor());
      guardarChat(c, false);
    });
    return b;
  };
  const codexBtn = h("button", { type: "button", class: `ctx-toggle${c.contexto.codex !== "ninguna" ? " is-on" : ""}` });
  const pintarCodexBtn = () => {
    codexBtn.textContent = { fijadas: "Codex: relevante", todas: "Codex: completo", ninguna: "Codex: no" }[c.contexto.codex];
    codexBtn.classList.toggle("is-on", c.contexto.codex !== "ninguna");
  };
  pintarCodexBtn();
  codexBtn.addEventListener("click", () =>
    menu(
      [
        { texto: "Relevante (fijadas + mencionadas)", icono: c.contexto.codex === "fijadas" ? "check" : undefined, accion: () => ((c.contexto.codex = "fijadas"), pintarCodexBtn(), guardarChat(c, false)) },
        { texto: "Completo", icono: c.contexto.codex === "todas" ? "check" : undefined, accion: () => ((c.contexto.codex = "todas"), pintarCodexBtn(), guardarChat(c, false)) },
        { texto: "Ninguno", icono: c.contexto.codex === "ninguna" ? "check" : undefined, accion: () => ((c.contexto.codex = "ninguna"), pintarCodexBtn(), guardarChat(c, false)) },
      ],
      codexBtn,
    ),
  );

  const modoBtn = h("button", { type: "button", class: "ctx-toggle ctx-mode" });
  const pintarModo = () => {
    const m = MODOS_CHAT.find((x) => x.valor === (c.modo ?? "auto"))!;
    modoBtn.textContent = `Modo: ${m.texto}`;
    modoBtn.classList.toggle("is-on", m.valor !== "auto");
    modoBtn.dataset.tip = m.desc;
  };
  pintarModo();
  modoBtn.addEventListener("click", () =>
    menu(
      MODOS_CHAT.map((m) => ({
        texto: `${m.texto} — ${m.desc}`,
        icono: (c.modo ?? "auto") === m.valor ? ("check" as const) : undefined,
        accion: () => ((c.modo = m.valor), pintarModo(), guardarChat(c, false)),
      })),
      modoBtn,
    ),
  );

  const u = buscarEscena(n.meta, estado.escenaActual);
  const composer = h(
    "div",
    { class: "composer chat-composer" },
    entrada,
    h(
      "div",
      { class: "composer-row" },
      chipModelo(() => c.modelo || ajustes.modelos.chat, (r) => ((c.modelo = r), guardarChat(c, false))),
      modoBtn,
      h("span", { class: "composer-sep" }),
      toggle("Esquema", () => c.contexto.esquema, () => (c.contexto.esquema = !c.contexto.esquema)),
      codexBtn,
      toggle(u ? `Escena: ${u.escena.titulo.slice(0, 18)}` : "Escena", () => c.contexto.escena, () => (c.contexto.escena = !c.contexto.escena)),
      toggle("Capítulo", () => c.contexto.capitulo, () => (c.contexto.capitulo = !c.contexto.capitulo)),
      toggle("Notas", () => c.contexto.notas, () => (c.contexto.notas = !c.contexto.notas)),
      h("span", { class: "grow" }),
      enviarBtn,
    ),
  );

  const el = h(
    "div",
    { class: "chat-main" },
    h(
      "header",
      { class: "thread-head" },
      titulo,
      btn(null, {
        icon: "more",
        variant: "ghost",
        size: "icon-sm",
        title: "Acciones",
        onclick: (ev) =>
          menu(
            [
              ...accionesChat(c).map((it) =>
                "texto" in it && it.texto === "Renombrar"
                  ? { ...it, accion: async () => {
                      await it.accion();
                      titulo.value = c.titulo;
                    } }
                  : it,
              ),
            ],
            ev.currentTarget as HTMLElement,
          ),
      }),
    ),
    scroller,
    h("div", { class: "composer-dock" }, composer),
  );

  // Botones de cada mensaje (delegados).
  mensajes.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-accion]");
    if (!b) return;
    const m = c.mensajes.find((x) => x.id === b.dataset.id);
    if (!m) return;
    const accion = b.dataset.accion;
    if (accion === "copiar") void navigator.clipboard.writeText(m.texto).then(() => toast("Copiado", "ok"));
    else if (accion === "nota") {
      guardarNota({ id: nuevoId("n"), titulo: m.texto.split("\n")[0].replace(/^#+\s*/, "").slice(0, 60) || "Desde el chat", fijada: false, cuerpo: m.texto, modificado: Date.now() });
      toast("Guardado en Notas", "ok");
    } else if (accion === "insertar") {
      const id = estado.escenaActual;
      if (!id) return toast("No hay escena actual.", "error");
      const actual = n.textos.get(id) ?? "";
      guardarTexto(id, `${actual.trimEnd()}${actual.trim() ? "\n\n" : ""}${m.texto.trim()}\n`);
      toast(`Añadido al final de «${buscarEscena(n.meta, id)?.escena.titulo}»`, "ok");
    } else if (accion === "regenerar") {
      const i = c.mensajes.indexOf(m);
      c.mensajes.splice(i, 1);
      void enviar(true);
    } else if (accion === "borrar") {
      c.mensajes.splice(c.mensajes.indexOf(m), 1);
      guardarChat(c);
    }
  });

  // Si había una respuesta en curso (se cambió de vista), seguir pintándola aquí.
  const vivo = enCurso.get(c.id);
  if (vivo) vivo.repintar = repintar;
  repintar();
  requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
  return { el, repintar };
}

/** Menú contextual de un mensaje: las mismas acciones que sus botones (y copiar la selección). */
function conAcciones(el: HTMLElement): HTMLElement {
  const iconos: Record<string, Parameters<typeof icon>[0]> = { copiar: "copy", insertar: "write", nota: "note", regenerar: "refresh", borrar: "trash" };
  return conMenu(el, () => {
    const sel = window.getSelection()?.toString().trim() ?? "";
    const botones = [...el.querySelectorAll<HTMLButtonElement>(".msg-act")];
    return [
      ...(sel ? [{ texto: "Copiar selección", icono: "copy" as const, accion: () => void navigator.clipboard.writeText(sel) }, { separador: true as const }] : []),
      ...botones.map((b) => ({
        texto: b.getAttribute("data-tip") ?? "",
        icono: iconos[b.dataset.accion ?? ""] ?? ("dot" as const),
        peligro: b.dataset.accion === "borrar",
        accion: () => b.click(),
      })),
    ];
  });
}

function burbuja(c: Chat, m: MensajeChat, i: number): HTMLElement {
  const accion = (a: string, ic: Parameters<typeof icon>[0], tip: string) =>
    h("button", { type: "button", class: "msg-act", dataset: { accion: a, id: m.id }, attrs: { "aria-label": tip, "data-tip": tip } }, icon(ic));
  if (m.rol === "usuario")
    return conAcciones(h("div", { class: "msg msg-user" }, h("div", { class: "bubble", attrs: { translate: "no" } }, m.texto), h("div", { class: "msg-actions" }, accion("copiar", "copy", "Copiar"), accion("borrar", "trash", "Borrar"))));
  const ultimo = i === c.mensajes.length - 1;
  return conAcciones(h(
    "div",
    { class: `msg msg-ai${m.error ? " is-error" : ""}` },
    m.error ? h("div", { class: "prop-error" }, icon("alert"), h("span", null, m.texto)) : markdown(m.texto, "md"),
    h(
      "div",
      { class: "msg-actions" },
      accion("copiar", "copy", "Copiar"),
      m.error ? null : accion("insertar", "write", "Añadir a la escena actual"),
      m.error ? null : accion("nota", "note", "Guardar como nota"),
      ultimo ? accion("regenerar", "refresh", "Regenerar") : null,
      accion("borrar", "trash", "Borrar"),
      m.modelo ? h("span", { class: "msg-model" }, m.modelo.split("::")[1] ?? "") : null,
    ),
  ));
}

function sugerencias(usar: (t: string) => void): HTMLElement {
  const ideas = [
    "¿Qué agujeros de trama ves en el esquema actual?",
    "Dame 5 ideas para complicar la escena actual",
    "¿Cómo hablaría este personaje? Escribe un monólogo breve",
    "Critica la escena actual como lo haría un editor",
  ];
  return h(
    "div",
    { class: "suggest" },
    h("p", { class: "suggest-title" }, "Empieza con algo como…"),
    ...ideas.map((t) => h("button", { type: "button", class: "suggest-item", onclick: () => usar(t) }, icon("sparkle"), t)),
  );
}

/** Acciones de una conversación (menú contextual de la lista y botón «…»). */
function accionesChat(c: Chat, abrir?: () => void): ItemMenu[] {
  return [
    ...(abrir ? [{ texto: "Abrir", icono: "chat" as const, accion: abrir }] : []),
    { texto: "Renombrar", icono: "edit", accion: async () => {
      const t = await pedirTexto("Renombrar conversación", "Título", c.titulo);
      if (t) {
        c.titulo = t;
        guardarChat(c);
      }
    } },
    { texto: "Exportar como nota", icono: "note", accion: () => {
      guardarNota({ id: nuevoId("n"), titulo: c.titulo, fijada: false, modificado: Date.now(), cuerpo: c.mensajes.map((m) => `**${m.rol === "usuario" ? "Tú" : "IA"}:** ${m.texto}`).join("\n\n") });
      toast("Guardada en Notas", "ok");
    } },
    { separador: true },
    { texto: "Eliminar conversación", icono: "trash", peligro: true, accion: async () => {
      if (!(await confirmar("Eliminar conversación", `Se eliminará «${c.titulo}».`))) return;
      enCurso.get(c.id)?.gen.cancelar();
      if (estado.chatActual === c.id) estado.chatActual = "";
      await borrarChat(c.id);
    } },
  ];
}
