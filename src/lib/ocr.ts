// Reconnaissance de texte (tesseract.js), côté navigateur. Le moteur et les
// modèles de langue sont servis par l'application elle-même — aucun CDN — et
// chargés au premier usage seulement, pour ne pas alourdir le démarrage.
import type Tesseract from 'tesseract.js';
import type { OcrWord } from '@/core/pdf/ocrLayer';

export type OcrLang = 'fra' | 'eng' | 'fra+eng';

// Le worker de tesseract.js part d'une URL « blob: » : il lui faut des adresses absolues.
const vendor = new URL(`${import.meta.env.BASE_URL}vendor/tesseract/`, location.href).href;
const modelUrl = (code: string): string => `${vendor}lang/${code}.traineddata.gz`;

// Tailles des fichiers servis (moteur WebAssembly, modèles « best int » compressés).
const ENGINE_BYTES = 3_900_000;
const MODEL_BYTES: Record<string, number> = { fra: 707_000, eng: 2_953_000 };

/** Ce que le premier usage télécharge pour cette langue, en octets (ordre de grandeur). */
export function ocrDownloadSize(lang: OcrLang): number {
  return lang.split('+').reduce((sum, code) => sum + MODEL_BYTES[code], ENGINE_BYTES);
}

/** Vrai si les modèles de cette langue sont déjà dans le cache hors ligne de l'application. */
export async function ocrDownloaded(lang: OcrLang): Promise<boolean> {
  try {
    const hits = await Promise.all(lang.split('+').map((code) => caches.match(modelUrl(code))));
    return hits.every(Boolean);
  } catch {
    return false; // pas de cache (navigation privée, contexte non sécurisé) : on prévient du téléchargement
  }
}

/**
 * Échelle de rendu d'une page avant reconnaissance (1 = 72 points par pouce) :
 * 200 ppp, 150 sur téléphone, et moins encore si l'image dépasserait ce que la
 * mémoire de l'appareil encaisse sans risque.
 */
export function ocrScale(width: number, height: number): number {
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  const scale = (phone ? 150 : 200) / 72;
  return Math.min(scale, Math.sqrt((phone ? 4e6 : 9e6) / (width * height)));
}

export interface OcrResult {
  words: OcrWord[];
  text: string;
  /** Confiance moyenne du moteur, de 0 à 100. */
  confidence: number;
}

export interface OcrEngine {
  /** Reconnaît une image de page ; `dpi` est sa résolution réelle. */
  recognize(image: HTMLCanvasElement, dpi: number, onProgress?: (ratio: number) => void): Promise<OcrResult>;
  terminate(): void;
}

/** Le moteur ou ses modèles n'ont pas pu être chargés (souvent : premier usage hors connexion). */
export class OcrLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrLoadError';
  }
}

/**
 * S'assure que les modèles de langue sont disponibles — dans le cache hors
 * ligne, sinon en les téléchargeant (le service worker les garde au passage).
 * On le vérifie avant de lancer le moteur : son worker ne peut plus être
 * arrêté proprement s'il échoue à charger un modèle.
 */
async function fetchModels(lang: OcrLang, signal: AbortSignal | undefined, onProgress: (ratio: number) => void): Promise<void> {
  const codes = lang.split('+');
  const total = codes.reduce((sum, code) => sum + MODEL_BYTES[code], 0);
  let received = 0;
  await Promise.all(
    codes.map(async (code) => {
      if (await caches.match(modelUrl(code)).catch(() => undefined)) return;
      const response = await fetch(modelUrl(code), { signal });
      if (!response.ok || !response.body) throw new OcrLoadError(`${code}.traineddata.gz : ${response.status}`);
      const reader = response.body.getReader();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        received += chunk.value.length;
        onProgress(Math.min(1, received / total));
      }
    }),
  ).catch((error: unknown) => {
    // Hors connexion, fetch échoue par une TypeError ; une annulation reste une annulation.
    throw error instanceof TypeError ? new OcrLoadError(error.message) : error;
  });
}

// Avancement du chargement : modèles (première moitié), puis moteur et initialisation.
const LOAD_STEPS: Record<string, [from: number, to: number]> = {
  'loading tesseract core': [0.5, 0.8],
  'initializing tesseract': [0.8, 0.85],
  'loading language traineddata': [0.85, 0.95],
  'initializing api': [0.95, 1],
};

