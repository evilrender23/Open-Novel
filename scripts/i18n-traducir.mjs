// Traduce con Claude Code CLI los textos de src/i18n/fuente.json que falten en
// cada diccionario src/i18n/<código>.json. Solo pide los nuevos, así que se
// puede relanzar tras añadir textos a la interfaz:
//
//   node scripts/i18n-extraer.mjs && node scripts/i18n-traducir.mjs [en fr …]

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const dir = path.join(raiz, "src/i18n");
const fuente = JSON.parse(fs.readFileSync(path.join(dir, "fuente.json"), "utf8"));

const IDIOMAS = {
  en: "English (US)",
  pt: "Portuguese (European, understandable in Brazil)",
  fr: "French",
  it: "Italian",
  de: "German",
  ca: "Catalan",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  tr: "Turkish",
  ja: "Japanese",
  zh: "Simplified Chinese",
  ko: "Korean",
};

const LOTE = 160;
const PARALELO = 6;

const SISTEMA = (idioma) => `You localize the user interface of "Open Novel", an open-source desktop app for writing novels (a NovelCrafter clone with AI helpers and a Claude Code agent mode). The source strings are Spanish. Translate each one into ${idioma}.

Rules:
- Return ONLY a JSON object whose keys are the exact Spanish strings and whose values are the translations. No markdown fences, no comments.
- Keep every placeholder {0}, {1}… exactly (you may reorder them as the grammar requires).
- Keep symbols, punctuation style, ellipses (…), arrows, keyboard shortcuts (⌘K, ⇧, ⌥, Intro→the local name of the Enter key), emoji and leading/trailing spaces.
- Do not translate product or technical names: Open Novel, NovelCrafter, Claude Code, Claude, Codex, Markdown, Git, Hermes, Ollama, OpenRouter, OpenAI, Anthropic, API, JSON, EPUB, HTML, CLI, MIT.
- Use the usual fiction-writing terms of the target language (scene, chapter, act, beat, draft, outline, point of view, worldbuilding…). Keep "beat" as the fiction term commonly used in that language.
- Short UI labels stay short. Use the interface register normal in that language (e.g. "du" in German apps is fine, "tú" style informal for Spanish-like).
- Some strings are fragments of longer sentences; translate them so they still work as fragments.
- Example novel content, banned AI cliché lists and literary text: translate naturally into ${idioma} (the cliché list should become the equivalent clichés in ${idioma}).`;

function claude(sistema, entrada) {
  return new Promise((resolve, reject) => {
    const p = spawn("claude", ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--model", "sonnet", "--system-prompt", sistema], {
      cwd: process.env.TMPDIR || "/tmp",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => {
      try {
        const r = JSON.parse(out);
        if (r.is_error) return reject(new Error(r.result));
        resolve(r.result);
      } catch {
        reject(new Error(`claude salió con ${c}: ${err || out}`.slice(0, 400)));
      }
    });
    p.stdin.end(entrada);
  });
}

function marcadores(s) {
  return (s.match(/\{\d+\}/g) ?? []).sort().join();
}

async function traducirLote(codigo, lote) {
  const respuesta = await claude(SISTEMA(IDIOMAS[codigo]), JSON.stringify(lote, null, 1));
  // Se queda con el último objeto JSON válido de la respuesta (a veces se corrige a sí mismo).
  const limpio = respuesta.replace(/```(?:json)?/g, "");
  let obj = null;
  for (const m of limpio.matchAll(/^\s*\{/gm)) {
    const resto = limpio.slice(m.index);
    for (let fin = resto.lastIndexOf("}"); fin > 0 && !obj; fin = resto.lastIndexOf("}", fin - 1)) {
      try {
        obj = JSON.parse(resto.slice(0, fin + 1));
      } catch {
        /* probar un cierre anterior */
      }
    }
    if (obj && lote.some((k) => typeof obj[k] === "string" && obj[k].trim())) break;
    obj = null;
  }
  if (!obj) throw new Error(`respuesta sin JSON válido: ${respuesta.slice(0, 120)}`);
  const bien = {};
  for (const k of lote) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() && marcadores(v) === marcadores(k)) bien[k] = v;
  }
  return bien;
}

const pedidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(IDIOMAS);
const tareas = [];
for (const codigo of pedidos) {
  const ruta = path.join(dir, `${codigo}.json`);
  const dic = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, "utf8")) : {};
  const faltan = fuente.filter((k) => !(k in dic));
  for (let i = 0; i < faltan.length; i += LOTE) tareas.push({ codigo, ruta, dic, lote: faltan.slice(i, i + LOTE) });
  console.log(`${codigo}: faltan ${faltan.length}`);
}

let hechas = 0;
async function trabajador() {
  for (let t = tareas.shift(); t; t = tareas.shift()) {
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const r = await traducirLote(t.codigo, t.lote);
        Object.assign(t.dic, r);
        // Ordenado como la fuente para que los diffs sean legibles.
        const ordenado = Object.fromEntries(fuente.filter((k) => k in t.dic).map((k) => [k, t.dic[k]]));
        fs.writeFileSync(t.ruta, JSON.stringify(ordenado, null, 1) + "\n");
        console.log(`${t.codigo}: +${Object.keys(r).length}/${t.lote.length} (${++hechas})`);
        break;
      } catch (e) {
        console.error(`${t.codigo}: intento ${intento} falló: ${e.message.slice(0, 200)}`);
      }
    }
  }
}
await Promise.all(Array.from({ length: PARALELO }, trabajador));
// Limpia las claves que ya no existen en la interfaz.
for (const codigo of pedidos) {
  const ruta = path.join(dir, `${codigo}.json`);
  if (!fs.existsSync(ruta)) continue;
  const dic = JSON.parse(fs.readFileSync(ruta, "utf8"));
  const limpio = Object.fromEntries(fuente.filter((k) => k in dic).map((k) => [k, dic[k]]));
  fs.writeFileSync(ruta, JSON.stringify(limpio, null, 1) + "\n");
  console.log(`${codigo}: ${Object.keys(limpio).length}/${fuente.length}`);
}
