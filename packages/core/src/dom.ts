import { parseHTML } from "linkedom";

/** Apply linkedom polyfills that Defuddle expects (getComputedStyle, styleSheets). */
export function parseLinkedomHTML(html: string, url?: string): Document {
  const { document } = parseHTML(html);
  const doc = document as Document & Record<string, unknown>;
  const defaultView = doc.defaultView as
    | (Window & {
        getComputedStyle?: (
          elt: Element,
          pseudoElt?: string | null,
        ) => CSSStyleDeclaration;
      })
    | undefined;

  if (!(doc as { styleSheets?: unknown }).styleSheets) {
    (doc as { styleSheets?: unknown }).styleSheets =
      [] as unknown as StyleSheetList;
  }

  if (defaultView && !defaultView.getComputedStyle) {
    defaultView.getComputedStyle = (() => ({
      display: "",
    })) as unknown as typeof defaultView.getComputedStyle;
  }

  if (url) {
    (doc as { URL?: string }).URL = url;
  }

  return document;
}
