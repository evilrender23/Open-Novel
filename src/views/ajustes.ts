// Ajustes globales: apariencia, editor, proveedores de IA, modelos por
// función, Claude Code CLI y biblioteca.

import { api, nuevoId } from "../api";
import { novela } from "../estado";
import { ACENTOS, PALABRAS_EVITAR_DEFECTO, ajustes, idiomaEscritura, guardarAjustes, modelosDisponibles, PROVEEDORES_BASE, type Funcion, type Proveedor, type TipoProveedor } from "../ajustes";
import { chips, segmentado } from "../componentes";
import { generar, listarModelos } from "../ia";
import { actualizarEstado } from "../shell";
import { btn, campo, confirmar, errMsg, h, icon, menu, modal, select, spinner } from "../ui";
import { reiniciarInfoClaude } from "./agente";
import { IDIOMAS, IDIOMAS_ESCRITURA, idiomaSistema, locale } from "../i18n";
import {
  alActualizar,
  aplicarActualizacion,
  buscarActualizaciones,
  canal,
  corto,
  describir,
  estadoActualizacion,
  versionInstalada,
  type EstadoActualizacion,
} from "../updater";

type Pestana = "apariencia" | "ia" | "claude" | "biblioteca" | "actualizaciones";

export function abrirAjustes(inicial: Pestana = "apariencia"): void {
  const m = modal("Ajustes", { wide: true });
  m.el.classList.add("settings");
  const nav = h("nav", { class: "settings-nav" });
  const cuerpo = h("div", { class: "settings-body" });
  m.body.append(h("div", { class: "settings-layout" }, nav, cuerpo));
  m.footer.append(h("span", { class: "muted" }, "Los cambios se guardan automáticamente."), h("span", { class: "grow" }), btn("Listo", { variant: "primary", onclick: () => m.close() }));

  const pestanas: { id: Pestana; texto: string; icono: Parameters<typeof icon>[0] }[] = [
    { id: "apariencia", texto: "Apariencia y editor", icono: "sun" },
    { id: "ia", texto: "Inteligencia artificial", icono: "sparkle" },
    { id: "claude", texto: "Claude Code", icono: "terminal" },
    { id: "biblioteca", texto: "Biblioteca", icono: "library" },
    { id: "actualizaciones", texto: "Actualizaciones", icono: "refresh" },
  ];
  const ir = (p: Pestana) => {
    nav.replaceChildren(
      ...pestanas.map((t) => h("button", { type: "button", class: `nav-item${t.id === p ? " is-active" : ""}`, onclick: () => ir(t.id) }, icon(t.icono), h("span", null, t.texto))),
    );
    cuerpo.replaceChildren(p === "apariencia" ? apariencia() : p === "ia" ? ia() : p === "claude" ? claude() : p === "biblioteca" ? biblioteca() : actualizaciones());
  };
  ir(inicial);
}

function seccion(titulo: string, ...hijos: (Node | null)[]): HTMLElement {
  return h("section", { class: "set-sec" }, h("h3", { class: "set-title" }, titulo), ...hijos.filter((x): x is Node => !!x));
}

