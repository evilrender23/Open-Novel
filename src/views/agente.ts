// Vista Agente: Claude Code CLI trabajando directamente sobre los archivos de
// la novela (escenas, Codex, estructura). Muestra el razonamiento, las
// herramientas y sus resultados en vivo, reanuda sesiones con --resume y
// recarga la novela cuando el agente modifica archivos.

import { api, iniciarEventos, nuevoId, suscribir, type FinClaude } from "../api";
import { ajustes, guardarAjustes, idiomaEscritura, instruccionEvitar } from "../ajustes";
import { reglaPersonajes } from "../contexto";
import { borrarSesionAgente, estado, guardarSesionAgente, novela, recargarDesdeDisco, vaciarGuardado } from "../estado";
import { markdown } from "../markdown";
import { buscarEscena, todasLasEscenas, type ElementoAgente, type SesionAgente } from "../modelo";
import { indicarAgente, type ResultadoVista } from "../shell";
import { btn, confirmar, conMenu, errMsg, fechaCorta, h, icon, menu, pedirTexto, select, spinner, toast, type IconName } from "../ui";
import { openPath } from "@tauri-apps/plugin-opener";

// ── Estado de la ejecución (sobrevive a cambios de vista) ────────────────

interface Ejecucion {
  id: string;
  sesion: SesionAgente;
  texto: string;
  pensando: string;
  herramientaViva: string;
  inicio: number;
  antes: Map<string, string>; // textos de escenas al empezar (para instantáneas)
  respaldadas: Set<string>;
  repintar: () => void;
}

let ejecucion: Ejecucion | null = null;
let infoClaude: { ok: boolean; texto: string } | null = null;

const PERMISOS = [
  { valor: "acceptEdits", texto: "Editar archivos" },
  { valor: "plan", texto: "Solo planificar" },
  { valor: "auto", texto: "Automático" },
  { valor: "bypassPermissions", texto: "Sin restricciones" },
];
const MODELOS = [
  { valor: "sonnet", texto: "Sonnet" },
  { valor: "opus", texto: "Opus" },
  { valor: "haiku", texto: "Haiku" },
];
const ESFUERZOS = [
  { valor: "", texto: "Esfuerzo: auto" },
  { valor: "low", texto: "Esfuerzo: bajo" },
  { valor: "medium", texto: "Esfuerzo: medio" },
  { valor: "high", texto: "Esfuerzo: alto" },
  { valor: "max", texto: "Esfuerzo: máximo" },
];

const SUGERENCIAS = [
  "Lee el manuscrito y revisa la coherencia de la línea temporal y de los personajes. Dame un informe con problemas concretos y en qué escena están.",
  "Crea entradas de Codex para todos los personajes, lugares y objetos importantes que aparecen en el manuscrito y aún no tienen entrada.",
  "Escribe un primer borrador de la escena actual siguiendo su resumen y el estilo de las escenas anteriores.",
  "Escribe o actualiza el resumen de cada escena en novela.json a partir de su texto.",
  "Propón un esquema completo para el resto de la novela (capítulos y escenas con resumen) y añádelo a novela.json.",
];

export function agenteActivo(): boolean {
  return !!ejecucion;
}

function sesionNueva(): SesionAgente {
  const ahora = Date.now();
  return {
    id: nuevoId("s"),
    titulo: "Nueva sesión",
    sesionClaude: "",
    modelo: ajustes.agente.modelo,
    permisos: ajustes.agente.permisos,
    elementos: [],
    creado: ahora,
    modificado: ahora,
  };
}

async function comprobarClaude(): Promise<void> {
  try {
    const i = await api.claudeInfo(ajustes.claudeRuta);
    infoClaude = { ok: true, texto: i.version || i.ruta };
  } catch (e) {
    infoClaude = { ok: false, texto: errMsg(e) };
  }
}

