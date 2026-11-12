// Côté interface : appelle une fonction de core/pdf dans le worker, avec
// progression et annulation. Annuler arrête réellement le calcul (le worker est
// interrompu puis recréé au prochain appel).
import { ToolError, type ToolErrorCode } from '@/core/errors';
import type { CallMessage, Progress, ReplyMessage } from './protocol';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  progress?: Progress;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (event: MessageEvent<ReplyMessage>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    if (msg.type === 'progress') {
      entry.progress?.(msg.ratio, msg.label);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'done') entry.resolve(msg.result);
    else entry.reject(msg.code ? new ToolError(msg.code as ToolErrorCode, msg.message) : Object.assign(new Error(msg.message), { name: msg.name }));
  };
  w.onerror = (event) => {
    // Erreur fatale (souvent un manque de mémoire) : tous les appels en cours échouent.
    const error = new ToolError('memory', event.message);
    pending.forEach((p) => p.reject(error));
    pending.clear();
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

function restart(): void {
  worker?.terminate();
  worker = null;
  const error = new DOMException('Annulé', 'AbortError');
  pending.forEach((p) => p.reject(error));
  pending.clear();
}

export interface CallOptions {
  signal?: AbortSignal;
  progress?: Progress;
}

type Fn = (params: never, progress?: Progress) => unknown;

/**
 * Accès typé à un module de core/pdf :
 *   const merge = pdfOp<typeof import('@/core/pdf/merge')>('merge');
 *   const bytes = await merge('mergePdfs', { files }, ctx);
 */
export function pdfOp<M>(module: string) {
  return function call<K extends keyof M & string>(
    fn: K,
    params: M[K] extends Fn ? Parameters<M[K]>[0] : never,
    options: CallOptions = {},
  ): Promise<M[K] extends Fn ? Awaited<ReturnType<M[K]>> : never> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new DOMException('Annulé', 'AbortError'));
        return;
      }
      const id = nextId++;
      const onAbort = () => restart();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => options.signal?.removeEventListener('abort', onAbort);
      pending.set(id, {
        resolve: (v) => {
          cleanup();
          resolve(v as never);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        },
        progress: options.progress,
      });
      const message: CallMessage = { id, module, fn, params };
      getWorker().postMessage(message);
    });
  };
}
