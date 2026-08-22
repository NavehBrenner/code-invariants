# Research Findings — qualety

**Date**: August 2026  
**Question investigated**: Does a library/tool already exist that enforces *complex* best practices (beyond classic linting) at the level of compositional patterns, semantic DRY, and mandatory test presence, for TypeScript and Python, in a way that is useful for AI coding agents and can largely remove structural concerns from human code review?

## Executive summary

**No single product delivers the full combination** described in the project vision. Strong, mature building blocks exist for each individual concern. The opportunity is to integrate them, raise the abstraction level of the rules (especially compositional React/TS patterns), add a proactive semantic-DRY agent loop, and package the result as an agent-friendly, multi-language system.

Almost every relevant tool is pure static analysis (or local embeddings). None of the core engines require generative LLM API keys.

## Detailed landscape

### 1. Custom / complex pattern enforcement

| Tool | Strengths | Limitations relative to our goals | LLM required? |
|------|-----------|-----------------------------------|---------------|
| **Semgrep** | Excellent multi-language pattern matching, taint analysis, large rule registry, CI-native, custom rules in YAML | Not specialised in deep compositional JSX patterns; rules are still relatively “flat” | No |
| **ts-morph** | Best-in-class TypeScript AST manipulation; exactly what the original TSX prototype used | Library, not a product; you write everything | No |
| **ESLint + typescript-eslint + plugins** | Ubiquitous, type-aware rules, huge ecosystem | Struggles with higher-order compositional constraints (e.g. “this component must contain these three children”) | No |
| **ArchUnitTS / ArchUnitPython** | Architecture fitness functions as tests (layers, cycles, naming, metrics) | Focused on structural architecture, not component composition or data-state exhaustiveness | No |
| **dependency-cruiser, import-linter, Tach, Fensu** | Module/layer boundary enforcement, cycle detection | Same as above — architecture, not the React-specific patterns | No |

**Conclusion**: The engines for writing the desired rules exist (especially ts-morph + Semgrep). Ready-made rules for the exact examples (DataRegion, branded style tokens, exhaustive query states) do not.

### 2. DRY / code duplication prevention

| Tool | Approach | Notes |
|------|----------|-------|
| **dupehound** | Structural fingerprinting (tree-sitter → normalise identifiers/literals → winnowing n-grams → Jaccard). Multi-language (TS/TSX/Python/…). CLI + CI `check` that fails on new duplicates and suggests the original. MCP server. Zero AI required. Extremely fast and deterministic. | Closest existing tool to the “prevent AI from re-implementing existing functions” problem. |
| **Slopo** | Embedding-based semantic duplication detection. Prioritises distant similar code. | Directly addresses non-exact / “same idea written differently” clones. |
| **jscpd, traditional clone detectors** | Token / AST based | Mature but less AI-agent optimised. |
| Research / commercial | CodeBERT-style embeddings + vector search, Sourcegraph, etc. | The *proactive* “query the vector store before writing a new component” loop is still rare as a simple open CI + agent tool. |

**Conclusion**: Structural (dupehound) and semantic (Slopo + custom embeddings) solutions both exist. Combining them and making the check *proactive* for agents is still open product space.

### 3. Test presence / coverage

- Runtime **function coverage** is standard (Vitest/c8, pytest-cov, etc.) and can already fail CI when functions are never executed.
- A pure static “every exported symbol must be referenced inside a test file” check is straightforward with the same AST infrastructure but is not a widely shipped product feature.

### 4. Agent-oriented quality tooling (2025–2026)

- **sensez** — structural feedback (duplication, dead code, cycles, smells) exposed via MCP so agents can self-correct during generation.
- Various architecture MCP servers and SonarQube agent features.
- The industry is clearly moving toward “executable standards that agents can query.”

### 5. What is missing (the gap we fill)

1. Easy authoring and packaging of **higher-order compositional rules** (the DataRegion pattern is the canonical example).
2. A **unified product** that offers the same mental model and CLI/MCP surface for TypeScript and Python.
3. **Proactive semantic DRY** integrated into the agent loop (not only post-hoc CI detection).
4. First-class **test-presence** static gate alongside coverage.
5. Documentation and examples that let a coding agent implement and extend the system itself.

## Key references (from research)

- Semgrep documentation and rule registry
- ts-morph (TypeScript AST)
- ArchUnitTS / ArchUnitPython
- dupehound (structural AI-era clone detection)
- Slopo (embedding-based semantic clones)
- sensez, Fensu, dependency-cruiser, import-linter, Tach
- Coverage tools (function coverage metrics)
- Evolutionary architecture / fitness-function literature

## Implications for implementation

- Build on ts-morph for the TypeScript frontend (proven).
- Offer Semgrep-compatible or Semgrep-inspired rule syntax where useful, but do not be limited by it for deep JSX composition.
- Re-use or interoperate with dupehound-style fingerprinting for the structural half of DRY.
- Keep the core engine free of any generative LLM dependency; embeddings (if used) should prefer local models.
- Design the rule plugin interface so that the community (and future agents) can contribute new invariants easily.

---

*This research was performed in August 2026. The landscape moves quickly; re-evaluate major new tools before locking architecture decisions.*
