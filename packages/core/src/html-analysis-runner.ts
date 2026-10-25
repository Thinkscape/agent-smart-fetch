import { Worker } from "node:worker_threads";
import type { HtmlAnalysis, HtmlAnalysisRequest } from "./types";

// setTimeout fires immediately for delays that do not fit in 32 bits.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

const WORKER_URL = new URL("./html-analysis-worker.js", import.meta.url);

/**
 * Runs analyzeHtml with Defuddle on a worker thread, so parsing and extraction
 * never block the caller's event loop, and terminates the worker once it has
 * run for `timeoutMs`. Like wreq-js, a `timeoutMs` of 0 means no limit.
 */
export function analyzeHtmlInWorker(
  request: HtmlAnalysisRequest,
  { timeoutMs }: { timeoutMs: number },
): Promise<HtmlAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: request });
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      finish();
    };
    const timer =
      timeoutMs > 0
        ? setTimeout(
            () =>
              settle(() =>
                reject(
                  new Error(
                    `Content extraction timed out after ${timeoutMs}ms`,
                  ),
                ),
              ),
            Math.min(timeoutMs, MAX_TIMER_DELAY_MS),
          )
        : undefined;
    worker.once("message", (analysis: HtmlAnalysis) =>
      settle(() => resolve(analysis)),
    );
    worker.once("error", (error) => settle(() => reject(error)));
    worker.once("exit", (code) =>
      settle(() =>
        reject(
          new Error(
            `Content extraction worker exited with code ${code} before returning a result`,
          ),
        ),
      ),
    );
  });
}