function apariencia(): HTMLElement {
  const rango = (min: number, max: number, paso: number, valor: number, fn: (v: number) => void, fmt: (v: number) => string) => {
    const salida = h("span", { class: "range-val" }, fmt(valor));
    const r = h("input", { type: "range", min: String(min), max: String(max), step: String(paso), value: String(valor), class: "range" });
    r.addEventListener("input", () => {
      fn(Number(r.value));
      salida.textContent = fmt(Number(r.value));
      guardarAjustes();
    });
    return h("div", { class: "range-row" }, r, salida);
  };
  const resaltar = h("input", { type: "checkbox", checked: ajustes.resaltarCodex });
  resaltar.addEventListener("change", () => ((ajustes.resaltarCodex = resaltar.checked), guardarAjustes()));
  const sistema = IDIOMAS.find((x) => x.codigo === idiomaSistema())?.nombre ?? "English";
  return h(
    "div",
    null,
    seccion(
      "Idioma",
      campo(
        "Idioma de la interfaz",
        select(
          [{ valor: "", texto: `Idioma del sistema (${sistema})` }, ...IDIOMAS.map((x) => ({ valor: x.codigo, texto: x.nombre }))],
          ajustes.idioma,
          (v) => {
            ajustes.idioma = v;
            guardarAjustes();
            // Se recarga para volver a construir la interfaz en el idioma nuevo.
            window.setTimeout(() => location.reload(), 400);
          },
        ),
        "Menús, botones y avisos. El idioma en que escribe la IA se elige en Inteligencia artificial.",
      ),
    ),
    seccion(
      "Tema",
      segmentado(
        [
          { valor: "sistema", texto: "Sistema" },
          { valor: "claro", texto: "Claro", icono: "sun" },
          { valor: "oscuro", texto: "Oscuro", icono: "moon" },
        ],
        ajustes.tema,
        (v) => ((ajustes.tema = v), guardarAjustes()),
      ),
      h("div", { class: "field-label set-gap" }, "Acento"),
      (() => {
        const caja = h("div", { class: "swatches" });
        const pintar = () =>
          caja.replaceChildren(
            ...ACENTOS.map((c) =>
              h("button", { type: "button", class: `swatch${ajustes.acento === c ? " is-active" : ""}`, style: `--sw:${c}`, attrs: { "aria-label": c }, onclick: () => ((ajustes.acento = c), guardarAjustes(), pintar()) }),
            ),
          );
        pintar();
        return caja;
      })(),
    ),
    seccion(
      "Editor",
      campo(
        "Tipografía de la prosa",
        segmentado(
          [
            { valor: "serif", texto: "Serif" },
            { valor: "sans", texto: "Sans" },
            { valor: "mono", texto: "Mono" },
          ],
          ajustes.fuenteEditor,
          (v) => ((ajustes.fuenteEditor = v), guardarAjustes()),
        ),
      ),
      campo("Tamaño", rango(14, 24, 1, ajustes.tamanoEditor, (v) => (ajustes.tamanoEditor = v), (v) => `${v} px`)),
      campo("Ancho de la columna", rango(32, 60, 1, ajustes.anchoEditor, (v) => (ajustes.anchoEditor = v), (v) => `${v} rem`)),
      campo("Interlineado", rango(1.3, 2.2, 0.05, ajustes.interlineado, (v) => (ajustes.interlineado = v), (v) => v.toFixed(2))),
      h("label", { class: "check" }, resaltar, h("span", null, "Resaltar las menciones del Codex mientras escribo")),
    ),
  );
}

