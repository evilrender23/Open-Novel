// Mock del IPC de Tauri para previsualizar la interfaz en un navegador
// (`npx vite preview`). Simula la biblioteca en localStorage, eventos de
// streaming y una respuesta falsa de Claude Code / proveedores HTTP.
// Uso: inyectar antes de cargar la página (CDP Page.addScriptToEvaluateOnNewDocument).
(() => {
  const FS_KEY = "mock-fs";
  const fs = JSON.parse(localStorage.getItem(FS_KEY) || "{}");
  const guardar = () => localStorage.setItem(FS_KEY, JSON.stringify(fs));
  const raiz = "/Users/demo/Documents/Open Novel";
  const callbacks = new Map();
  let siguiente = 1;
  const oyentes = {}; // evento -> [id callback]

  const emitir = (evento, payload) => {
    for (const id of oyentes[evento] || []) callbacks.get(id)?.({ event: evento, id: 0, payload });
  };

  const archivosDe = (c) => Object.keys(fs).filter((k) => k.startsWith(c + "/"));

  const respuestaFalsa = (prompt) =>
    "La niebla se levantó despacio sobre la bahía, como si el mar exhalara después de contener el aliento demasiado tiempo. Nerea apoyó la frente en el cristal frío de la linterna y esperó.\n\nAbajo, en el puerto, alguien había encendido una lámpara de aceite. Una sola. Parpadeó tres veces y se apagó.";

  const handlers = {
    ajustes_leer: () => localStorage.getItem("mock-ajustes"),
    ajustes_guardar: ({ json }) => localStorage.setItem("mock-ajustes", json),
    biblioteca_raiz: () => raiz,
    biblioteca_fijar_raiz: () => null,
    novelas_listar: () => {
      const carpetas = [...new Set(Object.keys(fs).map((k) => k.split("/")[0]))].filter((c) => fs[c + "/novela.json"]);
      return carpetas.map((c) => ({ carpeta: c, ruta: `${raiz}/${c}`, meta: fs[c + "/novela.json"], modificado: Date.now() }));
    },
    novela_crear: ({ titulo }) => {
      let n = titulo, i = 2;
      while (Object.keys(fs).some((k) => k.startsWith(n + "/"))) n = `${titulo} ${i++}`;
      return n;
    },
    novela_eliminar: ({ carpeta }) => {
      for (const k of archivosDe(carpeta)) delete fs[k];
      guardar();
    },
    novela_leer: ({ carpeta }) => {
      const out = {};
      for (const k of archivosDe(carpeta)) {
        const rel = k.slice(carpeta.length + 1);
        if (!rel.startsWith("historial/")) out[rel] = fs[k];
      }
      if (!out["novela.json"]) throw "La carpeta no contiene una novela (falta novela.json)";
      return out;
    },
    novela_ruta: ({ carpeta }) => `${raiz}/${carpeta}`,
    archivo_leer: ({ carpeta, ruta }) => fs[`${carpeta}/${ruta}`] ?? null,
    archivo_escribir: ({ carpeta, ruta, contenido }) => {
      fs[`${carpeta}/${ruta}`] = contenido;
      guardar();
    },
    archivo_borrar: ({ carpeta, ruta }) => {
      delete fs[`${carpeta}/${ruta}`];
      guardar();
    },
    archivo_listar: ({ carpeta, sub }) => archivosDe(carpeta).map((k) => k.slice(carpeta.length + 1)).filter((r) => r.startsWith(sub + "/")),
    exportar_texto: () => null,
    exportar_binario: () => null,
    externo_leer: () => "",
    claude_info: () => ({ ruta: "/Users/demo/.local/bin/claude", version: "2.1.317 (Claude Code)" }),
    claude_cancelar: () => true,
    llm_cancelar: () => true,
    llm_get: () => JSON.stringify({ data: [] }),
    claude_ejecutar: async ({ id, args, carpeta, entrada }) => {
      const linea = (o) => emitir("claude://linea", { id, linea: JSON.stringify(o) });
      const espera = (ms) => new Promise((r) => setTimeout(r, ms));
      const agente = carpeta !== null;
      linea({ type: "system", subtype: "init", session_id: "mock-sesion-1", model: "claude-sonnet", permissionMode: "acceptEdits" });
      if (agente) {
        await null;
        linea({ type: "assistant", message: { content: [{ type: "text", text: "Voy a revisar la estructura y las escenas de la novela." }] } });
        linea({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "TodoWrite", input: { todos: [
          { content: "Leer novela.json y CLAUDE.md", status: "completed" },
          { content: "Revisar las escenas del capítulo 1", status: "in_progress" },
          { content: "Crear entradas del Codex que falten", status: "pending" },
        ] } }] } });
        linea({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
        linea({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: `${raiz}/${carpeta}/novela.json` } }] } });
        await null;
        linea({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "{ ... }" }] } });
        linea({ type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Grep", input: { pattern: "barco", path: `${raiz}/${carpeta}/escenas` } }] } });
        await null;
        linea({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "escenas/…md: Y un barco." }] } });
        const texto = "He revisado el capítulo 1. **Dos observaciones:**\n\n1. El barco sin luces aparece en la primera escena pero no se menciona en el resumen de «El forastero»; conviene que Tomás pregunte por él.\n2. Falta una entrada de Codex para *la taberna del puerto*.\n\n¿Quieres que la cree?";
        for (const trozo of texto.match(/.{1,12}/gs)) {
          linea({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: trozo } } });
          await null;
        }
        linea({ type: "assistant", message: { content: [{ type: "text", text: texto }] } });
        linea({ type: "result", subtype: "success", is_error: false, result: texto, session_id: "mock-sesion-1", total_cost_usd: 0.0421, duration_ms: 8400, num_turns: 4 });
      } else {
        const texto = respuestaFalsa(entrada);
        for (const trozo of texto.match(/.{1,8}/gs)) {
          linea({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: trozo } } });
          await null;
        }
        linea({ type: "result", subtype: "success", is_error: false, result: texto });
      }
      emitir("claude://fin", { id, codigo: 0, cancelado: false, stderr: "" });
    },
    llm_stream: async ({ id }) => {
      emitir("llm://fin", { id, estado: 401, error: '{"error":{"message":"invalid x-api-key"}}', cancelado: false });
    },
    "plugin:event|listen": ({ event, handler }) => {
      (oyentes[event] ||= []).push(handler);
      return siguiente++;
    },
    "plugin:event|unlisten": () => null,
    "plugin:window|start_dragging": () => null,
    "plugin:window|toggle_maximize": () => null,
    "plugin:opener|open_path": () => null,
    "plugin:opener|reveal_item_in_dir": () => null,
    "plugin:dialog|save": () => null,
    "plugin:dialog|open": () => null,
  };

  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      const f = handlers[cmd];
      if (!f) throw `mock: comando no simulado ${cmd}`;
      await null;
      return f(args || {});
    },
    transformCallback: (cb) => {
      const id = siguiente++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
})();