/**
 * Démarre un moteur de reconnaissance dans son propre worker. Annuler (via
 * `signal`) arrête réellement le calcul : le worker est supprimé.
 */
export async function createOcrEngine(
  lang: OcrLang,
  options: { signal?: AbortSignal; onLoading?: (ratio: number) => void } = {},
): Promise<OcrEngine> {
  const { signal, onLoading } = options;
  const aborted = () => new DOMException('Annulé', 'AbortError');
  if (signal?.aborted) throw aborted();

  let worker: Tesseract.Worker | null = null;
  let stopped = false;
  let onRecognize: ((ratio: number) => void) | undefined;
  let fail!: (reason: unknown) => void;
  const failure = new Promise<never>((_, reject) => (fail = reject));
  failure.catch(() => undefined); // toujours observée, même si personne n'attend plus
  const guard = <T>(work: Promise<T>): Promise<T> => Promise.race([work, failure]);

  const terminate = () => {
    stopped = true;
    signal?.removeEventListener('abort', onAbort);
    void worker?.terminate();
    worker = null;
  };
  const onAbort = () => {
    terminate();
    fail(aborted());
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await guard(fetchModels(lang, signal, (r) => onLoading?.(r / 2)));
    const { createWorker, OEM, PSM } = await guard(import('tesseract.js'));
    const starting = createWorker(lang, OEM.LSTM_ONLY, {
      workerPath: `${vendor}worker.min.js`,
      corePath: `${vendor}core/`,
      langPath: `${vendor}lang/`,
      gzip: true,
      // Le service worker garde déjà les modèles : inutile de les copier en plus dans IndexedDB.
      cacheMethod: 'none',
      logger: ({ status, progress }) => {
        if (status === 'recognizing text') onRecognize?.(progress);
        else if (LOAD_STEPS[status]) onLoading?.(LOAD_STEPS[status][0] + (LOAD_STEPS[status][1] - LOAD_STEPS[status][0]) * progress);
      },
      // Sans ce relais, un modèle introuvable laisserait createWorker en attente indéfiniment.
      errorHandler: (error: unknown) => fail(worker ? new Error(String(error)) : new OcrLoadError(String(error))),
    });
    // Annulé pendant le chargement : le worker est supprimé dès qu'il se présente.
    void starting.then((w) => (stopped ? void w.terminate() : (worker = w))).catch(() => undefined);
    const ready = await guard(starting).catch((error: unknown) => {
      throw error instanceof Error ? error : new OcrLoadError(String(error));
    });
    // Mise en page automatique : colonnes, titres et paragraphes sont repérés avant la lecture.
    await guard(ready.setParameters({ tessedit_pageseg_mode: PSM.AUTO }));
  } catch (error) {
    terminate();
    throw error;
  }

  let currentDpi = 0;
  return {
    terminate,
    async recognize(image, dpi, onProgress) {
      if (!worker) throw aborted();
      if (dpi !== currentDpi) {
        await guard(worker.setParameters({ user_defined_dpi: String(dpi) }));
        currentDpi = dpi;
      }
      onRecognize = onProgress;
      // Les boîtes des mots ne sont fournies que si l'on demande la sortie « blocks ».
      const { data } = await guard(worker.recognize(image, {}, { text: true, blocks: true }));
      onRecognize = undefined;
      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const { x0, y0, x1, y1 } = line.baseline;
            const slope = x1 > x0 ? (y1 - y0) / (x1 - x0) : 0;
            for (const word of line.words) {
              if (!word.text.trim()) continue;
              const box = word.bbox;
              const baseline = y0 + slope * (box.x0 - x0);
              // Une ligne de base hors de la moitié basse du mot est une erreur de mesure : on s'en passe.
              const plausible = baseline > (box.y0 + box.y1) / 2 && baseline <= box.y1 + 1;
              words.push({ text: word.text, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, ...(plausible ? { baseline } : {}) });
            }
          }
        }
      }
      return { words, text: data.text ?? '', confidence: data.confidence };
    },
  };
}