function ia(): HTMLElement {
  const cont = h("div");
  const pintar = () => {
    const opciones = modelosDisponibles().map((m) => ({ valor: m.ref, texto: `${m.texto} · ${m.proveedor}` }));
    const funciones: { f: Funcion; texto: string; ayuda: string }[] = [
      { f: "escritura", texto: "Escritura", ayuda: "Beats, continuar, reescribir, expandir…" },
      { f: "chat", texto: "Chat", ayuda: "Conversaciones sobre la novela" },
      { f: "codex", texto: "Codex", ayuda: "Desarrollar entradas" },
      { f: "resumen", texto: "Resúmenes", ayuda: "Resumir escenas (un modelo rápido basta)" },
    ];
    const temp = h("input", { type: "number", class: "input input-sm", min: "0", max: "2", step: "0.1", value: String(ajustes.temperatura) });
    temp.addEventListener("change", () => ((ajustes.temperatura = Math.max(0, Math.min(2, Number(temp.value) || 0))), guardarAjustes()));
    const max = h("input", { type: "number", class: "input input-sm", min: "256", step: "256", value: String(ajustes.maxTokens) });
    max.addEventListener("change", () => ((ajustes.maxTokens = Math.max(256, Number(max.value) || 2048)), guardarAjustes()));
    const ctx = h("input", { type: "number", class: "input input-sm", min: "200", step: "100", value: String(ajustes.palabrasContexto) });
    ctx.addEventListener("change", () => ((ajustes.palabrasContexto = Math.max(200, Number(ctx.value) || 1500)), guardarAjustes()));

    cont.replaceChildren(
      seccion(
        "Modelos por función",
        h(
          "div",
          { class: "form-grid" },
          ...funciones.map((x) =>
            campo(
              x.texto,
              select([...(opciones.some((o) => o.valor === ajustes.modelos[x.f]) ? [] : [{ valor: ajustes.modelos[x.f], texto: `${ajustes.modelos[x.f]} (no disponible)` }]), ...opciones], ajustes.modelos[x.f], (v) => {
                ajustes.modelos[x.f] = v;
                guardarAjustes();
                actualizarEstado();
              }),
              x.ayuda,
            ),
          ),
        ),
        h("div", { class: "form-grid form-grid-3" }, campo("Temperatura", temp, "No aplica a Claude Code"), campo("Máx. tokens de salida", max), campo("Palabras de contexto previo", ctx, "Texto anterior al cursor que se envía")),
      ),
      seccion(
        "Idioma de escritura",
        (() => {
          const otro = h("input", { class: "input", placeholder: "Otro idioma o variante (p. ej. «español de Canarias», «Scots»)" });
          const conocido = ["novela", "interfaz", ...IDIOMAS_ESCRITURA.map((x) => x.nombre)].includes(ajustes.idiomaIA);
          if (!conocido) otro.value = ajustes.idiomaIA;
          const resumen = h("p", { class: "muted" });
          const pintarResumen = () => (resumen.textContent = `La IA escribirá en: ${idiomaEscritura(estadoNovelaIdioma())}`);
          const sel = select(
            [
              { valor: "novela", texto: "El idioma de cada novela (Planificar → Idioma de la prosa)" },
              { valor: "interfaz", texto: "El idioma de la interfaz" },
              ...IDIOMAS_ESCRITURA.map((x) => ({ valor: x.nombre, texto: x.nombre === x.ingles ? x.nombre : `${x.nombre} — ${x.ingles}` })),
              { valor: "otro", texto: "Otro…" },
            ],
            conocido ? ajustes.idiomaIA : "otro",
            (v) => {
              otro.hidden = v !== "otro";
              if (v !== "otro") ajustes.idiomaIA = v;
              else if (otro.value.trim()) ajustes.idiomaIA = otro.value.trim();
              else otro.focus();
              guardarAjustes();
              pintarResumen();
            },
          );
          otro.hidden = conocido;
          otro.addEventListener("input", () => {
            if (otro.value.trim()) ajustes.idiomaIA = otro.value.trim();
            guardarAjustes();
            pintarResumen();
          });
          const forzar = h("input", { type: "checkbox", checked: ajustes.forzarIdioma });
          forzar.addEventListener("change", () => ((ajustes.forzarIdioma = forzar.checked), guardarAjustes()));
          pintarResumen();
          return h(
            "div",
            { class: "field" },
            campo("La IA escribe en", h("div", { class: "stack-sm" }, sel, otro)),
            h("label", { class: "check" }, forzar, h("span", null, "Forzar el idioma: ordenar a la IA que escriba solo en este idioma aunque el contexto, los prompts o tu mensaje estén en otro")),
            resumen,
          );
        })(),
      ),
      seccion(
        "Personajes",
        (() => {
          const c = h("input", { type: "checkbox", checked: ajustes.soloPersonajesCodex });
          c.addEventListener("change", () => ((ajustes.soloPersonajesCodex = c.checked), guardarAjustes()));
          return h("label", { class: "check" }, c, h("span", null, "Solo personajes del Codex: la IA no inventa personajes con nombre. Los figurantes van sin nombre y, si hace falta alguien nuevo, te avisa para que lo crees antes en el Codex."));
        })(),
        h("p", { class: "muted" }, "Se aplica a la prosa, al chat (en Ideación puede proponerlos marcándolos como nuevos), a «Desarrollar con IA» y al agente."),
      ),
      seccion(
        "Palabras y clichés prohibidos",
        h("p", { class: "muted" }, "Se añaden al prompt de sistema de todo lo que genera la IA: beats, reescrituras, Codex, chat, resúmenes, tus prompts personalizados y el agente. Una entrada por línea o separadas por comas; las líneas con # son comentarios."),
        (() => {
          const t = h("textarea", { class: "textarea mono", rows: 12 });
          t.value = ajustes.palabrasEvitar;
          t.addEventListener("input", () => ((ajustes.palabrasEvitar = t.value), guardarAjustes()));
          return h(
            "div",
            { class: "field" },
            t,
            btn("Restaurar la lista por defecto", { icon: "refresh", variant: "ghost", size: "xs", onclick: () => {
              t.value = PALABRAS_EVITAR_DEFECTO;
              ajustes.palabrasEvitar = t.value;
              guardarAjustes();
            } }),
          );
        })(),
      ),
      seccion(
        "Proveedores",
        h("p", { class: "muted" }, "Claude Code CLI usa tu sesión de Claude (suscripción) sin clave de API. Las claves de los demás proveedores se guardan localmente en este equipo."),
        ...ajustes.proveedores.map((p) => tarjetaProveedor(p, pintar)),
        btn("Añadir proveedor", {
          icon: "plus",
          variant: "secondary",
          onclick: (e) =>
            menu(
              (Object.keys(PROVEEDORES_BASE) as TipoProveedor[]).map((t) => ({
                texto: PROVEEDORES_BASE[t].nombre,
                accion: () => {
                  const base = PROVEEDORES_BASE[t];
                  ajustes.proveedores.push({ id: nuevoId("p"), tipo: t, nombre: base.nombre, clave: "", url: base.url, modelos: [...base.modelos] });
                  guardarAjustes();
                  pintar();
                },
              })),
              e.currentTarget as HTMLElement,
            ),
        }),
      ),
    );
  };
  pintar();
  return cont;
}

