# WebMCP tool and safety map

| Tool | Reads | Changes | Human handoff | Forbidden side effect |
| --- | --- | --- | --- | --- |
| `inspect_forge_studio` | Anchor, stage, project, evidence, runs, gates | Nothing | Agent reports grounded state | No mutation |
| `list_forge_projects` | Private work-order summaries | Nothing | Human or agent selects exact ID | No project creation |
| `set_forge_spark` | Current editor | Visible local draft | Human can revise or reject | No persistence |
| `create_forge_project` | Spark inputs | Owner-scoped D1 project | Opens Sources | No paid run or publication |
| `open_completed_forge_demo` | Verified anchor | Owner-scoped synthetic example | Opens Review with zero cost | No model call or publication |
| `open_forge_project` | Exact project | Visible local selection | Synchronizes shared workbench | No project edit |
| `add_forge_text_source` | Supplied text | Owner-scoped source record | Creator can inspect/reclassify | No silent authority promotion |
| `update_forge_creator_locks` | Current project | Locks and boundaries | Creator sees Locks stage | No cost approval, research approval, run, deletion, or publication |
| `inspect_forge_review` | Result, QA, reserved questions | Nothing | Agent explains what remains | No answer write |
| `stage_forge_question_answer` | Exact reserved question | Visible unsaved answer | Creator edits and explicitly saves | No silent commitment |
| `navigate_forge_stage` | Available stages | Visible local stage | Keeps human and agent oriented | No project mutation |
| `prepare_forge_run` | Engine, revision, consent, run state | Completed public demo or private run gate | Public mode may restore deterministic demo state before Review; private users see blockers | No paid call; public path is destructive-annotated |
| `get_forge_export_links` | Export routes and completion state | Nothing | Human chooses download | No download, publication, or submission |

## Design rules

- Register on the top-level page with JavaScript.
- Preserve the ordinary human interface when WebMCP is unavailable.
- Keep input schemas narrow and reject unknown or oversized values.
- Reuse the site's normal authentication, authorization, and validation.
- Describe persistent effects in the tool description and annotations.
- Return enough post-state to verify what happened.
- Make agent activity visible in the workbench.
- Keep cost, source deletion, uncertain paid-run abandonment, and publication as human-only gates. A known stored provider response is cleanup-first: abandonment cannot commit until the provider confirms deletion or absence.
