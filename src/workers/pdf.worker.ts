/// <reference lib="webworker" />
// Worker de traitement : exécute les fonctions pures de core/pdf hors du fil
// principal. Chaque module est chargé à la demande.
import qpdfWasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';
import { setQpdfWasmUrl } from '@/core/qpdf';
import type { CallMessage, ReplyMessage } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

setQpdfWasmUrl(qpdfWasmUrl);

const modules = import.meta.glob<Record<string, unknown>>('../core/pdf/*.ts');

function transferables(value: unknown, out: Transferable[] = []): Transferable[] {
  if (value instanceof Uint8Array) {
    if (!out.includes(value.buffer as ArrayBuffer)) out.push(value.buffer as ArrayBuffer);
  } else if (value instanceof ArrayBuffer) {
    if (!out.includes(value)) out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => transferables(v, out));
  } else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach((v) => transferables(v, out));
  }
  return out;
}

self.onmessage = async (event: MessageEvent<CallMessage>) => {
  const { id, module, fn, params } = event.data;
  const reply = (message: ReplyMessage, transfer: Transferable[] = []) => self.postMessage(message, transfer);
  try {
    const load = modules[`../core/pdf/${module}.ts`];
    if (!load) throw new Error(`Module inconnu : ${module}`);
    const mod = await load();
    const run = mod[fn] as ((p: unknown, progress: (r: number, l?: string) => void) => unknown) | undefined;
    if (typeof run !== 'function') throw new Error(`Fonction inconnue : ${module}.${fn}`);
    let last = 0;
    const result = await run(params, (ratio, label) => {
      const now = Date.now();
      if (now - last < 60 && ratio < 1) return; // pas plus d'une quinzaine de messages par seconde
      last = now;
      reply({ id, type: 'progress', ratio, label });
    });
    reply({ id, type: 'done', result }, transferables(result));
  } catch (err) {
    const e = err as Error & { code?: string };
    reply({ id, type: 'error', name: e?.name ?? 'Error', message: e?.message ?? String(err), code: e?.code });
  }
};