function tarjetaProveedor(p: Proveedor, repintar: () => void): HTMLElement {
  const base = PROVEEDORES_BASE[p.tipo];
  const nombre = h("input", { class: "input input-sm", value: p.nombre });
  nombre.addEventListener("change", () => ((p.nombre = nombre.value.trim() || base.nombre), guardarAjustes()));
  const clave = h("input", { class: "input input-sm", type: "password", value: p.clave, placeholder: base.necesitaClave ? "Clave de API" : "Opcional", autocomplete: "off" });
  clave.addEventListener("change", () => ((p.clave = clave.value.trim()), guardarAjustes()));
  const url = h("input", { class: "input input-sm", value: p.url, placeholder: "https://…/v1" });
  url.addEventListener("change", () => ((p.url = url.value.trim()), guardarAjustes()));
  const estado = h("span", { class: "muted" });

  const probar = async () => {
    estado.replaceChildren(spinner(), " Probando…");
    const modelo = p.modelos[0];
    if (!modelo) return estado.replaceChildren("Añade al menos un modelo.");
    try {
      const t = await generar({ modelo: `${p.id}::${modelo}`, sistema: "Responde solo con la palabra OK.", mensajes: [{ rol: "usuario", texto: "Di OK" }], maxTokens: 16 }).promesa;
      estado.replaceChildren(icon("check", "icon ag-ok"), ` Funciona (${modelo}): «${t.trim().slice(0, 30)}»`);
    } catch (e) {
      estado.replaceChildren(icon("alert", "icon ag-err"), ` ${errMsg(e).slice(0, 200)}`);
    }
  };
  const obtener = async () => {
    estado.replaceChildren(spinner(), " Obteniendo modelos…");
    try {
      const lista = await listarModelos(p.id);
      if (!lista.length) throw new Error("El proveedor no devolvió modelos");
      const m = modal(`Modelos de ${p.nombre}`, { subtitle: `${lista.length} disponibles. Marca los que quieras usar.` });
      const elegidos = new Set(p.modelos);
      const filtro = h("input", { class: "input", placeholder: "Filtrar…" });
      const caja = h("div", { class: "model-pick" });
      const pintar = () =>
        caja.replaceChildren(
          ...lista
            .filter((x) => x.toLowerCase().includes(filtro.value.toLowerCase()))
            .slice(0, 300)
            .map((x) => {
              const c = h("input", { type: "checkbox", checked: elegidos.has(x) });
              c.addEventListener("change", () => (c.checked ? elegidos.add(x) : elegidos.delete(x)));
              return h("label", { class: "check" }, c, h("span", null, x));
            }),
        );
      filtro.addEventListener("input", pintar);
      pintar();
      m.body.append(filtro, caja);
      m.footer.append(btn("Cancelar", { variant: "text", onclick: () => m.close() }), btn("Guardar", { variant: "primary", onclick: () => {
        p.modelos = [...elegidos];
        guardarAjustes();
        m.close();
        repintar();
      } }));
      estado.replaceChildren();
    } catch (e) {
      estado.replaceChildren(icon("alert", "icon ag-err"), ` ${errMsg(e).slice(0, 200)}`);
    }
  };

  return h(
    "div",
    { class: "prov" },
    h(
      "div",
      { class: "prov-head" },
      h("span", { class: "prov-type" }, icon(p.tipo === "claude-code" ? "terminal" : "sparkle"), base.nombre),
      h("span", { class: "grow" }),
      btn("Probar", { variant: "ghost", size: "xs", onclick: () => void probar() }),
      p.tipo !== "claude-code" ? btn("Obtener modelos", { variant: "ghost", size: "xs", onclick: () => void obtener() }) : null,
      btn(null, {
        icon: "trash",
        variant: "ghost",
        size: "icon-xs",
        title: "Quitar proveedor",
        onclick: async () => {
          if (!(await confirmar("Quitar proveedor", `Se quitará «${p.nombre}».`))) return;
          ajustes.proveedores = ajustes.proveedores.filter((x) => x.id !== p.id);
          guardarAjustes();
          repintar();
        },
      }),
    ),
    h(
      "div",
      { class: "form-grid" },
      campo("Nombre", nombre),
      p.tipo === "claude-code" ? null : campo("Clave de API", clave),
      p.tipo === "claude-code" ? null : campo("URL base", url),
    ),
    campo("Modelos", chips(p.modelos, (v) => ((p.modelos = v), guardarAjustes()), "Añadir id de modelo…")),
    estado,
  );
}

