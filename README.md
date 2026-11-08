# Open Novel

Entorno de escritura de novelas **de código abierto**, inspirado en NovelCrafter, con
la interfaz del sistema de diseño de Hermes. Planifica, escribe, construye tu mundo
en el **Codex** y trabaja con IA — incluido un **modo agente con Claude Code CLI**
que edita directamente los archivos de tu novela.

Aplicación de escritorio para macOS, Windows y Linux (Tauri 2 + TypeScript sin
framework + Rust).

## Funciones

| Área | Qué hace |
| --- | --- |
| **Biblioteca** | Varias novelas; plantillas (vacía, tres actos, ejemplo); importar Markdown/texto o copias `.opennovel`; papelera recuperable. |
| **Planificar** | Cuadrícula por actos y capítulos con tarjetas de escena (arrastrar y soltar, estado, PDV, resumen editable), esquema editable y **matriz** escenas × Codex. Resumir todas las escenas con IA. |
| **Escribir** | Editor de escenas con **resaltado de menciones del Codex**, título/estado/PDV, panel de resumen, objetivo de palabras, etiquetas y entradas detectadas. **Beats de escena → prosa**, *Continuar* (⌘↵), y sobre la selección: reescribir, expandir, acortar, «mostrar, no contar» o instrucción libre. Propuestas en streaming con aceptar / reintentar / pedir cambios. Historial de instantáneas, modo lectura con tarjetas del Codex, modo foco. |
| **Codex** | Personajes, lugares, objetos, lore, subtramas: alias, campos, color, etiquetas, relaciones recíprocas, **progresiones por escena** (la IA solo ve las que ocurren antes de la escena actual), reglas de contexto *siempre / al mencionarse / nunca*, apariciones y desarrollo con IA. |
| **Chat** | Conversaciones con contexto elegible: esquema, Codex (relevante o completo), escena o capítulo actual y notas. Insertar respuestas en la escena o guardarlas como nota. |
| **Agente** | **Claude Code CLI** trabajando en la carpeta de la novela: lee el manuscrito, escribe escenas, crea entradas del Codex, reorganiza `novela.json`. Muestra razonamiento, plan de tareas, herramientas y diffs en vivo; sesiones reanudables (`--resume`); modelo, permisos y esfuerzo configurables; recarga automática y **instantánea previa** de cada escena que modifica. |
| **Prompts** | Prompts integrados + personalizados con plantillas `{{variables}}` y bloques `{{#si x}}…{{/si}}`; prompt activo por acción, modelo por prompt y vista previa con datos reales. |
| **Exportar** | EPUB 3, HTML imprimible (→ PDF), Markdown, texto plano y copia de seguridad completa. |
| **IA** | Claude Code CLI (usa tu suscripción, sin clave), Anthropic, OpenAI, OpenRouter, Ollama y cualquier API compatible con OpenAI. Modelo por función (escritura, chat, Codex, resúmenes). |

Otros: **buscar y reemplazar** en la escena o en toda la novela (⌘F, ⌘⌥F, ⌘G; sin distinguir acentos por defecto), paleta de comandos **⌘K**, atajos ⌘1…⌘8, ⌘, (ajustes), ⌘⇧F (foco), ⌘S, tema
claro/oscuro/sistema con acentos, tipografía del editor configurable, estadísticas
de palabras diarias y objetivo de la novela.

## Idiomas

La interfaz está en 15 idiomas: español, inglés, portugués, francés, italiano, alemán,
catalán, neerlandés, polaco, ruso, ucraniano, turco, japonés, chino simplificado y
coreano (Ajustes → Apariencia → Idioma; por defecto, el del sistema).

El idioma en que **escribe la IA** es independiente: el de cada novela (Planificar →
Idioma de la prosa), el de la interfaz o uno fijo de una lista de ~37 idiomas y
variantes (o cualquier otro escrito a mano). Con «Forzar el idioma» se añade a todos los
prompts la orden de escribir solo en ese idioma aunque el contexto esté en otro.