export function vistaAgente(): ResultadoVista {
  const lista = h("div", { class: "list" });
  const principal = h("div", { class: "agent" });
  let repintarHilo: (() => void) | null = null;

  const sesion = () => novela().agente.get(estado.sesionAgente) ?? (ejecucion?.sesion.id === estado.sesionAgente ? ejecucion.sesion : undefined);

  const pintarLista = () => {
    const sesiones = [...novela().agente.values()].sort((a, b) => b.modificado - a.modificado);
    lista.replaceChildren(
      ...(sesiones.length
        ? sesiones.map((s) =>
            conMenu(
              h(
                "button",
                { type: "button", class: `list-row${s.id === estado.sesionAgente ? " is-active" : ""}`, onclick: () => abrir(s.id) },
                ejecucion?.sesion.id === s.id ? spinner() : icon("agent"),
                h("span", { class: "list-text" }, s.titulo),
                h("span", { class: "list-meta" }, fechaCorta(s.modificado)),
              ),
              () => [
                { texto: "Abrir", icono: "agent", accion: () => abrir(s.id) },
                { texto: "Renombrar", icono: "edit", accion: async () => {
                  const t = await pedirTexto("Renombrar sesión", "Título", s.titulo);
                  if (t?.trim()) {
                    s.titulo = t.trim();
                    guardarSesionAgente(s);
                    pintarLista();
                  }
                } },
                { texto: "Copiar id de sesión de Claude", icono: "copy", deshabilitado: !s.sesionClaude, accion: () => void navigator.clipboard.writeText(s.sesionClaude) },
                { separador: true },
                { texto: "Eliminar sesión", icono: "trash", peligro: true, deshabilitado: ejecucion?.sesion.id === s.id, accion: async () => {
                  if (!(await confirmar("Eliminar sesión", `Se eliminará el registro de «${s.titulo}».`))) return;
                  if (estado.sesionAgente === s.id) estado.sesionAgente = "";
                  await borrarSesionAgente(s.id);
                  pintarLista();
                  pintar();
                } },
              ],
            ),
          )
        : [h("p", { class: "panel-empty" }, "Sin sesiones.")]),
    );
  };

  const abrir = (id: string) => {
    estado.sesionAgente = id;
    pintarLista();
    pintar();
  };

  const nueva = () => {
    const s = sesionNueva();
    guardarSesionAgente(s);
    abrir(s.id);
    requestAnimationFrame(() => principal.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
  };

  const pintar = () => {
    let s = sesion();
    if (!s) {
      // Sin sesión seleccionada: una sesión en blanco (se guarda al enviar).
      s = sesionNueva();
      estado.sesionAgente = s.id;
    }
    const r = hilo(s, () => {
      pintarLista();
    });
    repintarHilo = r.repintar;
    principal.replaceChildren(r.el);
  };

  pintarLista();
  pintar();
  if (!infoClaude)
    void comprobarClaude().then(() => {
      if (principal.isConnected) pintar();
    });

  return {
    titulo: "Agente · Claude Code",
    principal,
    lateral: h(
      "div",
      { class: "sb-section" },
      h("div", { class: "sb-section-head" }, h("span", null, "Sesiones del agente"), btn(null, { icon: "plus", variant: "ghost", size: "icon-xs", title: "Nueva sesión", onclick: nueva })),
      lista,
    ),
    acciones: [
      btn(null, { icon: "folder", variant: "ghost", size: "icon-sm", title: "Abrir la carpeta de la novela", onclick: () => void openPath(novela().ruta) }),
      btn("Nueva sesión", { icon: "plus", variant: "secondary", size: "sm", onclick: nueva }),
    ],
    alCambiar: (c) => {
      // La recarga del disco la provoca el propio agente: no remontar la vista.
      if (c === "recarga" || c === "agente") {
        pintarLista();
        repintarHilo?.();
        return true;
      }
      return true;
    },
  };
}

function hilo(s: SesionAgente, alCambiarLista: () => void): { el: HTMLElement; repintar: () => void } {
  const elementos = h("div", { class: "thread agent-thread" });
  const scroller = h("div", { class: "thread-scroll" }, elementos);
  const entrada = h("textarea", { class: "composer-input", rows: 2, placeholder: "Pide algo al agente: revisar, escribir escenas, crear entradas del Codex, reorganizar capítulos…  (Intro envía)" });
  const enviarBtn = h("button", { type: "button", class: "send", attrs: { "aria-label": "Enviar" } }, icon("send"));
  const plegadas = new Set<string>();

  const tituloEl = h("span", { class: "thread-title-text" }, s.titulo);
  const repintar = () => {
    tituloEl.textContent = s.titulo;
    const abajo = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const nodos: Node[] = [];
    if (infoClaude && !infoClaude.ok) nodos.push(avisoInstalacion());
    if (!s.elementos.length && ejecucion?.sesion.id !== s.id) nodos.push(bienvenida((t) => ((entrada.value = t), entrada.focus())));
    for (const el of s.elementos) nodos.push(pintarElemento(el, plegadas, repintar));
    const viva = ejecucion?.sesion.id === s.id ? ejecucion : null;
    if (viva) {
      if (viva.pensando) nodos.push(h("div", { class: "ag-thinking is-live" }, icon("sparkle"), h("span", null, viva.pensando.slice(-400))));
      if (viva.texto) nodos.push(h("div", { class: "ag-text is-live" }, markdown(viva.texto)));
      nodos.push(
        h(
          "div",
          { class: "ag-activity" },
          spinner(),
          h("span", null, viva.herramientaViva ? `Usando ${nombreHerramienta(viva.herramientaViva).texto}…` : viva.texto ? "Escribiendo…" : "Pensando…"),
          h("span", { class: "muted" }, `${Math.round((Date.now() - viva.inicio) / 1000)} s`),
        ),
      );
    }
    elementos.replaceChildren(...nodos);
    enviarBtn.replaceChildren(icon(viva ? "stop" : "send"));
    enviarBtn.classList.toggle("is-stop", !!viva);
    if (abajo) scroller.scrollTop = scroller.scrollHeight;
  };

  const enviar = async () => {
    if (ejecucion) {
      if (ejecucion.sesion.id === s.id) void api.claudeCancelar(ejecucion.id);
      else toast("El agente ya está trabajando en otra sesión.", "info");
      return;
    }
    if (infoClaude && !infoClaude.ok) await comprobarClaude();
    if (infoClaude && !infoClaude.ok) {
      repintar();
      return;
    }
    const texto = entrada.value.trim();
    if (!texto) return;
    entrada.value = "";
    await lanzar(s, texto, repintar, alCambiarLista);
    scroller.scrollTop = scroller.scrollHeight;
  };

  entrada.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void enviar();
    }
  });
  enviarBtn.addEventListener("click", () => void enviar());

  const modelo = select(MODELOS.some((m) => m.valor === s.modelo) ? MODELOS : [...MODELOS, { valor: s.modelo, texto: s.modelo }], s.modelo, (v) => {
    s.modelo = v;
    ajustes.agente.modelo = v;
    guardarAjustes();
    if (s.elementos.length) guardarSesionAgente(s, false);
  }, "select select-chip");
  const permisos = select(PERMISOS, s.permisos, (v) => {
    s.permisos = v;
    ajustes.agente.permisos = v;
    guardarAjustes();
    if (s.elementos.length) guardarSesionAgente(s, false);
  }, "select select-chip");
  const esfuerzo = select(ESFUERZOS, ajustes.agente.esfuerzo, (v) => {
    ajustes.agente.esfuerzo = v;
    guardarAjustes();
  }, "select select-chip");

  const cabecera = h(
    "header",
    { class: "thread-head" },
    h("div", { class: "ag-title" }, h("span", { class: "ag-logo" }, icon("terminal")), tituloEl),
    infoClaude ? h("span", { class: `badge ${infoClaude.ok ? "" : "is-warn"}` }, infoClaude.ok ? `Claude Code ${infoClaude.texto.replace(/\s*\(Claude Code\)/, "")}` : "Claude Code no encontrado") : null,
    s.sesionClaude ? h("span", { class: "badge is-muted", attrs: { "data-tip": `Sesión ${s.sesionClaude} · se reanuda con --resume` } }, "reanudable") : null,
    h("span", { class: "grow" }),
    btn(null, {
      icon: "more",
      variant: "ghost",
      size: "icon-sm",
      title: "Acciones",
      onclick: (ev) =>
        menu(
          [
            { texto: "Recargar la novela desde disco", icono: "refresh", accion: () => void recargarDesdeDisco().then(() => toast("Novela recargada", "ok")) },
            { texto: "Copiar id de sesión de Claude", icono: "copy", deshabilitado: !s.sesionClaude, accion: () => void navigator.clipboard.writeText(s.sesionClaude) },
            { texto: "Olvidar la sesión de Claude (empezar contexto nuevo)", icono: "x", deshabilitado: !s.sesionClaude, accion: () => {
              s.sesionClaude = "";
              s.elementos.push({ tipo: "info", texto: "Contexto de Claude reiniciado: el siguiente mensaje empezará una conversación nueva." });
              guardarSesionAgente(s);
            } },
            { separador: true },
            { texto: "Eliminar sesión", icono: "trash", peligro: true, deshabilitado: ejecucion?.sesion.id === s.id, accion: async () => {
              if (!(await confirmar("Eliminar sesión", `Se eliminará el registro de «${s.titulo}».`))) return;
              estado.sesionAgente = "";
              await borrarSesionAgente(s.id);
            } },
          ],
          ev.currentTarget as HTMLElement,
        ),
    }),
  );

  const el = h(
    "div",
    { class: "chat-main" },
    cabecera,
    scroller,
    h(
      "div",
      { class: "composer-dock" },
      h(
        "div",
        { class: "composer agent-composer" },
        entrada,
        h(
          "div",
          { class: "composer-row" },
          h("span", { class: "chip-static" }, icon("terminal"), "claude"),
          modelo,
          permisos,
          esfuerzo,
          h("span", { class: "grow" }),
          h("span", { class: "composer-hint" }, "Trabaja en la carpeta de la novela"),
          enviarBtn,
        ),
      ),
    ),
  );

  if (ejecucion?.sesion.id === s.id) ejecucion.repintar = repintar;
  repintar();
  requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
  // Contador de segundos mientras trabaja.
  const reloj = window.setInterval(() => {
    if (!el.isConnected) return window.clearInterval(reloj);
    if (ejecucion?.sesion.id === s.id) repintar();
  }, 1000);
  return { el, repintar };
}

