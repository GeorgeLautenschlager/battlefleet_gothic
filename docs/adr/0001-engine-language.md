# ADR 0001: TypeScript for the rules engine

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** George Lautenschlager, Claude

## Context

The rules engine (`validate(state, transform)`, `reduce(state, transform)`) is fully specified in [`game_state/`](../../game_state/SPEC.md), [`transforms/`](../../transforms/SPEC.md), [`validator/`](../../validator/SPEC.md) and [`reducer/`](../../reducer/SPEC.md). Before implementing it, we need a language. Forces at play:

1. **It runs in the browser.** Phase 1 is local hot-seat; later phases add an AI opponent.
2. **The AI opponent is likely an LLM running locally on WebGPU.** The mature in-browser runtimes, WebLLM (MLC) and transformers.js (ONNX Runtime Web), expose JavaScript/TypeScript APIs. WebLLM can constrain output to a JSON schema.
3. **Raw engine speed barely matters.** A `reduce` is a few dozen dice and some trigonometry for a handful of ships: microseconds. LLM token generation (tens of tokens a second) dominates any turn by orders of magnitude.
4. **Small LLMs are poor at continuous geometry.** The opponent will probably pick *intent* (target, manoeuvre, orders) and leave a conventional planner to search candidate paths through the engine. That planner is the only engine-throughput-sensitive consumer, and at one to four ships a side it's modest.
5. **Determinism is a hard requirement** (state spec §1): the same state and transform give the same result, so replays and saved games reproduce. JavaScript's transcendental `Math` functions aren't guaranteed bit-identical across browser engines.
6. **Familiarity matters less than it used to**, since most code will be written by coding agents. Agent fluency and ecosystem depth still matter.

## Decision

Implement the rules engine in **TypeScript**, as a standalone package with no DOM, browser or Node APIs. It must be portable by construction:

- **Pure functions over JSON.** The state, transforms and work items are plain JSON exactly as the specs define them. No classes in the state.
- **Deterministic maths.** Engine code uses only IEEE-exact operations plus the engine's own `dmath` module (ported from fdlibm). Platform trig is forbidden and lint-enforced. See [validator §2.8](../../validator/SPEC.md#28-deterministic-maths).
- **A language-neutral conformance suite.** Seeded game transcripts (initial config, transform list, expected state after each step) stored as JSON. They're the engine's acceptance tests, run in Node and, via Playwright, in Chromium, Firefox and WebKit. Any future port must pass the same suite.
- **Types generate schemas.** Transform types are defined once (e.g. with a runtime-schema library), so the validator's `MALFORMED` check and the LLM's constrained-output JSON schema both come from the same source.

## Options considered

| Option | Verdict | Why |
|---|---|---|
| **TypeScript** | **Chosen** | One language across engine, UI and LLM runtime. JSON state is native. Discriminated unions fit the spec's tagged types. Strongest agent fluency and tooling. Determinism is fixable with `dmath`. |
| Rust → WebAssembly | Deferred | Deterministic maths for free (`libm`), fast, excellent enums. Can also run natively and from Python (PyO3) for self-play or training. But: a JS ↔ WebAssembly boundary on every call, harder builds and in-browser debugging, and Rust-native browser LLM runtimes (Burn, candle over wgpu) are less mature than WebLLM. Its benefits matter mainly for large-scale self-play, which isn't planned. |
| Go / TinyGo → WebAssembly | Rejected | Rust's costs, with fewer of its benefits (larger binaries, a garbage collector, a weaker WebAssembly story). |
| Kotlin/Wasm, Java (TeaVM) | Rejected | Familiar from Java, but an immature browser and WebAssembly ecosystem. |
| AssemblyScript | Rejected | TS-like syntax, but a niche ecosystem and a weak story for structured data. |
| C++ / Zig → WebAssembly | Rejected | No advantage over Rust for this problem. |
| Python (Pyodide) | Rejected for the browser | Too heavy at runtime. Python may still appear offline for model work, calling the engine through Node or a port. |

## Consequences

**Positive**
- The engine, UI and AI orchestration share types and a toolchain. The LLM's structured output can't be malformed, because the schema *is* the transform type.
- Engine and AI can run together in a Web Worker, keeping the UI thread free.
- Agents and humans can work across the whole stack without context switches.

**Negative / risks**
- **`dmath` is ours to maintain.** About four functions, ported once and tested against a hex table. That's a small, contained cost.
- **Throughput ceiling.** If we later want millions of simulated games (reinforcement learning, self-play), TypeScript will be the bottleneck. **Mitigation:** the conformance suite makes a Rust port a mechanical, verifiable exercise rather than a rewrite.
- **Deep-copy-per-reduce** (reducer spec §1) is simple but allocates. That's fine at Phase 1 scale; revisit with structural sharing (e.g. Immer) only if a planner needs it.

**Signals that would reopen this decision**
- The AI strategy moves to self-play or reinforcement learning at scale.
- A server-authoritative mode needs the engine in a non-JS backend.
- A Rust-native WebGPU inference stack overtakes WebLLM / transformers.js for our models.

## Follow-ups

1. Implementation brief for the engine package, in this build order:
   1. `dmath` and geometry helpers
   2. RNG, `newGame` and invariant checks
   3. validator
   4. reducer
   5. conformance transcripts
2. Lint rule banning platform trig in the engine package.
3. Playwright cross-browser conformance job in CI.
