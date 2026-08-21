import type { ParsedProject, Rule, RuleContext } from "code-invariants";
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

type Facts = {
  results: Set<string>;
  isError: Set<string>;
  status: Set<string>;
  error: Set<string>;
};

export const queryErrorHandled: Rule = {
  meta: {
    requires: ["typescript"],
    docs: {
      description: "Every TanStack useQuery / useInfiniteQuery usage must handle errors.",
    },
  },
  create(context) {
    const parsed = context.getArtifact("typescript") as ParsedProject;
    for (const [abs, unit] of parsed.sources) {
      scanFile(unit as SourceFile, abs, context);
    }
  },
};

function scanFile(sf: SourceFile, file: string, context: RuleContext): void {
  const { hooks, namespaces } = collectQueryHookBindings(sf);
  if (hooks.size === 0 && namespaces.size === 0) {
    return;
  }

  sf.forEachDescendant((node) => {
    const hook = queryHookName(node, hooks, namespaces);
    if (hook === undefined || !Node.isCallExpression(node)) {
      return;
    }
    if (hasThrowOnError(node) || hasTrackedErrorBranch(node, enclosingFunction(node))) {
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

function hasTrackedErrorBranch(call: Node, fn: Node | undefined): boolean {
  if (fn === undefined || !isFunctionLike(fn)) {
    return false;
  }
  const facts = collectFacts(call, fn);
  const body = fn.getBody();
  if (body === undefined) {
    return false;
  }
  let found = false;
  inspect(body);
  walkFunctionBody(body, (child) => {
    if (found) {
      return true;
    }
    inspect(child);
    return false;
  });
  return found;

  function inspect(node: Node): void {
    if (Node.isIfStatement(node) && usesTrackedFact(node.getExpression(), facts)) {
      found = true;
      return;
    }
    if (Node.isConditionalExpression(node) && usesTrackedFact(node.getCondition(), facts)) {
      found = true;
      return;
    }
    if (
      Node.isBinaryExpression(node) &&
      node.getOperatorToken().getText() === "&&" &&
      (usesTrackedFact(node.getLeft(), facts) || usesTrackedFact(node.getRight(), facts))
    ) {
      found = true;
    }
  }
}

function collectFacts(call: Node, fn: Node): Facts {
  const facts: Facts = {
    results: new Set(),
    isError: new Set(),
    status: new Set(),
    error: new Set(),
  };
  bindCall(call, facts);
  collectAliases(fn, facts);
  return facts;
}

function bindCall(call: Node, facts: Facts): void {
  const parent = skipWrappersUp(call).getParent();
  if (parent === undefined) {
    return;
  }
  if (Node.isVariableDeclaration(parent)) {
    bindPattern(parent.getNameNode(), facts);
    return;
  }
  if (
    Node.isBinaryExpression(parent) &&
    parent.getOperatorToken().getText() === "=" &&
    unwrapExpr(parent.getRight()) === unwrapExpr(call)
  ) {
    const left = parent.getLeft();
    if (Node.isIdentifier(left)) {
      facts.results.add(left.getText());
    }
  }
}

function collectAliases(fn: Node, facts: Facts): void {
  const body = isFunctionLike(fn) ? fn.getBody() : undefined;
  if (body === undefined) {
    return;
  }
  let changed = true;
  while (changed) {
    changed = false;
    consider(body);
    walkFunctionBody(body, (child) => {
      if (consider(child)) {
        changed = true;
      }
      return false;
    });
  }

  function consider(node: Node): boolean {
    if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      if (init === undefined) {
        return false;
      }
      return bindAlias(node.getNameNode(), init, facts);
    }
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === "=") {
      return bindAlias(node.getLeft(), node.getRight(), facts);
    }
    return false;
  }
}

function bindAlias(target: Node, init: Node, facts: Facts): boolean {
  const expr = unwrapExpr(init);
  if (Node.isIdentifier(target)) {
    return addAlias(target.getText(), expr, facts);
  }
  if (isTrackedResult(expr, facts)) {
    return bindPattern(target, facts);
  }
  return false;
}

function addAlias(name: string, expr: Node, facts: Facts): boolean {
  if (isTrackedIsError(expr, facts)) {
    return take(facts.isError, name);
  }
  if (isTrackedStatus(expr, facts)) {
    return take(facts.status, name);
  }
  if (isTrackedError(expr, facts)) {
    return take(facts.error, name);
  }
  if (isTrackedResult(expr, facts)) {
    return take(facts.results, name);
  }
  return false;
}

function bindPattern(name: Node, facts: Facts): boolean {
  if (Node.isIdentifier(name)) {
    return take(facts.results, name.getText());
  }
  if (!Node.isObjectBindingPattern(name)) {
    return false;
  }
  let changed = false;
  for (const el of name.getElements()) {
    if (!Node.isBindingElement(el)) {
      continue;
    }
    const local = el.getNameNode();
    if (!Node.isIdentifier(local)) {
      continue;
    }
    if (el.getDotDotDotToken() !== undefined) {
      changed = take(facts.results, local.getText()) || changed;
      continue;
    }
    const key = bindingKey(el);
    if (key === "isError") {
      changed = take(facts.isError, local.getText()) || changed;
    } else if (key === "status") {
      changed = take(facts.status, local.getText()) || changed;
    } else if (key === "error") {
      changed = take(facts.error, local.getText()) || changed;
    }
  }
  return changed;
}

function bindingKey(el: Node): string | undefined {
  if (!Node.isBindingElement(el)) {
    return undefined;
  }
  const prop = el.getPropertyNameNode();
  if (prop === undefined) {
    const name = el.getNameNode();
    return Node.isIdentifier(name) ? name.getText() : undefined;
  }
  if (Node.isIdentifier(prop)) {
    return prop.getText();
  }
  if (Node.isStringLiteral(prop)) {
    return prop.getLiteralValue();
  }
  return undefined;
}

function usesTrackedFact(expr: Node, facts: Facts): boolean {
  if (isTrackedFact(expr, facts)) {
    return true;
  }
  let found = false;
  expr.forEachDescendant((child, traversal) => {
    if (isFunctionLike(child)) {
      traversal.skip();
      return;
    }
    if (isTrackedFact(child, facts)) {
      found = true;
      traversal.stop();
    }
  });
  return found;
}

function isTrackedFact(node: Node, facts: Facts): boolean {
  if (isTrackedIsError(node, facts) || isTrackedError(node, facts)) {
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
    (isTrackedStatus(node.getLeft(), facts) && isErrorString(node.getRight())) ||
    (isTrackedStatus(node.getRight(), facts) && isErrorString(node.getLeft()))
  );
}

function isTrackedIsError(node: Node, facts: Facts): boolean {
  return isTrackedName(node, facts.isError) || isResultProp(node, facts, "isError");
}

function isTrackedStatus(node: Node, facts: Facts): boolean {
  return isTrackedName(node, facts.status) || isResultProp(node, facts, "status");
}

function isTrackedError(node: Node, facts: Facts): boolean {
  return isTrackedName(node, facts.error) || isResultProp(node, facts, "error");
}

function isTrackedResult(node: Node, facts: Facts): boolean {
  return Node.isIdentifier(node) && facts.results.has(node.getText());
}

function isTrackedName(node: Node, names: Set<string>): boolean {
  return Node.isIdentifier(node) && names.has(node.getText());
}

function isResultProp(node: Node, facts: Facts, name: string): boolean {
  if (!Node.isPropertyAccessExpression(node) || node.getName() !== name) {
    return false;
  }
  const obj = unwrapExpr(node.getExpression());
  return Node.isIdentifier(obj) && facts.results.has(obj.getText());
}

function isErrorString(node: Node): boolean {
  return Node.isStringLiteral(node) && node.getLiteralValue() === "error";
}

function take(set: Set<string>, name: string): boolean {
  if (set.has(name)) {
    return false;
  }
  set.add(name);
  return true;
}

function unwrapExpr(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function skipWrappersUp(node: Node): Node {
  let current = node;
  while (true) {
    const parent = current.getParent();
    if (parent === undefined) {
      return current;
    }
    if (
      (Node.isParenthesizedExpression(parent) ||
        Node.isAsExpression(parent) ||
        Node.isTypeAssertion(parent) ||
        Node.isSatisfiesExpression(parent) ||
        Node.isNonNullExpression(parent)) &&
      parent.getExpression() === current
    ) {
      current = parent;
      continue;
    }
    return current;
  }
}

function walkFunctionBody(body: Node, visit: (node: Node) => boolean): void {
  body.forEachDescendant((child, traversal) => {
    if (isFunctionLike(child)) {
      traversal.skip();
      return;
    }
    if (visit(child)) {
      traversal.stop();
    }
  });
}
