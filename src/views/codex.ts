// Vista Codex: la enciclopedia de la novela. Personajes, lugares, objetos,
// lore y subtramas con alias, campos, relaciones, progresiones por escena,
// reglas de inclusión en el contexto de la IA y menciones detectadas.

import { avatar, chips, segmentado } from "../componentes";
import { contextoDesarrollo, escenasConEntrada } from "../contexto";
import { abrirAutoCodex } from "../autocodex";
import { borrarCodex, estado, guardarCodex, novela } from "../estado";
import { buscarEscena, entradaNueva, TIPOS_CODEX, todasLasEscenas, type EntradaCodex, type TipoCodex } from "../modelo";
import { Propuesta } from "../propuesta";
import { iconoTipo, type ResultadoVista } from "../shell";
import { ACENTOS } from "../ajustes";
import { btn, confirmar, h, icon, menu, num, pedirTexto, select, vacio } from "../ui";
import { abrirEscena } from "./escribir";

let filtro = "";
let filtroTipo: TipoCodex | "" = "";

export function vistaCodex(): ResultadoVista {
  const n = novela();
  const lista = h("div", { class: "list" });
  const principal = h("div", { class: "codex" });
  const buscar = h("input", { class: "input input-sm sb-filter", placeholder: "Filtrar entradas…", value: filtro });
  buscar.addEventListener("input", () => {
    filtro = buscar.value;
    pintarLista();
  });

  const pintarLista = () => {
    const f = filtro.trim().toLocaleLowerCase();
    const entradas = [...n.codex.values()]
      .filter((e) => !filtroTipo || e.tipo === filtroTipo)
      .filter((e) => !f || [e.nombre, ...e.alias, ...e.etiquetas].some((t) => t.toLocaleLowerCase().includes(f)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const nodos: Node[] = [];
    for (const t of TIPOS_CODEX) {
      const grupo = entradas.filter((e) => e.tipo === t.valor);
      if (!grupo.length) continue;
      nodos.push(h("div", { class: "list-group" }, icon(t.icono), t.plural, h("span", { class: "list-count" }, String(grupo.length))));
      for (const e of grupo)
        nodos.push(
          h(
            "button",
            { type: "button", class: `list-row${e.id === estado.entradaActual ? " is-active" : ""}`, onclick: () => seleccionar(e.id) },
            avatar(e, "avatar-sm"),
            h("span", { class: "list-text" }, e.nombre),
            e.incluir === "siempre" ? icon("pin", "icon list-flag") : null,
          ),
        );
    }
    if (!nodos.length) nodos.push(h("p", { class: "panel-empty" }, n.codex.size ? "Sin resultados." : "El Codex está vacío."));
    lista.replaceChildren(...nodos);
  };

  const seleccionar = (id: string) => {
    estado.entradaActual = id;
    pintarLista();
    pintarPrincipal();
  };

  const nueva = (tipo: TipoCodex) => {
    const e = entradaNueva(`Nuevo ${TIPOS_CODEX.find((t) => t.valor === tipo)?.texto.toLowerCase()}`, tipo);
    guardarCodex(e);
    seleccionar(e.id);
    requestAnimationFrame(() => {
      const i = principal.querySelector<HTMLInputElement>(".cx-name");
      i?.focus();
      i?.select();
    });
  };

  const pintarPrincipal = () => {
    const e = n.codex.get(estado.entradaActual);
    principal.replaceChildren(e ? editorEntrada(e, seleccionar) : resumenCodex(seleccionar, nueva));
  };

  pintarLista();
  pintarPrincipal();

  const menuNueva = (ancla: HTMLElement) =>
    menu(TIPOS_CODEX.map((t) => ({ texto: t.texto, icono: t.icono, accion: () => nueva(t.valor) })), ancla);

  const lateral = h(
    "div",
    { class: "sb-section" },
    h(
      "div",
      { class: "sb-section-head" },
      h("span", null, "Codex"),
      btn(null, { icon: "plus", variant: "ghost", size: "icon-xs", title: "Nueva entrada", onclick: (ev) => menuNueva(ev.currentTarget as HTMLElement) }),
    ),
    buscar,
    lista,
  );

  return {
    titulo: "Codex",
    principal,
    lateral,
    acciones: [
      select(
        [{ valor: "" as const, texto: "Todos los tipos" }, ...TIPOS_CODEX.map((t) => ({ valor: t.valor, texto: t.plural }))],
        filtroTipo,
        (v) => {
          filtroTipo = v;
          pintarLista();
        },
        "select select-ghost",
      ),
      btn("Rellenar desde la novela", { icon: "sparkle", variant: "ghost", size: "sm", onclick: () => abrirAutoCodex() }),
      btn("Nueva entrada", { icon: "plus", variant: "secondary", size: "sm", onclick: (ev) => menuNueva(ev.currentTarget as HTMLElement) }),
    ],
    alCambiar: (c, id) => {
      if (c === "recarga") return false;
      if (c === "codex") {
        pintarLista();
        if (id !== estado.entradaActual) pintarPrincipal();
      }
      return true;
    },
  };
}

function resumenCodex(seleccionar: (id: string) => void, nueva: (t: TipoCodex) => void): HTMLElement {
  const n = novela();
  if (!n.codex.size)
    return h(
      "div",
      { class: "page" },
      vacio(
        "Tu Codex está vacío",
        "Añade personajes, lugares, objetos y lore. Open Novel detecta sus nombres y alias en el texto y los incluye en el contexto de la IA cuando aparecen.",
        h("div", { class: "row-gap" }, ...TIPOS_CODEX.slice(0, 4).map((t) => btn(t.texto, { icon: t.icono, variant: "secondary", onclick: () => nueva(t.valor) }))),
      ),
    );
  const secciones: Node[] = [];
  for (const t of TIPOS_CODEX) {
    const grupo = [...n.codex.values()].filter((e) => e.tipo === t.valor).sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!grupo.length) continue;
    secciones.push(
      h("h2", { class: "section-title" }, icon(t.icono), t.plural, h("span", { class: "muted" }, String(grupo.length))),
      h(
        "div",
        { class: "cx-grid" },
        ...grupo.map((e) =>
          h(
            "button",
            { type: "button", class: "cx-tile", onclick: () => seleccionar(e.id) },
            h("div", { class: "cx-tile-head" }, avatar(e), h("span", { class: "cx-tile-name" }, e.nombre), e.incluir === "siempre" ? icon("pin", "icon list-flag") : null),
            h("p", { class: "cx-tile-desc" }, e.descripcion.slice(0, 160) || "Sin descripción."),
          ),
        ),
      ),
    );
  }
  return h("div", { class: "page" }, ...secciones);
}

function editorEntrada(e: EntradaCodex, seleccionar: (id: string) => void): HTMLElement {
  const n = novela();
  const guardar = () => guardarCodex(e, false);
  const avisar = () => guardarCodex(e, true);

  const nombre = h("input", { class: "cx-name", value: e.nombre, placeholder: "Nombre" });
  nombre.addEventListener("input", () => {
    e.nombre = nombre.value;
    guardar();
  });
  nombre.addEventListener("change", avisar);

  const tipo = select(TIPOS_CODEX.map((t) => ({ valor: t.valor, texto: t.texto })), e.tipo, (v) => {
    e.tipo = v;
    avisar();
  }, "select select-ghost");

  const descripcion = h("textarea", { class: "textarea cx-desc", rows: 10, placeholder: "Descripción: aspecto, personalidad, historia, voz, secretos… Esto es lo que la IA leerá." });
  descripcion.value = e.descripcion;
  descripcion.addEventListener("input", () => {
    e.descripcion = descripcion.value;
    guardar();
  });

  // Color
  const colores = h(
    "div",
    { class: "swatches" },
    h("button", { type: "button", class: `swatch is-none${!e.color ? " is-active" : ""}`, attrs: { "aria-label": "Sin color" }, onclick: () => ((e.color = ""), avisar(), seleccionar(e.id)) }),
    ...ACENTOS.map((c) =>
      h("button", { type: "button", class: `swatch${e.color === c ? " is-active" : ""}`, style: `--sw:${c}`, attrs: { "aria-label": c }, onclick: () => ((e.color = c), avisar(), seleccionar(e.id)) }),
    ),
  );

  // Campos personalizados
  const campos = h("div", { class: "kv" });
  const pintarCampos = () => {
    campos.replaceChildren(
      ...e.campos.map((c, i) => {
        const k = h("input", { class: "input input-sm kv-key", value: c.clave, placeholder: "Campo" });
        const v = h("input", { class: "input input-sm", value: c.valor, placeholder: "Valor" });
        k.addEventListener("input", () => ((c.clave = k.value), guardar()));
        v.addEventListener("input", () => ((c.valor = v.value), guardar()));
        return h("div", { class: "kv-row" }, k, v, btn(null, { icon: "x", variant: "ghost", size: "icon-xs", title: "Quitar campo", onclick: () => (e.campos.splice(i, 1), guardar(), pintarCampos()) }));
      }),
      btn("Campo", { icon: "plus", variant: "ghost", size: "xs", onclick: () => {
        e.campos.push({ clave: "", valor: "" });
        guardar();
        pintarCampos();
        (campos.querySelectorAll<HTMLInputElement>(".kv-key")[e.campos.length - 1])?.focus();
      } }),
    );
  };
  pintarCampos();

  // Entradas relacionadas
  const relaciones = h("div", { class: "rel-list" });
  const contadorRel = h("span", { class: "muted" });
  const relacionar = (x: EntradaCodex, vinculo = "") => {
    if (x.id === e.id) return;
    if (!e.relaciones.includes(x.id)) e.relaciones.push(x.id);
    if (vinculo) e.vinculos[x.id] = vinculo;
    // Recíproca (sin etiqueta: «hermana de» no siempre es simétrica).
    if (!x.relaciones.includes(e.id)) {
      x.relaciones.push(e.id);
      guardarCodex(x, false);
    }
    avisar();
    pintarRel();
  };
  const desrelacionar = (x: EntradaCodex) => {
    e.relaciones = e.relaciones.filter((id) => id !== x.id);
    delete e.vinculos[x.id];
    x.relaciones = x.relaciones.filter((id) => id !== e.id);
    delete x.vinculos?.[e.id];
    guardarCodex(x, false);
    avisar();
    pintarRel();
  };
  const escenasDe = (id: string) => new Set(escenasConEntrada(n, id).map((a) => a.escenaId));
  const propias = escenasDe(e.id);
  const compartidas = (id: string) => [...escenasDe(id)].filter((x) => propias.has(x)).length;
  const sugerenciasVinculo = (x: EntradaCodex): string[] => {
    const base: Record<string, string[]> = {
      personaje: ["amigo de", "enemigo de", "aliado de", "rival de", "pareja de", "padre de", "madre de", "hijo de", "hija de", "hermano de", "hermana de", "mentor de", "trabaja para", "le debe", "ama a", "teme a"],
      lugar: ["vive en", "nació en", "trabaja en", "gobierna", "frecuenta", "huyó de", "está en"],
      objeto: ["posee", "busca", "fabricó", "perdió", "robó", "protege", "es de"],
      lore: ["pertenece a", "cree en", "conoce", "custodia", "afecta a", "forma parte de"],
      subtrama: ["protagoniza", "participa en", "provoca", "resuelve", "ocurre en"],
      otro: ["relacionado con", "forma parte de"],
    };
    return base[x.tipo] ?? base.otro;
  };
  const pintarRel = () => {
    const filas = e.relaciones
      .map((id) => n.codex.get(id))
      .filter((x): x is EntradaCodex => !!x)
      .map((r) => {
        const vinculo = h("input", { class: "rel-label", value: e.vinculos[r.id] ?? "", placeholder: "tipo de relación…", attrs: { list: `vinc-${r.id}` } });
        vinculo.addEventListener("input", () => {
          const v = vinculo.value.trim();
          if (v) e.vinculos[r.id] = v;
          else delete e.vinculos[r.id];
          guardar();
        });
        vinculo.addEventListener("change", avisar);
        const inverso = r.vinculos?.[e.id];
        const juntas = compartidas(r.id);
        return h(
          "div",
          { class: "rel-card" },
          h("button", { type: "button", class: "rel-who", onclick: () => seleccionar(r.id), attrs: { "data-tip": "Abrir entrada" } }, avatar(r, "avatar-sm")),
          h(
            "div",
            { class: "rel-body" },
            h(
              "div",
              { class: "rel-line", attrs: { translate: "no" } },
              h("span", { class: "rel-me" }, e.nombre),
              vinculo,
              h("datalist", { id: `vinc-${r.id}` }, ...sugerenciasVinculo(r).map((x) => h("option", { value: x }))),
              h("button", { type: "button", class: "rel-name", onclick: () => seleccionar(r.id) }, r.nombre),
            ),
            h(
              "div",
              { class: "rel-meta" },
              h("span", null, TIPOS_CODEX.find((t) => t.valor === r.tipo)?.texto ?? r.tipo),
              inverso ? h("span", { attrs: { translate: "no" } }, `· ${r.nombre} ${inverso} ${e.nombre}`) : null,
              h("span", null, juntas ? `· coinciden en ${num(juntas)} escena${juntas === 1 ? "" : "s"}` : "· no coinciden en ninguna escena"),
            ),
            r.descripcion ? h("p", { class: "rel-desc", attrs: { translate: "no" } }, r.descripcion.slice(0, 140) + (r.descripcion.length > 140 ? "…" : "")) : null,
          ),
          btn(null, { icon: "x", variant: "ghost", size: "icon-xs", title: "Quitar relación", onclick: () => desrelacionar(r) }),
        );
      });

    // Sugeridas: entradas que aparecen en las mismas escenas y aún no están relacionadas.
    const sugeridas = [...n.codex.values()]
      .filter((x) => x.id !== e.id && !e.relaciones.includes(x.id))
      .map((x) => ({ x, juntas: compartidas(x.id), mencionada: [x.nombre, ...x.alias].some((t) => t.trim().length > 2 && e.descripcion.toLocaleLowerCase().includes(t.toLocaleLowerCase())) }))
      .filter((s) => s.juntas > 0 || s.mencionada)
      .sort((a, b) => Number(b.mencionada) - Number(a.mencionada) || b.juntas - a.juntas)
      .slice(0, 6);

    const anadir = btn("Relacionar con…", {
      icon: "link",
      variant: "ghost",
      size: "xs",
      onclick: (ev) => {
        const candidatos = [...n.codex.values()].filter((x) => x.id !== e.id && !e.relaciones.includes(x.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
        menu(
          candidatos.length ? candidatos.map((x) => ({ texto: x.nombre, icono: iconoTipo(x.tipo), accion: () => relacionar(x) })) : [{ titulo: "No hay más entradas" }],
          ev.currentTarget as HTMLElement,
        );
      },
    });
    const crear = btn("Nueva entrada relacionada", {
      icon: "plus",
      variant: "ghost",
      size: "xs",
      onclick: (ev) =>
        menu(
          TIPOS_CODEX.map((t) => ({
            texto: t.texto,
            icono: t.icono,
            accion: async () => {
              const nombre = await pedirTexto(`Nuevo ${t.texto.toLocaleLowerCase()} relacionado con «${e.nombre}»`, "Nombre");
              if (!nombre?.trim()) return;
              const x = entradaNueva(nombre.trim(), t.valor);
              x.relaciones = [e.id];
              guardarCodex(x, false);
              relacionar(x);
              seleccionar(x.id);
            },
          })),
          ev.currentTarget as HTMLElement,
        ),
    });
    const bloqueSugeridas = sugeridas.length
        ? h(
            "div",
            { class: "rel-suggest" },
            h("span", { class: "rel-suggest-title" }, "Sugeridas"),
            ...sugeridas.map((s) =>
              h(
                "button",
                { type: "button", class: "rel-sug", onclick: () => relacionar(s.x), attrs: { "data-tip": s.mencionada ? "Aparece en la descripción" : `Coinciden en ${s.juntas} escena${s.juntas === 1 ? "" : "s"}` } },
                icon("plus"),
                avatar(s.x, "avatar-xs"),
                h("span", { attrs: { translate: "no" } }, s.x.nombre),
                h("span", { class: "muted" }, s.mencionada ? "descr." : `×${s.juntas}`),
              ),
            ),
          )
        : null;
    contadorRel.textContent = filas.length ? String(filas.length) : "";
    relaciones.replaceChildren(
      ...(filas.length ? filas : [h("p", { class: "panel-empty" }, "Sin entradas relacionadas. La IA las tiene en cuenta al escribir y al desarrollar esta entrada.")]),
      ...(bloqueSugeridas ? [bloqueSugeridas] : []),
      h("div", { class: "row-gap rel-actions" }, anadir, crear),
    );
  };
  pintarRel();

  // Progresiones
  const progresiones = h("div", { class: "prog" });
  const opcionesEscena = todasLasEscenas(n.meta).map((u) => ({ valor: u.escena.id, texto: `Cap. ${u.numCapitulo} · ${u.escena.titulo}` }));
  const pintarProg = () => {
    progresiones.replaceChildren(
      ...e.progresiones.map((p, i) => {
        const t = h("textarea", { class: "textarea", rows: 2, placeholder: "Qué cambia a partir de esta escena (p. ej. «pierde la mano izquierda», «descubre que es su hermana»)" });
        t.value = p.texto;
        t.addEventListener("input", () => ((p.texto = t.value), guardar()));
        return h(
          "div",
          { class: "prog-row" },
          h("div", { class: "prog-head" }, icon("dot"), select(opcionesEscena, p.escena, (v) => ((p.escena = v), guardar()), "select select-ghost"), h("span", { class: "grow" }), btn(null, { icon: "x", variant: "ghost", size: "icon-xs", title: "Quitar", onclick: () => (e.progresiones.splice(i, 1), guardar(), pintarProg()) })),
          t,
        );
      }),
      opcionesEscena.length
        ? btn("Progresión", { icon: "plus", variant: "ghost", size: "xs", onclick: () => {
            e.progresiones.push({ escena: estado.escenaActual || opcionesEscena[0].valor, texto: "" });
            guardar();
            pintarProg();
          } })
        : h("p", { class: "panel-empty" }, "Crea escenas para registrar progresiones."),
    );
  };
  pintarProg();

  // Menciones
  const apariciones = escenasConEntrada(n, e.id);
  const total = apariciones.reduce((s, a) => s + a.veces, 0);
  const listaMenciones = apariciones.length
    ? h(
        "div",
        { class: "ctx-list" },
        ...apariciones.map((a) => {
          const u = buscarEscena(n.meta, a.escenaId)!;
          return h(
            "button",
            { type: "button", class: "ctx-row", onclick: () => abrirEscena(a.escenaId) },
            h("span", { class: `status-dot is-${u.escena.estado}` }),
            h("span", { class: "ctx-name" }, `Cap. ${u.numCapitulo} · ${u.escena.titulo}`),
            h("span", { class: "ctx-meta" }, a.pov ? `PDV${a.veces ? ` · ×${a.veces}` : ""}` : `×${a.veces}`),
          );
        }),
      )
    : h("p", { class: "panel-empty" }, e.detectar ? "No aparece en ninguna escena todavía." : "La detección de menciones está desactivada para esta entrada.");

  // IA
  const zonaIA = h("div");
  const desarrollar = () => {
    const p = new Propuesta({
      titulo: `Desarrollar «${e.nombre}»`,
      accion: "codex",
      vars: () => ({ ...(() => {
        const c = contextoDesarrollo(n, e);
        return { "entrada.relacionadas": c.relacionadas, "entrada.apariciones": c.apariciones };
      })(), "entrada.nombre": e.nombre, "entrada.tipo": TIPOS_CODEX.find((t) => t.valor === e.tipo)?.texto ?? e.tipo, "entrada.descripcion": e.descripcion || "(vacía)", beat: e.nombre }),
      acciones: [
        { texto: "Reemplazar", icono: "check", primaria: true, fn: (t) => ((e.descripcion = t), (descripcion.value = t), guardar()) },
        { texto: "Añadir al final", icono: "plus", fn: (t) => ((e.descripcion = `${e.descripcion.trim()}\n\n${t}`.trim()), (descripcion.value = e.descripcion), guardar()) },
      ],
    });
    zonaIA.replaceChildren(p.el);
    p.iniciar();
  };

  const tipoInfo = TIPOS_CODEX.find((t) => t.valor === e.tipo);

  return h(
    "div",
    { class: "page cx-editor" },
    h(
      "header",
      { class: "cx-head" },
      avatar(e, "avatar-lg"),
      h("div", { class: "cx-head-main" }, nombre, h("div", { class: "cx-head-meta" }, icon(tipoInfo?.icono ?? "tag"), tipo, h("span", { class: "muted" }, `· ${num(total)} menciones en ${apariciones.length} escenas`))),
      btn(null, {
        icon: "more",
        variant: "ghost",
        size: "icon-sm",
        title: "Acciones de la entrada",
        onclick: (ev) =>
          menu(
            [
              { texto: "Duplicar", icono: "duplicate", accion: () => {
                const copia = { ...structuredClone(e), id: entradaNueva("", e.tipo).id, nombre: `${e.nombre} (copia)` };
                guardarCodex(copia);
                seleccionar(copia.id);
              } },
              { separador: true },
              { texto: "Eliminar entrada", icono: "trash", peligro: true, accion: async () => {
                if (!(await confirmar("Eliminar entrada", `Se eliminará «${e.nombre}» del Codex.`))) return;
                await borrarCodex(e.id);
                estado.entradaActual = "";
                seleccionar("");
              } },
            ],
            ev.currentTarget as HTMLElement,
          ),
      }),
    ),
    h(
      "div",
      { class: "cx-cols" },
      h(
        "div",
        { class: "cx-main" },
        h("div", { class: "field-row" }, h("span", { class: "field-label" }, "Alias y apodos"), chips(e.alias, (v) => ((e.alias = v), avisar()), "Añadir alias… (Intro)")),
        h(
          "div",
          { class: "field-block" },
          h("div", { class: "panel-head" }, h("span", null, "Descripción"), btn("Desarrollar con IA", { icon: "sparkle", variant: "ghost", size: "xs", onclick: desarrollar })),
          descripcion,
          zonaIA,
        ),
        h("div", { class: "field-block" }, h("div", { class: "panel-head" }, h("span", null, "Detalles")), campos),
        h("div", { class: "field-block" }, h("div", { class: "panel-head" }, h("span", null, "Entradas relacionadas"), contadorRel), relaciones),
        h("div", { class: "field-block" }, h("div", { class: "panel-head" }, h("span", null, "Progresiones"), h("span", { class: "muted" }, "cambios a lo largo de la historia")), progresiones),
      ),
      h(
        "aside",
        { class: "cx-side" },
        h(
          "section",
          { class: "panel-sec" },
          h("div", { class: "panel-head" }, h("span", null, "Contexto de la IA")),
          segmentado(
            [
              { valor: "siempre", texto: "Siempre" },
              { valor: "menciones", texto: "Al mencionarse" },
              { valor: "nunca", texto: "Nunca" },
            ],
            e.incluir,
            (v) => ((e.incluir = v), avisar()),
          ),
          h("label", { class: "check" }, (() => {
            const c = h("input", { type: "checkbox", checked: e.detectar });
            c.addEventListener("change", () => ((e.detectar = c.checked), avisar()));
            return c;
          })(), h("span", null, "Detectar menciones en el texto")),
        ),
        h("section", { class: "panel-sec" }, h("div", { class: "panel-head" }, h("span", null, "Color")), colores),
        h("section", { class: "panel-sec" }, h("div", { class: "panel-head" }, h("span", null, "Etiquetas")), chips(e.etiquetas, (v) => ((e.etiquetas = v), avisar()), "Añadir etiqueta…")),
        h("section", { class: "panel-sec" }, h("div", { class: "panel-head" }, h("span", null, "Apariciones"), h("span", { class: "muted" }, String(apariciones.length))), listaMenciones),
      ),
    ),
  );
}
