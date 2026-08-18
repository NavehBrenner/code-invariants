import type { LanguageRule, LanguageRuleContext } from "code-invariants";
import { Node, type SourceFile } from "ts-morph";
import {
  collectQueryHookBindings,
  enclosingFunction,
  isFunctionLike,
  queryHookName,
  rangeOf,
} from "./ast.ts";

const SUGGESTION =
  'Branch on isError/error/status === "error" in this function, or set throwOnError: true and render an Error Boundary.';

export const queryErrorHandled: LanguageRule = {
  meta: {
    kind: "language",
    languages: ["typescript"],
    docs: {
      description: "Every TanStack useQuery / useInfiniteQuery usage must handle errors.",
    },
  },
  create(context) {
    for (const [abs, unit] of context.getSources()) {
      scanFile(unit as SourceFile, abs, context);
    }
  },
};

function scanFile(sf: SourceFile, file: string, context: LanguageRuleContext): void {
  const { hooks, namespaces } = collectQueryHookBindings(sf);
  if (hooks.size === 0 && namespaces.size === 0) {
    return;
  }

  sf.forEachDescendant((node) => {
    const hook = queryHookName(node, hooks, namespaces);
    if (hook === undefined || !Node.isCallExpression(node)) {
      return;
    }
    if (hasThrowOnError(node) || hasErrorBranch(enclosingFunction(node))) {
      return;
    }
    context.report({
      severity: "error",
      file,
      range: rangeOf(node),
      message: `${hook} error is unhandled.`,
      suggestion: SUGGESTION,
    });
  });
}

function hasThrowOnError(call: Node): boolean {
  if (!Node.isCallExpression(call)) {
    return false;
  }
  for (const arg of call.getArguments().slice(0, 2)) {
    if (Node.isObjectLiteralExpression(arg) && objectHasThrowOnError(arg)) {
      return true;
    }
  }
  return false;
}

function objectHasThrowOnError(obj: Node): boolean {
  if (!Node.isObjectLiteralExpression(obj)) {
    return false;
  }
  const prop = obj.getProperty("throwOnError");
  if (prop === undefined || !Node.isPropertyAssignment(prop)) {
    return false;
  }
  const init = prop.getInitializer();
  if (init === undefined || Node.isFalseLiteral(init)) {
    return false;
  }
  if (Node.isTrueLiteral(init)) {
    return true;
  }
  return Node.isFunctionExpression(init) || Node.isArrowFunction(init);
}

function hasErrorBranch(fn: Node | undefined): boolean {
  if (fn === undefined || !isFunctionLike(fn)) {
    return false;
  }
  const body = fn.getBody();
  if (body === undefined) {
    return false;
  }
  let found = false;
  inspect(body);
  body.forEachDescendant((child, traversal) => {
    if (found) {
      traversal.stop();
      return;
    }
    if (isFunctionLike(child)) {
      traversal.skip();
      return;
    }
    inspect(child);
  });
  return found;

  function inspect(node: Node): void {
    if (Node.isIfStatement(node) && conditionMentionsError(node.getExpression())) {
      found = true;
      return;
    }
    if (Node.isConditionalExpression(node) && conditionMentionsError(node.getCondition())) {
      found = true;
      return;
    }
    if (
      Node.isBinaryExpression(node) &&
      node.getOperatorToken().getText() === "&&" &&
      (conditionMentionsError(node.getLeft()) || conditionMentionsError(node.getRight()))
    ) {
      found = true;
    }
  }
}

function conditionMentionsError(expr: Node): boolean {
  if (isErrorCheck(expr)) {
    return true;
  }
  let found = false;
  expr.forEachDescendant((child, traversal) => {
    if (isFunctionLike(child)) {
      traversal.skip();
      return;
    }
    if (isErrorCheck(child)) {
      found = true;
      traversal.stop();
    }
  });
  return found;
}

function isErrorCheck(node: Node): boolean {
  if (isIdentOrProp(node, "isError") || isIdentOrProp(node, "error")) {
    return true;
  }
  if (!Node.isBinaryExpression(node)) {
    return false;
  }
  const op = node.getOperatorToken().getText();
  if (op !== "===" && op !== "==") {
    return false;
  }
  return (
    (isIdentOrProp(node.getLeft(), "status") && isErrorString(node.getRight())) ||
    (isIdentOrProp(node.getRight(), "status") && isErrorString(node.getLeft()))
  );
}

function isIdentOrProp(node: Node, name: string): boolean {
  if (Node.isIdentifier(node)) {
    return node.getText() === name;
  }
  if (Node.isPropertyAccessExpression(node)) {
    return node.getName() === name;
  }
  return false;
}

function isErrorString(node: Node): boolean {
  return Node.isStringLiteral(node) && node.getLiteralValue() === "error";
}
