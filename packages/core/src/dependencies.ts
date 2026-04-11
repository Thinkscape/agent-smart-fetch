import { getProfiles, fetch as wreqFetch } from "@thinkscape/wreq-js";
import { Defuddle } from "defuddle/node";
import type { FetchDependencies } from "./types";

export const runtimeDependencies: FetchDependencies = {
  fetch: wreqFetch,
  defuddle: Defuddle,
  getProfiles,
};
