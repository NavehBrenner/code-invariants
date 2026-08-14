# Guidance for Coding Agents

This repository is intentionally set up so that an AI coding agent can take over implementation.

## Before you write any code

1. Read these three documents completely:
   - [docs/VISION.md](docs/VISION.md)
   - [docs/SPECS.md](docs/SPECS.md)
   - [docs/RESEARCH.md](docs/RESEARCH.md)
2. Understand that the current state is **documentation only**. There is no implementation yet.
3. The original author already has a private TypeScript/TSX prototype for several compositional rules. The public goal is to generalise it.

## Recommended first implementation tasks

1. Scaffold a TypeScript package (or small monorepo) with:
   - `ts-morph` as the primary AST library
   - A simple plugin-based rule engine
   - Vitest for testing the rules themselves
2. Implement rule R2 (DataRegion-style exhaustive states) first — it is the most distinctive and highest-value compositional rule.
3. Then R1 (query error handling) and R3 (semantic style tokens).
4. Add a minimal CLI: `code-invariants check` that exits non-zero on violations.
5. Add a GitHub Action example.
6. Write tests that feed both valid and invalid example code and assert on the exact violations produced.

## Design constraints (do not violate)

- Core engine must remain free of generative LLM API dependencies.
- Rules must be independently enableable/disableable.
- Error messages must be clear enough for another agent to fix the violation autonomously.
- Prefer pure static analysis. Use embeddings only for the semantic-DRY feature.

## How to communicate progress

- Open small, focused PRs.
- Keep the documentation in `docs/` in sync with reality.
- When you add a new rule, document it in `docs/SPECS.md` and add example good/bad snippets.

Thank you for helping turn high-level engineering standards into executable invariants.
