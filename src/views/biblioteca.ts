// Biblioteca: lista de novelas, creación (vacía, tres actos o ejemplo),
// importación (copia .opennovel, Markdown o texto) y eliminación.

import { open as abrirDialogo } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { api, nuevoId, type ResumenNovela } from "../api";
import { capituloNuevo, entradaNueva, escenaNueva, metaNueva, serializar, type Acto, type EntradaCodex, type MetaNovela } from "../modelo";
import { arrastrable, avisoActualizacion } from "../shell";
import { btn, campo, confirmar, errMsg, fechaCorta, h, icon, menu, modal, num, select, toast, vacio } from "../ui";

type Plantilla = "vacia" | "tres-actos" | "ejemplo";

/** Acciones de la biblioteca montada (para la barra de menús). */
export const accionesBiblioteca: { nueva: (() => void) | null; importar: (() => void) | null } = { nueva: null, importar: null };

export function pantallaBiblioteca(contenedor: HTMLElement, alAbrir: (carpeta: string) => void, alAjustes: () => void): void {
  const lista = h("div", { class: "lib-list" });
  const rutaEl = h("span", { class: "lib-path" });

  const cargar = async () => {
    lista.replaceChildren(h("p", { class: "muted" }, "Cargando…"));
    try {
      const [novelas, raiz] = await Promise.all([api.novelasListar(), api.bibliotecaRaiz()]);
      rutaEl.textContent = raiz;
      pintar(novelas);
    } catch (e) {
      lista.replaceChildren(vacio("No se pudo leer la biblioteca", errMsg(e)));
    }
  };

  const pintar = (novelas: ResumenNovela[]) => {
    if (!novelas.length) {
      lista.replaceChildren(
        vacio(
          "Tu biblioteca está vacía",
          "Crea tu primera novela o abre la novela de ejemplo para ver Open Novel en acción.",
          h("div", { class: "row-gap" }, btn("Nueva novela", { icon: "plus", variant: "primary", onclick: () => dialogoNueva() }), btn("Abrir el ejemplo", { icon: "book", variant: "secondary", onclick: () => void crear("El faro de Aldara", "", "", "ejemplo") })),
        ),
      );
      return;
    }
    lista.replaceChildren(
      ...novelas.map((r) => {
        let meta: Partial<MetaNovela> = {};
        try {
          meta = JSON.parse(r.meta ?? "{}");
        } catch {
          /* novela.json dañado: se muestra igualmente */
        }
        const stats = meta.estadisticas ?? {};
        const ultimas = Object.keys(stats).sort();
        const palabras = ultimas.length ? stats[ultimas[ultimas.length - 1]] : 0;
        const obj = meta.objetivoPalabras ?? 0;
        const escenas = (meta.actos ?? []).reduce((s, a) => s + (a.capitulos ?? []).reduce((t, c) => t + (c.escenas?.length ?? 0), 0), 0);
        const fila = h(
          "div",
          { class: "lib-row", tabIndex: 0, role: "button" },
          h("div", { class: "lib-cover" }, h("span", null, Array.from((meta.titulo ?? r.carpeta).trim())[0]?.toUpperCase() ?? "?")),
          h(
            "div",
            { class: "lib-main" },
            h("div", { class: "lib-title" }, meta.titulo || r.carpeta),
            h("div", { class: "lib-meta" }, [meta.autor, meta.genero, `${escenas} escenas`].filter(Boolean).join(" · ")),
          ),
          h(
            "div",
            { class: "lib-stats" },
            h("span", null, `${num(palabras)} palabras`),
            obj ? h("span", { class: "meter" }, h("span", { class: "meter-fill", style: `width:${Math.min(100, (palabras / obj) * 100)}%` })) : null,
          ),
          h("span", { class: "lib-date" }, fechaCorta(r.modificado)),
          btn(null, {
            icon: "more",
            variant: "ghost",
            size: "icon-sm",
            title: "Acciones",
            onclick: (e) => {
              e.stopPropagation();
              menu(
                [
                  { texto: "Abrir", icono: "book", accion: () => alAbrir(r.carpeta) },
                  { texto: "Mostrar en Finder", icono: "folder", accion: () => void revealItemInDir(r.ruta) },
                  { separador: true },
                  { texto: "Mover a la papelera", icono: "trash", peligro: true, accion: async () => {
                    if (!(await confirmar("Eliminar novela", `«${meta.titulo || r.carpeta}» se moverá a la carpeta .papelera de la biblioteca.`))) return;
                    await api.novelaEliminar(r.carpeta);
                    toast("Novela movida a la papelera", "ok");
                    await cargar();
                  } },
                ],
                e.currentTarget as HTMLElement,
              );
            },
          }),
        );
        fila.addEventListener("click", () => alAbrir(r.carpeta));
        fila.addEventListener("keydown", (e) => e.key === "Enter" && alAbrir(r.carpeta));
        return fila;
      }),
    );
  };

  const crear = async (titulo: string, autor: string, genero: string, plantilla: Plantilla) => {
    try {
      const carpeta = await api.novelaCrear(titulo || "Sin título");
      const archivos = plantilla === "ejemplo" ? novelaEjemplo() : nuevaDesdePlantilla(titulo, autor, genero, plantilla);
      for (const [ruta, contenido] of Object.entries(archivos)) await api.archivoEscribir(carpeta, ruta, contenido);
      alAbrir(carpeta);
    } catch (e) {
      toast(`No se pudo crear la novela: ${errMsg(e)}`, "error");
    }
  };

  const dialogoNueva = () => {
    const m = modal("Nueva novela");
    const titulo = h("input", { class: "input", placeholder: "Título provisional" });
    const autor = h("input", { class: "input", value: localStorage.getItem("autor") ?? "" });
    const genero = h("input", { class: "input", placeholder: "p. ej. fantasía, novela negra…" });
    let plantilla: Plantilla = "tres-actos";
    m.body.append(
      campo("Título", titulo),
      h("div", { class: "form-grid" }, campo("Autor/a", autor), campo("Género", genero)),
      campo(
        "Estructura inicial",
        select<Plantilla>(
          [
            { valor: "tres-actos", texto: "Tres actos (9 capítulos)" },
            { valor: "vacia", texto: "Vacía (un capítulo)" },
            { valor: "ejemplo", texto: "Novela de ejemplo con Codex" },
          ],
          plantilla,
          (v) => (plantilla = v),
        ),
      ),
    );
    const ir = () => {
      localStorage.setItem("autor", autor.value.trim());
      m.close();
      void crear(titulo.value.trim() || "Sin título", autor.value.trim(), genero.value.trim(), plantilla);
    };
    titulo.addEventListener("keydown", (e) => e.key === "Enter" && ir());
    m.footer.append(btn("Cancelar", { variant: "text", onclick: () => m.close() }), btn("Crear novela", { variant: "primary", onclick: ir }));
    window.setTimeout(() => titulo.focus(), 10);
  };

  const importar = async () => {
    const ruta = await abrirDialogo({
      multiple: false,
      filters: [{ name: "Novela", extensions: ["opennovel", "json", "md", "markdown", "txt"] }],
    });
    if (!ruta || Array.isArray(ruta)) return;
    try {
      const texto = await api.externoLeer(ruta);
      const nombre = ruta.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
      let archivos: Record<string, string>;
      if (/\.(opennovel|json)$/i.test(ruta)) {
        const datos = JSON.parse(texto);
        if (!datos.archivos?.["novela.json"]) throw new Error("No es una copia de Open Novel");
        archivos = datos.archivos;
      } else archivos = desdeMarkdown(nombre, texto);
      const meta = JSON.parse(archivos["novela.json"]);
      const carpeta = await api.novelaCrear(meta.titulo || nombre);
      for (const [r, c] of Object.entries(archivos)) await api.archivoEscribir(carpeta, r, c);
      toast("Novela importada", "ok");
      alAbrir(carpeta);
    } catch (e) {
      toast(`No se pudo importar: ${errMsg(e)}`, "error");
    }
  };

  const cambiarCarpeta = async () => {
    const ruta = await abrirDialogo({ directory: true, multiple: false });
    if (!ruta || Array.isArray(ruta)) return;
    await api.bibliotecaFijarRaiz(ruta);
    await cargar();
  };

  accionesBiblioteca.nueva = dialogoNueva;
  accionesBiblioteca.importar = () => void importar();
  contenedor.replaceChildren(
    h(
      "div",
      { class: "shell is-library" },
      h(
        "aside",
        { class: "sidebar" },
        arrastrable(h("div", { class: "sb-drag" })),
        h("div", { class: "sb-head" }, h("div", { class: "sb-brand" }, h("span", { class: "sb-mark" }, icon("book")), h("span", null, "Open Novel"))),
        h("nav", { class: "nav" }, h("button", { type: "button", class: "nav-item is-active" }, icon("library"), h("span", null, "Biblioteca"))),
        h("div", { class: "grow" }),
        avisoActualizacion(),
        h("div", { class: "sb-foot" }, h("span", { class: "muted sb-version" }, "v0.1 · código abierto"), h("span", { class: "grow" }), btn(null, { icon: "settings", variant: "ghost", size: "icon-xs", title: "Ajustes", onclick: alAjustes })),
      ),
      h(
        "main",
        { class: "main" },
        arrastrable(h("header", { class: "titlebar" }, h("div", { class: "tb-title" }, h("span", { class: "tb-current" }, "Biblioteca")), h("div", { class: "tb-actions" }, btn("Importar", { icon: "import", variant: "ghost", size: "sm", onclick: () => void importar() }), btn("Nueva novela", { icon: "plus", variant: "primary", size: "sm", onclick: dialogoNueva })))),
        h(
          "div",
          { class: "content" },
          h(
            "div",
            { class: "page lib" },
            h("h1", { class: "page-title" }, "Tus novelas"),
            h("p", { class: "page-sub" }, "Cada novela es una carpeta de archivos Markdown en ", rutaEl, " ", h("button", { type: "button", class: "link", onclick: () => void cambiarCarpeta() }, "Cambiar")),
            lista,
          ),
        ),
      ),
    ),
  );
  void cargar();
}

