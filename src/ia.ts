// Generación de texto con streaming para todos los proveedores.
// - Claude Code CLI: `claude -p` sin herramientas, con system prompt propio.
// - Anthropic: API de Messages (SSE).
// - OpenAI / OpenRouter / Ollama / compatibles: chat/completions (SSE).

import { api, iniciarEventos, nuevoId, suscribir, type FinClaude, type FinLlm } from "./api";
import { ajustes, proveedor, type Funcion } from "./ajustes";

export interface Mensaje {
  rol: "usuario" | "asistente";
  texto: string;
}

export interface Peticion {
  modelo: string; // "idProveedor::modelo"
  sistema: string;
  mensajes: Mensaje[];
  temperatura?: number;
  maxTokens?: number;
  onTexto?: (delta: string, total: string) => void;
}

export interface Generacion {
  promesa: Promise<string>;
  cancelar: () => void;
}

export class ErrorIA extends Error {}

export function modeloPara(f: Funcion, preferido?: string): string {
  return preferido || ajustes.modelos[f] || ajustes.modelos.escritura;
}

/** Lanza una generación. `cancelar()` corta el proceso o la conexión. */
export function generar(p: Peticion): Generacion {
  const [pid, modelo] = p.modelo.split("::");
  const prov = proveedor(pid);
  if (!prov || !modelo) {
    return {
      promesa: Promise.reject(new ErrorIA("No hay un modelo configurado para esta función. Revisa Ajustes → Inteligencia artificial.")),
      cancelar: () => {},
    };
  }
  const id = nuevoId("g");
  let total = "";
  const emitir = (d: string) => {
    if (!d) return;
    total += d;
    p.onTexto?.(d, total);
  };

  if (prov.tipo === "claude-code") {
    const promesa = (async () => {
      await iniciarEventos();
      return new Promise<string>((resolve, reject) => {
        let final = "";
        let error = "";
        suscribir<string, FinClaude>(
          id,
          (linea) => {
            let o: any;
            try {
              o = JSON.parse(linea);
            } catch {
              return;
            }
            if (o.type === "stream_event" && o.event?.type === "content_block_delta" && o.event.delta?.type === "text_delta") {
              emitir(o.event.delta.text ?? "");
            } else if (o.type === "result") {
              final = typeof o.result === "string" ? o.result : "";
              if (o.is_error) error = final || o.subtype || "Error de Claude Code";
            }
          },
          (fin) => {
            if (fin.cancelado) return resolve(total);
            if (error) return reject(new ErrorIA(error));
            if (fin.codigo !== 0 && !total && !final) {
              return reject(new ErrorIA(fin.stderr.trim() || `Claude Code terminó con código ${fin.codigo}`));
            }
            if (!total && final) emitir(final);
            resolve(total || final);
          },
        );
        const args = [
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--tools",
          "",
          "--strict-mcp-config",
          "--no-session-persistence",
          "--model",
          modelo,
          "--system-prompt",
          p.sistema || "Eres un asistente de escritura creativa.",
        ];
        api
          .claudeEjecutar({ id, args, carpeta: null, entrada: aplanarConversacion(p.mensajes), ruta: ajustes.claudeRuta })
          .catch((e) => reject(new ErrorIA(String(e))));
      });
    })();
    return { promesa, cancelar: () => void api.claudeCancelar(id) };
  }

  // Proveedores HTTP
  const temperatura = p.temperatura ?? ajustes.temperatura;
  const maxTokens = p.maxTokens ?? ajustes.maxTokens;
  let url: string;
  let cabeceras: Record<string, string> = { "content-type": "application/json" };
  let cuerpo: unknown;
  const baseUrl = (prov.url || "").replace(/\/+$/, "");
  if (prov.tipo === "anthropic") {
    url = `${baseUrl || "https://api.anthropic.com/v1"}/messages`;
    cabeceras = { ...cabeceras, "x-api-key": prov.clave, "anthropic-version": "2023-06-01" };
    cuerpo = {
      model: modelo,
      system: p.sistema,
      max_tokens: maxTokens,
      temperature: temperatura,
      stream: true,
      messages: unirConsecutivos(p.mensajes).map((m) => ({ role: m.rol === "usuario" ? "user" : "assistant", content: m.texto })),
    };
  } else {
    url = `${baseUrl}/chat/completions`;
    if (prov.clave) cabeceras.authorization = `Bearer ${prov.clave}`;
    if (prov.tipo === "openrouter") {
      cabeceras["HTTP-Referer"] = "https://github.com/open-novel";
      cabeceras["X-Title"] = "Open Novel";
    }
    cuerpo = {
      model: modelo,
      stream: true,
      temperature: temperatura,
      max_tokens: maxTokens,
      messages: [
        ...(p.sistema ? [{ role: "system", content: p.sistema }] : []),
        ...p.mensajes.map((m) => ({ role: m.rol === "usuario" ? "user" : "assistant", content: m.texto })),
      ],
    };
  }

  const promesa = (async () => {
    await iniciarEventos();
    return new Promise<string>((resolve, reject) => {
      let buffer = "";
      let errorSse = "";
      const procesar = (linea: string) => {
        const l = linea.trim();
        if (!l.startsWith("data:")) return;
        const datos = l.slice(5).trim();
        if (!datos || datos === "[DONE]") return;
        let o: any;
        try {
          o = JSON.parse(datos);
        } catch {
          return;
        }
        if (prov.tipo === "anthropic") {
          if (o.type === "content_block_delta" && o.delta?.type === "text_delta") emitir(o.delta.text ?? "");
          else if (o.type === "error") errorSse = o.error?.message ?? "Error de Anthropic";
        } else {
          if (o.error) errorSse = o.error.message ?? JSON.stringify(o.error);
          const d = o.choices?.[0]?.delta?.content;
          if (typeof d === "string") emitir(d);
        }
      };
      suscribir<string, FinLlm>(
        id,
        (texto) => {
          buffer += texto;
          const lineas = buffer.split(/\r?\n/);
          buffer = lineas.pop() ?? "";
          for (const l of lineas) procesar(l);
        },
        (fin) => {
          if (buffer) procesar(buffer);
          if (fin.cancelado) return resolve(total);
          if (fin.error) return reject(new ErrorIA(mensajeHttp(fin.estado, fin.error)));
          if (errorSse) return reject(new ErrorIA(errorSse));
          resolve(total);
        },
      );
      api.llmStream({ id, url, cabeceras, cuerpo: JSON.stringify(cuerpo) }).catch((e) => reject(new ErrorIA(String(e))));
    });
  })();
  return { promesa, cancelar: () => void api.llmCancelar(id) };
}

