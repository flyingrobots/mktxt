# Design-feedback intake

This directory stores external critiques and ideas as durable, independently
adjudicable artifacts. Intake records a proposal; it does not authorize a code,
protocol, manifest, fixture, or version change.

Each feedback item is one JSON document conforming to
`feedback-item.schema.json`. An item records:

- the original feedback and its provenance;
- the repository behavior that existed when the feedback arrived;
- the proposed change, without treating it as accepted;
- questions, risks, and evidence needed for a decision; and
- an explicit pending, accepted, rejected, deferred, or superseded decision.

Items from one review are grouped beneath a dated source directory and listed
in that directory's `index.json`. A review may also have a `review-summary.json`
for non-actionable findings, reported validation, and overall conclusions. A
summary preserves evidence but is not itself an accepted proposal. Batch adjudication should update each item's
`state.decision`, `state.decided_on`, `state.decided_by`, and
`state.decision_rationale`. Accepted items must then follow the repository's
normal format-versioning rules before implementation.

Documentation-only proposal intake does not itself change a format emitted or
accepted by `mktxt`, so it does not trigger a package or MKTCTX version bump.