// ── Ejecución ────────────────────────────────────────────────────────────

const ESCRITURAS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"]);

async function lanzar(s: SesionAgente, texto: string, repintar: () => void, alCambiarLista: () => void): Promise<void> {
  const n = novela();
  await vaciarGuardado();
  await iniciarEventos();
  if (!s.elementos.length) s.titulo = texto.slice(0, 52) + (texto.length > 52 ? "…" : "");
  s.elementos.push({ tipo: "usuario", texto, fecha: Date.now() });
  guardarSesionAgente(s, false);

  const id = nuevoId("r");
  const ej: Ejecucion = {
    id,
    sesion: s,
    texto: "",
    pensando: "",
    herramientaViva: "",
    inicio: Date.now(),
    antes: new Map(n.textos),
    respaldadas: new Set(),
    repintar,
  };
  ejecucion = ej;
  indicarAgente(true);
  alCambiarLista();

  let timerRecarga = 0;
  const programarRecarga = () => {
    window.clearTimeout(timerRecarga);
    timerRecarga = window.setTimeout(() => void recargar(ej), 350);
  };

  const u = buscarEscena(n.meta, estado.escenaActual);
  const contexto = [
    "Estás integrado en Open Novel, un editor de novelas. Trabajas sobre los archivos de la novela en el directorio actual; lee CLAUDE.md para conocer el formato.",
    "La aplicación recarga los archivos automáticamente cuando los editas. Responde siempre en el idioma del usuario.",
    u ? `El autor tiene abierta la escena «${u.escena.titulo}» (archivo escenas/${u.escena.id}.md), capítulo ${u.numCapitulo} «${u.capitulo.titulo}».` : "",
    `La novela tiene ${todasLasEscenas(n.meta).length} escenas y ${n.codex.size} entradas en el Codex.`,
    ajustes.forzarIdioma ? `IDIOMA OBLIGATORIO: toda la prosa, los resúmenes y las entradas del Codex que escribas en los archivos van en ${idiomaEscritura(n.meta.idioma)}, aunque el resto esté en otro idioma.` : "",
    reglaPersonajes(n, "agente"),
    instruccionEvitar() ? `Al escribir prosa, nombres o entradas del Codex:\n${instruccionEvitar()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    s.modelo || "sonnet",
    "--permission-mode",
    s.permisos || "acceptEdits",
    "--append-system-prompt",
    contexto,
  ];
  if (ajustes.agente.esfuerzo) args.push("--effort", ajustes.agente.esfuerzo);
  if (s.sesionClaude) args.push("--resume", s.sesionClaude);

  const indiceHerramienta = new Map<string, Extract<ElementoAgente, { tipo: "herramienta" }>>();
  for (const el of s.elementos) if (el.tipo === "herramienta") indiceHerramienta.set(el.id, el);

  let finRecibido = false;
  suscribir<string, FinClaude>(
    id,
    (linea) => {
      let o: any;
      try {
        o = JSON.parse(linea);
      } catch {
        return;
      }
      const sub = !!o.parent_tool_use_id;
      switch (o.type) {
        case "system":
          if (o.subtype === "init") {
            if (o.session_id && o.session_id !== s.sesionClaude) {
              if (!s.sesionClaude) s.elementos.push({ tipo: "info", texto: `Sesión de Claude Code iniciada · ${o.model ?? s.modelo} · permisos: ${PERMISOS.find((p) => p.valor === o.permissionMode)?.texto ?? o.permissionMode ?? s.permisos}` });
              s.sesionClaude = o.session_id;
            }
          }
          break;
        case "stream_event": {
          if (sub) break;
          const ev = o.event ?? {};
          if (ev.type === "content_block_delta") {
            if (ev.delta?.type === "text_delta") ej.texto += ev.delta.text ?? "";
            else if (ev.delta?.type === "thinking_delta") ej.pensando += ev.delta.thinking ?? "";
          } else if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
            ej.herramientaViva = ev.content_block.name ?? "";
          }
          break;
        }
        case "assistant": {
          for (const b of o.message?.content ?? []) {
            if (b.type === "text" && b.text?.trim()) {
              if (!sub) ej.texto = "";
              s.elementos.push({ tipo: "texto", texto: b.text });
            } else if (b.type === "thinking" && b.thinking?.trim()) {
              ej.pensando = "";
              s.elementos.push({ tipo: "pensamiento", texto: b.thinking });
            } else if (b.type === "tool_use") {
              const el: Extract<ElementoAgente, { tipo: "herramienta" }> = { tipo: "herramienta", id: b.id, nombre: b.name, entrada: b.input };
              indiceHerramienta.set(b.id, el);
              s.elementos.push(el);
              ej.herramientaViva = b.name;
            }
          }
          break;
        }
        case "user": {
          const contenido = o.message?.content;
          if (!Array.isArray(contenido)) break;
          for (const b of contenido) {
            if (b.type !== "tool_result") continue;
            const el = indiceHerramienta.get(b.tool_use_id);
            const texto = Array.isArray(b.content)
              ? b.content.map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n")
              : String(b.content ?? "");
            if (el) {
              el.resultado = texto.slice(0, 6000);
              el.error = !!b.is_error;
              if (ESCRITURAS.has(el.nombre) && !b.is_error) programarRecarga();
            }
          }
          ej.herramientaViva = "";
          break;
        }
        case "result": {
          finRecibido = true;
          if (o.session_id) s.sesionClaude = o.session_id;
          if (ej.texto.trim() && !s.elementos.some((x) => x.tipo === "texto" && x.texto === ej.texto)) s.elementos.push({ tipo: "texto", texto: ej.texto });
          ej.texto = "";
          s.elementos.push({
            tipo: "fin",
            costo: Number(o.total_cost_usd ?? 0),
            duracion: Number(o.duration_ms ?? Date.now() - ej.inicio),
            turnos: Number(o.num_turns ?? 0),
            error: !!o.is_error,
            texto: o.is_error ? String(o.result ?? o.subtype ?? "Error") : undefined,
          });
          break;
        }
      }
      guardarSesionAgente(s, false);
      ej.repintar();
    },
    (fin) => {
      ejecucion = null;
      indicarAgente(false);
      if (fin.cancelado) s.elementos.push({ tipo: "info", texto: "Detenido por el usuario." });
      else if (!finRecibido) {
        const msg = fin.stderr.trim() || `Claude Code terminó con código ${fin.codigo}`;
        s.elementos.push({ tipo: "error", texto: msg });
      }
      guardarSesionAgente(s);
      window.clearTimeout(timerRecarga);
      void recargar(ej).finally(() => {
        alCambiarLista();
        ej.repintar();
      });
    },
  );

  try {
    await api.claudeEjecutar({ id, args, carpeta: n.carpeta, entrada: texto, ruta: ajustes.claudeRuta });
  } catch (e) {
    ejecucion = null;
    indicarAgente(false);
    s.elementos.push({ tipo: "error", texto: errMsg(e) });
    guardarSesionAgente(s);
    ej.repintar();
  }
}

/** Recarga la novela y guarda instantáneas del texto previo de las escenas cambiadas. */
async function recargar(ej: Ejecucion): Promise<void> {
  try {
    await recargarDesdeDisco();
    const n = novela();
    // La sesión en memoria es la fuente de verdad mientras se ejecuta.
    n.agente.set(ej.sesion.id, ej.sesion);
    for (const [id, previo] of ej.antes) {
      if (ej.respaldadas.has(id) || !previo.trim()) continue;
      if ((n.textos.get(id) ?? "") !== previo) {
        ej.respaldadas.add(id);
        await api.archivoEscribir(n.carpeta, `historial/${id}/${Date.now()}-antes-agente.md`, previo);
      }
    }
  } catch (e) {
    toast(`No se pudo recargar la novela: ${errMsg(e)}`, "error");
  }
}

// ── Pintado de elementos ─────────────────────────────────────────────────

function nombreHerramienta(nombre: string): { texto: string; icono: IconName } {
  const mapa: Record<string, { texto: string; icono: IconName }> = {
    Read: { texto: "Leer", icono: "file" },
    Edit: { texto: "Editar", icono: "edit" },
    MultiEdit: { texto: "Editar", icono: "edit" },
    Write: { texto: "Escribir", icono: "write" },
    Glob: { texto: "Buscar archivos", icono: "search" },
    Grep: { texto: "Buscar texto", icono: "search" },
    Bash: { texto: "Terminal", icono: "terminal" },
    TodoWrite: { texto: "Plan de tareas", icono: "list" },
    WebSearch: { texto: "Buscar en la web", icono: "lore" },
    WebFetch: { texto: "Leer página web", icono: "lore" },
    Task: { texto: "Subagente", icono: "agent" },
    Agent: { texto: "Subagente", icono: "agent" },
    ExitPlanMode: { texto: "Plan propuesto", icono: "plan" },
  };
  return mapa[nombre] ?? { texto: nombre, icono: "tool" };
}

/** Traduce rutas de archivos a nombres de la novela. */
function describirRuta(ruta: string): string {
  const n = estado.novela;
  if (!n) return ruta;
  const rel = ruta.startsWith(n.ruta) ? ruta.slice(n.ruta.length).replace(/^\/+/, "") : ruta;
  let m = /(?:^|\/)escenas\/([\w-]+)\.md$/.exec(rel);
  if (m) {
    const u = buscarEscena(n.meta, m[1]);
    return u ? `Escena «${u.escena.titulo}»` : rel;
  }
  m = /(?:^|\/)codex\/([\w-]+)\.md$/.exec(rel);
  if (m) {
    const e = n.codex.get(m[1]);
    return e ? `Codex «${e.nombre}»` : rel;
  }
  if (/(?:^|\/)novela\.json$/.test(rel)) return "Estructura de la novela";
  if (/(?:^|\/)CLAUDE\.md$/.test(rel)) return "Guía del proyecto";
  return rel;
}

function resumenEntrada(nombre: string, entrada: any): string {
  if (!entrada || typeof entrada !== "object") return "";
  if (entrada.file_path) return describirRuta(String(entrada.file_path));
  if (entrada.path && !entrada.pattern) return describirRuta(String(entrada.path));
  if (entrada.pattern) return `«${entrada.pattern}»${entrada.path ? ` en ${describirRuta(entrada.path)}` : ""}`;
  if (entrada.command) return String(entrada.command).slice(0, 120);
  if (entrada.description) return String(entrada.description);
  if (entrada.query) return String(entrada.query);
  if (entrada.url) return String(entrada.url);
  if (nombre === "TodoWrite" && Array.isArray(entrada.todos)) return `${entrada.todos.length} tareas`;
  return "";
}

function pintarElemento(el: ElementoAgente, plegadas: Set<string>, repintar: () => void): HTMLElement {
  switch (el.tipo) {
    case "usuario":
      return h("div", { class: "msg msg-user" }, h("div", { class: "bubble", attrs: { translate: "no" } }, el.texto));
    case "texto":
      return h("div", { class: "ag-text" }, markdown(el.texto));
    case "pensamiento": {
      const clave = `p:${el.texto.slice(0, 40)}`;
      const abierto = plegadas.has(clave);
      return h(
        "div",
        { class: `ag-thinking${abierto ? " is-open" : ""}` },
        h("button", { type: "button", class: "ag-row-btn", onclick: () => (abierto ? plegadas.delete(clave) : plegadas.add(clave), repintar()) }, icon("sparkle"), h("span", null, "Razonamiento"), icon(abierto ? "chevronDown" : "chevronRight", "icon ag-caret")),
        abierto ? h("div", { class: "ag-thinking-body" }, el.texto) : null,
      );
    }
    case "herramienta": {
      const info = nombreHerramienta(el.nombre);
      const abierto = plegadas.has(el.id);
      const estadoIcono = el.resultado === undefined ? spinner() : el.error ? icon("alert", "icon ag-err") : icon("check", "icon ag-ok");
      const detalle: Node[] = [];
      if (abierto) {
        const e = el.entrada as any;
        if ((el.nombre === "Edit" || el.nombre === "MultiEdit") && e) {
          const ediciones = el.nombre === "MultiEdit" ? (e.edits ?? []) : [e];
          for (const x of ediciones) {
            detalle.push(h("pre", { class: "diff diff-del" }, String(x.old_string ?? "")), h("pre", { class: "diff diff-add" }, String(x.new_string ?? "")));
          }
        } else if (el.nombre === "Write" && e?.content) {
          detalle.push(h("pre", { class: "ag-pre" }, String(e.content).slice(0, 4000)));
        } else if (el.nombre === "TodoWrite" && Array.isArray(e?.todos)) {
          detalle.push(
            h(
              "ul",
              { class: "todos" },
              ...e.todos.map((t: any) => h("li", { class: `todo is-${t.status}` }, icon(t.status === "completed" ? "check" : t.status === "in_progress" ? "arrowRight" : "dot"), String(t.content ?? t.activeForm ?? ""))),
            ),
          );
        } else {
          detalle.push(h("pre", { class: "ag-pre" }, JSON.stringify(el.entrada, null, 2).slice(0, 3000)));
        }
        if (el.resultado !== undefined && !["Write", "Edit", "MultiEdit", "TodoWrite"].includes(el.nombre))
          detalle.push(h("div", { class: "ag-result-label" }, el.error ? "Error" : "Resultado"), h("pre", { class: `ag-pre${el.error ? " is-error" : ""}` }, el.resultado.slice(0, 4000) || "(vacío)"));
        else if (el.error && el.resultado) detalle.push(h("pre", { class: "ag-pre is-error" }, el.resultado));
      }
      // TodoWrite se muestra abierto por defecto: es el plan del agente.
      return h(
        "div",
        { class: `ag-tool${abierto ? " is-open" : ""}${el.error ? " is-error" : ""}` },
        h(
          "button",
          { type: "button", class: "ag-row-btn", onclick: () => (abierto ? plegadas.delete(el.id) : plegadas.add(el.id), repintar()) },
          icon(info.icono),
          h("span", { class: "ag-tool-name" }, info.texto),
          h("span", { class: "ag-tool-arg" }, resumenEntrada(el.nombre, el.entrada)),
          estadoIcono,
          icon(abierto ? "chevronDown" : "chevronRight", "icon ag-caret"),
        ),
        abierto ? h("div", { class: "ag-tool-body" }, ...detalle) : null,
      );
    }
    case "fin":
      return h(
        "div",
        { class: `ag-done${el.error ? " is-error" : ""}` },
        icon(el.error ? "alert" : "check"),
        h("span", null, el.error ? `Terminó con error${el.texto ? `: ${el.texto}` : ""}` : "Hecho"),
        h("span", { class: "muted" }, `${Math.round(el.duracion / 1000)} s · ${el.turnos} turnos${el.costo ? ` · $${el.costo.toFixed(el.costo < 0.1 ? 3 : 2)}` : ""}`),
      );
    case "error":
      return h("div", { class: "prop-error" }, icon("alert"), h("span", null, el.texto));
    case "info":
      return h("div", { class: "ag-info" }, icon("info"), h("span", null, el.texto));
  }
}

function bienvenida(usar: (t: string) => void): HTMLElement {
  return h(
    "div",
    { class: "suggest agent-welcome" },
    h("div", { class: "ag-hero" }, h("span", { class: "ag-logo is-big" }, icon("terminal")), h("div", null, h("h2", null, "Modo agente"), h("p", null, "Claude Code trabaja directamente sobre los archivos de tu novela: lee el manuscrito, escribe y edita escenas, crea entradas del Codex y reorganiza la estructura. Los cambios aparecen en Open Novel al instante y las escenas modificadas guardan una instantánea previa en su historial."))),
    h("p", { class: "suggest-title" }, "Prueba con…"),
    ...SUGERENCIAS.map((t) => h("button", { type: "button", class: "suggest-item", onclick: () => usar(t) }, icon("sparkle"), t)),
  );
}

function avisoInstalacion(): HTMLElement {
  return h(
    "div",
    { class: "callout is-warn" },
    icon("alert"),
    h(
      "div",
      null,
      h("strong", null, "No se encontró Claude Code CLI"),
      h("p", null, infoClaude?.texto ?? ""),
      h("p", null, "Instálalo con ", h("code", null, "npm install -g @anthropic-ai/claude-code"), " (o el instalador oficial), inicia sesión ejecutando ", h("code", null, "claude"), " una vez en la terminal, o indica la ruta del ejecutable en Ajustes → Claude Code."),
      btn("Comprobar de nuevo", { icon: "refresh", variant: "secondary", size: "sm", onclick: async () => {
        await comprobarClaude();
        toast(infoClaude?.ok ? `Claude Code encontrado: ${infoClaude.texto}` : "Sigue sin encontrarse", infoClaude?.ok ? "ok" : "error");
      } }),
    ),
  );
}

export function reiniciarInfoClaude(): void {
  infoClaude = null;
}

