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

Otros: paleta de comandos **⌘K**, atajos ⌘1…⌘8, ⌘, (ajustes), ⌘⇧F (foco), ⌘S, tema
claro/oscuro/sistema con acentos, tipografía del editor configurable, estadísticas
de palabras diarias y objetivo de la novela.

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
