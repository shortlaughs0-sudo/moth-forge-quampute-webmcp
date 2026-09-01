# WebMCP Challenge submission draft

## Title

MOTH FORGE: QUAMPUTE

## Tagline

The creator owns intent. The agent carries the complexity.

## Short description

Quampute is a shared creative-systems workbench where a human supplies the spark, evidence, and non-negotiable locks while an agent performs the exhausting work of source custody, consequence mapping, and question triage. WebMCP keeps both collaborators on the same visible surface: the agent can inspect, stage, persist, and prepare; the creator retains the decisions that spend money, destroy evidence, or define canon.

## Why this is a strong fit for WebMCP

Deep character and world creation is not a single prompt. It is a long chain of evidence, uncertain inferences, private creator decisions, contradictions, and runtime consequences. A conventional chatbot is detached from the workbench and a conventional form makes the human do all the labor. WebMCP lets Quampute expose the exact operations an agent is good at while the human watches state change in the normal interface.

The agent does not scrape pixels or guess which button matters. It receives narrow, typed tools for the real application logic. It can read the pinned authority revision, open the correct work order, attach a source with an explicit role, save locks, stage answers, and prepare a run. Each result returns enough state for verification. The interface remains fully usable without an agent.

## What people and agents can do together

1. The creator states a premise in ordinary language.
2. The agent inspects the current Forge revision and existing work orders before acting.
3. The agent stages a refined spark in the visible editor; the creator can revise it directly.
4. The agent creates the private work order and attaches evidence as canon, reference, inspiration, or format-only material.
5. The agent saves explicit locks and boundaries while the UI shows the handoff.
6. The agent prepares the Quampute pass and reports blockers, but cannot approve charges or start the paid request.
7. The creator reviews the receipt and starts the run.
8. The agent reads the result, surfaces only creator-reserved questions, and can stage an answer without silently committing it.
9. The creator exports a reviewable package with an honest completion state.

This division was difficult before WebMCP because the agent either lacked application state or needed broad UI control. Quampute gives it precise capability without giving away creator authority.

## Implementation

The top-level React page registers thirteen JavaScript tools through `document.modelContext.registerTool`. Inputs use narrow JSON schemas. Read-only, local handoff, and persistent-write tools are annotated according to their effects. Handlers call the same authenticated APIs and validation paths as the visible app. The interface exposes tool readiness and a recent agent-activity ledger.

Project data is owner-scoped in D1. Each work order pins a hash-verified Forge authority revision. A mismatch stops execution before a paid model call. The OpenAI API secret stays server-side, research is off by default, and consent is required before processing.

## Judging-criteria map

### WebMCP Leverage

- Thirteen working tools cover a real multi-stage workflow, not a toy lookup.
- Tools synchronize the same visible state the human edits.
- Effects are deliberately split between inspection, reversible staging, persistence, and human-only gates.

### Execution

- Complete six-stage product flow: Spark, Sources, Locks, Quampute, Review, Export.
- Authentication, persistence, receipts, errors, uncertain-run handling, responsive UI, and no-WebMCP fallback.

### Potential Impact

- Helps writers, roleplayers, game designers, and worldbuilders create deep systems without surrendering authorship or filling hundreds of fields by hand.
- The authority-aware collaboration pattern generalizes to research, policy, design systems, and any work where the agent should do labor without owning judgment.

### Creativity and Ambition

- Uses versioned evidence, revisable conclusions, human-owned decisions, and observable follow-through.
- WebMCP becomes a boundary language between human authority and agent capability.

## Submission checklist

- [ ] Working public URL
- [ ] Public source repository made from the sanitized release
- [ ] Open-source license visible at repository root
- [ ] Public YouTube demo under three minutes with audio
- [ ] Final project description entered on Devpost
- [ ] Live app verified in ChatGPT's in-app browser
- [ ] Repository URL, live URL, and video URL read back from the submitted entry

Official deadline: September 3, 2026 at 1 p.m. Pacific Time.

## Official references

- https://openai.com/webmcp-challenge/
- https://webmcp.devpost.com/
- https://learn.chatgpt.com/docs/webmcp