// ── Plantillas ───────────────────────────────────────────────────────────

function nuevaDesdePlantilla(titulo: string, autor: string, genero: string, plantilla: Plantilla): Record<string, string> {
  const meta = metaNueva(titulo, autor);
  meta.genero = genero;
  if (plantilla === "tres-actos") {
    const def: [string, [string, string][]][] = [
      ["Acto I · Planteamiento", [["El mundo ordinario", "Presenta al protagonista en su vida cotidiana, su deseo y su carencia."], ["El incidente", "Algo rompe el equilibrio y plantea la pregunta dramática."], ["El umbral", "El protagonista decide (o es forzado a) entrar en el conflicto."]]],
      ["Acto II · Confrontación", [["Nuevas reglas", "Pruebas, aliados y enemigos en el mundo nuevo."], ["El punto medio", "Una revelación o victoria falsa cambia el rumbo."], ["Todo se derrumba", "Las fuerzas antagonistas aprietan; el protagonista lo pierde casi todo."]]],
      ["Acto III · Resolución", [["La noche oscura", "El protagonista afronta su herida y elige cambiar."], ["El clímax", "Confrontación final: la pregunta dramática se responde."], ["El nuevo equilibrio", "Consecuencias y la imagen final del mundo transformado."]]],
    ];
    let num = 0;
    meta.actos = def.map(([t, caps]) => ({
      id: nuevoId("a"),
      titulo: t,
      capitulos: caps.map(([ct, resumen]) => {
        num++;
        const c = capituloNuevo(ct);
        c.titulo = ct;
        c.escenas[0].titulo = `Escena ${num}.1`;
        c.escenas[0].resumen = resumen;
        return c;
      }),
    }));
  }
  return { "novela.json": serializar.meta(meta) };
}