function claude(): HTMLElement {
  const ruta = h("input", { class: "input", value: ajustes.claudeRuta, placeholder: "Automático (busca «claude» en el PATH)" });
  const estado = h("div", { class: "callout" }, spinner(), h("span", null, "Comprobando…"));
  const comprobar = async () => {
    estado.className = "callout";
    estado.replaceChildren(spinner(), h("span", null, "Comprobando…"));
    try {
      const i = await api.claudeInfo(ajustes.claudeRuta);
      estado.classList.add("is-ok");
      estado.replaceChildren(icon("check"), h("div", null, h("strong", null, i.version || "Claude Code"), h("p", null, i.ruta)));
    } catch (e) {
      estado.classList.add("is-warn");
      estado.replaceChildren(icon("alert"), h("div", null, h("strong", null, "No disponible"), h("p", null, errMsg(e))));
    }
    reiniciarInfoClaude();
  };
  ruta.addEventListener("change", () => {
    ajustes.claudeRuta = ruta.value.trim();
    guardarAjustes();
    void comprobar();
  });
  void comprobar();
  return h(
    "div",
    null,
    seccion(
      "Claude Code CLI",
      h("p", { class: "muted" }, "Open Novel usa Claude Code de dos formas: como proveedor de texto (sin herramientas, para beats, chat y Codex) y en el modo Agente, donde trabaja con herramientas sobre los archivos de la novela."),
      estado,
      campo("Ruta del ejecutable", ruta, "Déjalo vacío para detectarlo automáticamente (~/.local/bin, Homebrew, npm global…)."),
      btn("Comprobar", { icon: "refresh", variant: "secondary", size: "sm", onclick: () => void comprobar() }),
    ),
    seccion(
      "Permisos del agente",
      h(
        "dl",
        { class: "defs" },
        h("dt", null, "Editar archivos"),
        h("dd", null, "Puede leer y editar archivos de la novela sin preguntar. No ejecuta comandos de terminal. (Recomendado)"),
        h("dt", null, "Solo planificar"),
        h("dd", null, "Lee y propone un plan, pero no modifica nada."),
        h("dt", null, "Automático"),
        h("dd", null, "Claude decide qué acciones son seguras."),
        h("dt", null, "Sin restricciones"),
        h("dd", null, "Puede ejecutar cualquier comando. Úsalo solo si sabes lo que haces."),
      ),
    ),
  );
}

function biblioteca(): HTMLElement {
  const ruta = h("code", null, "…");
  void api.bibliotecaRaiz().then((r) => (ruta.textContent = r));
  return h(
    "div",
    null,
    seccion(
      "Carpeta de la biblioteca",
      h("p", null, ruta),
      h("p", { class: "muted" }, "Cada novela es una carpeta con novela.json, escenas/*.md, codex/*.md y notas/*.md. Puedes sincronizarla con iCloud/Dropbox o versionarla con Git. Cámbiala desde la pantalla de Biblioteca."),
    ),
    seccion("Acerca de", h("p", null, "Open Novel 0.1 — entorno de escritura de novelas de código abierto (MIT), inspirado en NovelCrafter. Interfaz basada en el sistema de diseño de Hermes.")),
  );
}

