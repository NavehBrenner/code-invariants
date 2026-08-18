import type { LanguageRule, LanguageRuleContext } from "code-invariants";
import { Node, type SourceFile } from "ts-morph";
import {
  collectHttpClientBindings,
  collectReactEffectBindings,
  fileDeclaresLocalFetch,
  forbiddenHttpApi,
  inlineCallback,
  isEffectCall,
  isFunctionLike,
  isIifeCallee,
  rangeOf,
} from "./ast.ts";

const SUGGESTION =
  "Load this data with TanStack Query, SWR, a route loader, or an RSC fetch — not inside useEffect.";

export const noFetchInUseEffect: LanguageRule = {
  meta: {
    kind: "language",
    languages: ["typescript"],
    docs: {
      description: "Do not kick off HTTP data loading inside useEffect or useLayoutEffect.",
    },
  },
  create(context) {
    for (const [abs, unit] of context.getSources()) {
      scanFile(unit as SourceFile, abs, context);
    }
  },
};

function scanFile(sf: SourceFile, file: string, context: LanguageRuleContext): void {
  const { effects, namespaces } = collectReactEffectBindings(sf);
  if (effects.size === 0 && namespaces.size === 0) {
    return;
  }
  const clients = collectHttpClientBindings(sf);
  const localFetch = fileDeclaresLocalFetch(sf);

  sf.forEachDescendant((node) => {
    if (!isEffectCall(node, effects, namespaces)) {
      return;
    }
    const callback = inlineCallback(node);
    if (callback === undefined) {
      return;
    }
    scanEffectCallback(callback, file, clients, localFetch, context);
  });
}

function scanEffectCallback(
  callback: Node,
  file: string,
  clients: Set<string>,
  localFetch: boolean,
  context: LanguageRuleContext,
): void {
  const body =
    Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)
      ? callback.getBody()
      : undefined;
  if (body === undefined) {
    return;
  }
  consider(body);
  body.forEachDescendant((child, traversal) => {
    if (Node.isFunctionDeclaration(child)) {
      traversal.skip();
      return;
    }
    if (isFunctionLike(child) && !isIifeCallee(child)) {
      traversal.skip();
      return;
    }
    consider(child);
  });

  function consider(node: Node): void {
    const api = forbiddenHttpApi(node, clients, localFetch);
    if (api === undefined) {
      return;
    }
    context.report({
      severity: "error",
      file,
      range: rangeOf(node),
      message: `Do not call ${api} inside useEffect or useLayoutEffect.`,
      suggestion: SUGGESTION,
    });
  }
}