/** Importa Markdown/texto: `#`/`##` → capítulos; `* * *` o `***` → escenas. */
function desdeMarkdown(nombre: string, texto: string): Record<string, string> {
  const meta = metaNueva(nombre);
  const archivos: Record<string, string> = {};
  const acto: Acto = { id: nuevoId("a"), titulo: "Acto I", capitulos: [] };
  const bloques = texto.replace(/\r\n/g, "\n").split(/^#{1,2}\s+(.+)$/m);
  // bloques: [prefacio, titulo1, cuerpo1, titulo2, cuerpo2, …]
  const pares: [string, string][] = [];
  if (bloques[0].trim()) pares.push(["Capítulo 1", bloques[0]]);
  for (let i = 1; i < bloques.length; i += 2) pares.push([bloques[i].trim(), bloques[i + 1] ?? ""]);
  if (!pares.length) pares.push(["Capítulo 1", texto]);
  for (const [titulo, cuerpo] of pares) {
    const c = capituloNuevo(titulo);
    c.escenas = cuerpo
      .split(/^\s*(?:\*\s*\*\s*\*|-{3,}|#)\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s, k) => {
        const e = escenaNueva(`Escena ${k + 1}`);
        e.estado = "borrador";
        archivos[`escenas/${e.id}.md`] = s + "\n";
        return e;
      });
    if (!c.escenas.length) c.escenas = [escenaNueva("Escena 1")];
    acto.capitulos.push(c);
  }
  meta.actos = [acto];
  archivos["novela.json"] = serializar.meta(meta);
  return archivos;
}

// i18n-ignorar: contenido de la novela de ejemplo, no es interfaz.
function novelaEjemplo(): Record<string, string> {
  const meta = metaNueva("El faro de Aldara", "Open Novel");
  meta.genero = "Fantasía costera, misterio";
  meta.sinopsis =
    "Nerea, la última farera de Aldara, descubre que la luz del faro no guía a los barcos: mantiene dormido algo que vive bajo la bahía. Cuando el consejo del puerto decide apagarlo para ahorrar aceite, Nerea tendrá siete noches para demostrarlo, con la ayuda de un cartógrafo forastero que sabe más de lo que dice.";
  meta.estilo = "Tercera persona limitada, pasado. Prosa sensorial y salada, frases cortas en la tensión. Diálogos sobrios. Nada de anacronismos modernos.";
  meta.objetivoPalabras = 60000;
  const archivos: Record<string, string> = {};
  const x = (nombre: string, tipo: EntradaCodex["tipo"], datos: Partial<EntradaCodex>): EntradaCodex => {
    const e = { ...entradaNueva(nombre, tipo), ...datos };
    archivos[`codex/${e.id}.md`] = serializar.codex(e);
    return e;
  };
  const nerea = x("Nerea Salvat", "personaje", {
    alias: ["Nerea", "la farera"],
    incluir: "siempre",
    color: "#0053fd",
    etiquetas: ["protagonista"],
    campos: [
      { clave: "Edad", valor: "27" },
      { clave: "Deseo", valor: "Que el pueblo crea en lo que ella ve" },
      { clave: "Herida", valor: "Su padre desapareció en la bahía una noche sin luz" },
    ],
    descripcion: "Hija del anterior farero. Manos agrietadas por el frío y el aceite, pelo cortado a cuchillo. Habla poco y observa mucho; cuenta los segundos entre destellos sin darse cuenta. Desconfía del consejo del puerto y de cualquiera que llegue por mar.",
  });
  const tomas = x("Tomás Ibarra", "personaje", {
    alias: ["Tomás", "el cartógrafo"],
    color: "#c25e2c",
    campos: [{ clave: "Ocupación", valor: "Cartógrafo de la Corona" }],
    descripcion: "Forastero de ciudad, educado y curioso, con tinta en los puños de la camisa. Llega para cartografiar la costa, pero sus mapas antiguos marcan la bahía de Aldara con un símbolo que nadie sabe leer.",
  });
  const faro = x("El faro de Aldara", "lugar", {
    alias: ["el faro", "la torre"],
    descripcion: "Torre de piedra gris de ciento doce escalones sobre el acantilado norte. La lámpara gira con un mecanismo de relojería que hay que dar cuerda cada cuatro horas. En la base, una puerta sellada con plomo que nadie recuerda haber abierto.",
  });
  x("El Durmiente", "lore", {
    alias: ["lo que duerme", "la Bestia de la bahía"],
    incluir: "menciones",
    descripcion: "Leyenda de los pescadores: algo inmenso duerme bajo la bahía y la luz del faro lo mantiene en sueño. Los viejos dicen que cuando el mar se queda en silencio, está soñando.",
  });
  x("El consejo del puerto", "otro", {
    alias: ["el consejo"],
    descripcion: "Tres armadores y el alcalde. Quieren apagar el faro durante el invierno para ahorrar aceite de ballena.",
  });
  const acto1: Acto = { id: nuevoId("a"), titulo: "Acto I", capitulos: [] };
  const c1 = capituloNuevo("La última luz");
  const e1 = c1.escenas[0];
  e1.titulo = "La cuerda de las cuatro";
  e1.pov = nerea.id;
  e1.estado = "borrador";
  e1.resumen = "Nerea da cuerda al mecanismo del faro de madrugada y ve un barco sin luces entrar en la bahía. Al bajar encuentra una carta del consejo del puerto: apagarán el faro en siete noches.";
  archivos[`escenas/${e1.id}.md`] =
    "El mecanismo tenía su propio corazón. Nerea lo oía antes de verlo, un tic grave y paciente que subía por los ciento doce escalones como si el faro respirase.\n\nA las cuatro en punto apoyó las dos manos en la manivela y empujó. El frío le mordió los nudillos agrietados. Arriba, la lámpara giró y el haz barrió la bahía: agua negra, espuma, la línea quebrada de los acantilados.\n\nY un barco.\n\nNo llevaba faroles. Se deslizaba hacia el puerto con las velas recogidas, tan silencioso que parecía dibujado sobre el agua. Nerea contó los segundos entre destellos —uno, dos, tres— y cuando la luz volvió a pasar, el barco ya no estaba.\n";
  const e2 = escenaNueva("El forastero");
  e2.pov = nerea.id;
  e2.resumen = "En la taberna del puerto, Nerea conoce a Tomás Ibarra, un cartógrafo que pregunta demasiado por el faro y por la puerta sellada de su base.";
  c1.escenas.push(e2);
  const c2 = capituloNuevo("Mapas antiguos");
  c2.escenas[0].titulo = "El símbolo";
  c2.escenas[0].pov = tomas.id;
  c2.escenas[0].resumen = "Tomás enseña a Nerea un mapa de hace doscientos años donde la bahía aparece marcada con un ojo cerrado.";
  acto1.capitulos.push(c1, c2);
  meta.actos = [acto1];
  void faro;
  archivos["notas/" + nuevoId("n") + ".md"] = serializar.nota({
    id: "",
    titulo: "Ideas sueltas",
    fijada: true,
    modificado: Date.now(),
    cuerpo: "- ¿El padre de Nerea abrió la puerta sellada?\n- El barco sin luces podría ser de contrabandistas… o algo peor.\n- Cada noche sin faro, el mar se queda un poco más en silencio.",
  });
  archivos["novela.json"] = serializar.meta(meta);
  return archivos;
}
// i18n-fin