function mensajeHttp(estado: number, error: string): string {
  let detalle = error;
  try {
    const o = JSON.parse(error);
    detalle = o.error?.message ?? o.message ?? error;
  } catch {
    /* texto plano */
  }
  if (estado === 401 || estado === 403) return `Clave de API no válida o sin permiso (${estado}). ${detalle}`;
  if (estado === 429) return `Límite de uso alcanzado (429). ${detalle}`;
  if (estado === 404) return `Modelo o URL no encontrados (404). ${detalle}`;
  return estado ? `HTTP ${estado}: ${detalle}` : detalle;
}

/** Anthropic exige alternancia estricta usuario/asistente. */
function unirConsecutivos(ms: Mensaje[]): Mensaje[] {
  const out: Mensaje[] = [];
  for (const m of ms) {
    const ult = out[out.length - 1];
    if (ult && ult.rol === m.rol) ult.texto += "\n\n" + m.texto;
    else out.push({ ...m });
  }
  if (out[0]?.rol === "asistente") out.unshift({ rol: "usuario", texto: "(continúa)" });
  return out;
}

/** Claude Code recibe un único prompt por stdin: se aplana el historial. */
function aplanarConversacion(ms: Mensaje[]): string {
  if (ms.length === 1) return ms[0].texto;
  const previos = ms.slice(0, -1).map((m) => `<${m.rol === "usuario" ? "usuario" : "asistente"}>\n${m.texto}\n</${m.rol === "usuario" ? "usuario" : "asistente"}>`);
  return `Historial de la conversación:\n\n${previos.join("\n\n")}\n\nNuevo mensaje del usuario:\n\n${ms[ms.length - 1].texto}`;
}

/** Lista los modelos del proveedor (para el botón "Obtener modelos"). */
export async function listarModelos(pid: string): Promise<string[]> {
  const prov = proveedor(pid);
  if (!prov) return [];
  if (prov.tipo === "claude-code") return ["sonnet", "opus", "haiku"];
  const base = prov.url.replace(/\/+$/, "");
  const cab: Record<string, string> = {};
  if (prov.tipo === "anthropic") {
    cab["x-api-key"] = prov.clave;
    cab["anthropic-version"] = "2023-06-01";
  } else if (prov.clave) cab.authorization = `Bearer ${prov.clave}`;
  const json = JSON.parse(await api.llmGet(`${base}/models`, cab));
  const lista: any[] = json.data ?? json.models ?? [];
  return lista.map((m) => String(m.id ?? m.name)).filter(Boolean).sort();
}