function actualizaciones(): HTMLElement {
  const version = h("strong", null, "…");
  const origen = h("p", { class: "muted" });
  const estado = h("p", { class: "upd-status" });
  const barra = h("span", { class: "meter meter-wide", hidden: true }, h("span", { class: "meter-fill" }));
  const buscar = btn("Buscar actualizaciones", { icon: "refresh", variant: "secondary", size: "sm", disabled: true, onclick: () => {
    buscar.disabled = true;
    buscarActualizaciones(true).catch((e: unknown) => {
      estado.textContent = errMsg(e);
      buscar.disabled = false;
    });
  } });
  const reiniciar = btn("Reiniciar y actualizar", { icon: "refresh", variant: "primary", size: "sm", onclick: () => void aplicarActualizacion() });
  reiniciar.hidden = true;
  const auto = h("input", { type: "checkbox", checked: ajustes.actualizacionesAuto });
  auto.addEventListener("change", () => {
    ajustes.actualizacionesAuto = auto.checked;
    guardarAjustes();
  });

  let instalada = false;
  const mostrar = (e: EstadoActualizacion) => {
    estado.textContent = describir(e);
    estado.classList.toggle("is-error", e.estado === "error");
    const ocupado = e.estado === "buscando" || e.estado === "compilando";
    buscar.disabled = !instalada || ocupado || e.estado === "lista";
    reiniciar.hidden = e.estado !== "lista";
    barra.hidden = e.estado !== "compilando";
    if (e.estado === "compilando") (barra.firstChild as HTMLElement).style.width = `${e.total ? (e.paso / e.total) * 100 : 4}%`;
  };

  Promise.all([versionInstalada(), canal()]).then(
    ([info, c]) => {
      if (c === "desarrollo" || !info) {
        version.textContent = "desarrollo";
        origen.textContent = "Compilación de desarrollo (tauri dev o compilada a mano): no se actualiza sola. Instálala con el comando de abajo para recibir las actualizaciones de main.";
        auto.disabled = true;
        return;
      }
      instalada = true;
      const fecha = info.fecha ? new Date(info.fecha).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : "";
      version.textContent = corto(info.commit);
      origen.textContent = `Rama ${info.rama}${fecha ? ` · ${fecha}` : ""}`;
      mostrar(estadoActualizacion());
    },
    (e: unknown) => (origen.textContent = errMsg(e)),
  );
  const parar = alActualizar(mostrar);
  const cont = h(
    "div",
    null,
    seccion(
      "Versión instalada",
      h("p", null, "Commit ", version),
      origen,
      h("div", { class: "row-gap upd-row" }, buscar, reiniciar),
      estado,
      barra,
    ),
    seccion(
      "Automáticas",
      h("label", { class: "check" }, auto, h("span", null, "Buscar y compilar solas las versiones nuevas de main (al minuto de abrir y cada 6 horas)")),
      h(
        "p",
        { class: "muted" },
        "Cuando hay commits nuevos en main, el instalador los compila en segundo plano mientras escribes. Al terminar aparece «Reiniciar y actualizar»; si cierras la app sin más, la próxima vez que la abras ya será la nueva. Tus novelas, ajustes y claves no se tocan.",
      ),
    ),
    seccion(
      "Instalar o reinstalar",
      h("p", { class: "muted" }, "macOS y Linux:"),
      h("pre", { class: "ag-pre" }, "curl -fsSL https://raw.githubusercontent.com/evilrender23/Open-Novel/main/instalar.sh | bash"),
      h("p", { class: "muted" }, "Windows (PowerShell):"),
      h("pre", { class: "ag-pre" }, "irm https://raw.githubusercontent.com/evilrender23/Open-Novel/main/instalar.ps1 | iex"),
      h("p", { class: "muted" }, "Registro del progreso en registro/actualizacion.log y salida de la compilación en registro/compilacion.log, dentro de la carpeta de instalación."),
    ),
  );
  // Al cambiar de pestaña el nodo sale del DOM: se deja de escuchar.
  const vigia = new MutationObserver(() => {
    if (!cont.isConnected) {
      parar();
      vigia.disconnect();
    }
  });
  requestAnimationFrame(() => vigia.observe(document.body, { childList: true, subtree: true }));
  return cont;
}

function estadoNovelaIdioma(): string | undefined {
  try {
    return novela().meta.idioma;
  } catch {
    return undefined;
  }
}