Para traducir textos nuevos de la interfaz: `node scripts/i18n-extraer.mjs && node scripts/i18n-traducir.mjs`
(usa Claude Code CLI y solo pide los que faltan).

## Instalación (se actualiza sola desde `main`)

Un solo comando descarga el código de la rama `main`, lo compila en tu equipo y lo
instala. Si falta algo para compilar (Git, Node.js 20.19+, Rust y, según el sistema,
las Build Tools de C++, las herramientas de Xcode o WebKitGTK) lo instala solo,
avisando de que es una dependencia.

También instala **Claude Code CLI** (la IA por defecto y el modo agente) con el instalador
oficial de Anthropic en `~/.local/bin` (Windows: `%USERPROFILE%\.local\bin`), sin sudo. No hace
falta para compilar: si no se puede instalar, Open Novel se instala igual y te dice cómo
hacerlo luego. La primera vez hay que iniciar sesión: abre una terminal, ejecuta `claude` y entra
con tu cuenta (el instalador te lo recuerda si falta).

**macOS y Linux:**

```
curl -fsSL https://raw.githubusercontent.com/evilrender23/Open-Novel/main/instalar.sh | bash
```

**Windows** (PowerShell):

```
irm https://raw.githubusercontent.com/evilrender23/Open-Novel/main/instalar.ps1 | iex
```

| | Código y caché | App |
|---|---|---|
| macOS | `~/Library/Application Support/OpenNovel/codigo` | `/Applications/Open Novel.app` (o `~/Applications`) |
| Linux | `~/.local/share/OpenNovel/codigo` | `~/.local/share/OpenNovel/app` + `open-novel` en `~/.local/bin` |
| Windows | `%LOCALAPPDATA%\OpenNovel\codigo` | `%LOCALAPPDATA%\OpenNovel\app` (menú Inicio) |

Opciones: `--repo`, `--rama`, `--destino`, `--bin` (Windows: `-Repo`, `-Rama`, `-Destino`).

**Actualizaciones:** la app instalada guarda en `version.json` el commit del que salió.
Un minuto después de abrirse y cada 6 horas hace `git fetch` en `codigo/`; si hay commits
nuevos en `main`, relanza el instalador en segundo plano, que compila la versión nueva
mientras escribes (progreso en la barra lateral). Al terminar aparece **Reiniciar y
actualizar**; si cierras la app sin más, la próxima vez ya abre la nueva. En
**Ajustes → Actualizaciones** ves el commit instalado, puedes buscar a mano y desactivar
las automáticas. Registro en `registro/actualizacion.log` y `registro/compilacion.log`.
Tus novelas y ajustes no se tocan. Publicar una versión es solo hacer push a `main`.

## Formato en disco

Cada novela es una carpeta legible (puedes versionarla con Git o sincronizarla):

```
Mi novela/
  novela.json          metadatos + estructura actos → capítulos → escenas
  escenas/<id>.md      prosa de cada escena
  codex/<id>.md        entradas del Codex (frontmatter YAML + descripción)
  notas/<id>.md        notas
  prompts/<id>.md      prompts personalizados
  chats/  agente/      conversaciones y sesiones del agente
  historial/<escena>/  instantáneas
  CLAUDE.md            guía del formato para el agente
```

La biblioteca vive por defecto en `~/Documents/Open Novel` (configurable).

## Desarrollo

Requisitos: Node.js 20+, Rust estable y, para el modo agente,
[Claude Code](https://docs.claude.com/claude-code) instalado y con sesión iniciada.

```bash
npm install
npm run tauri dev      # app con recarga en caliente
npm run tauri build    # instaladores en src-tauri/target/release/bundle
```

Previsualizar solo la interfaz en un navegador (sin Rust): `npm run build`,
`npx vite preview`, e inyecta `scripts/mock-ipc.js` antes de cargar la página.

## Licencia

MIT. No afiliado a NovelCrafter ni a Anthropic.
