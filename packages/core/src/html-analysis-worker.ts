/**
 * Worker-thread entry for analyzeHtmlInWorker. Bundled packages ship it as a
 * separate `html-analysis-worker.js` next to their main entry.
 */

import { parentPort, workerData } from "node:worker_threads";
import { Defuddle } from "defuddle/node";
import { analyzeHtml } from "./html-analysis";
import type { HtmlAnalysisRequest } from "./types";

parentPort?.postMessage(
  await analyzeHtml(workerData as HtmlAnalysisRequest, Defuddle),
);
