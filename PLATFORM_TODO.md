# Platform TODO

Cross-cutting work that belongs to **no single module**. If an item can be
closed inside one repo, it belongs in that repo's `plan_in_depth/*_TODO.md`
instead — this file is for the things that are wrong in nineteen places at once,
and that therefore nobody currently owns.

Legend: ✅ done · 🟡 partly done · ⬜ not started

---

## 1. ⬜ There is no identity. Every module serves every student's data to anyone.

**Priority: highest.** Nothing else on this list can be correct until this is.

### What is true today

There is no login, no session, and no authorisation check anywhere. Every module
takes `candidate_id` as a **parameter supplied by the caller**, and returns that
candidate's data to whoever asked. Changing a UUID in a URL is the whole attack.

M01 makes this visible on purpose — its `AppShell` has a "candidate" control you
can type any id into, with a comment explaining that hardcoding one id or
generating a fresh one per load would each hide a different bug. That was the
right call for development and it is a live data-exposure hole the moment a
second real student exists.

The same shape is in every module that stores anything per student:

| Module | What leaks |
|---|---|
| M01 | Resumes, claims, red flags, **and the contact block** — name, email, phone |
| M04 | The whole skill graph and mastery history |
| M13 | Every score, with the verbatim answers they were computed from |
| M19 | The evidence ledger — by design, the record of everything |

M01's `GET /v1/resumes/{id}/contact` is the sharpest edge. It has its own route
and its own audit tag *specifically* so "who saw this student's phone number" is
answerable — and today the answer is "anyone who guessed a UUID".

### The related half: nobody can log in at all

A new student cannot arrive and get their own workspace. There is no signup, no
"my resumes", no way for the product to know it is the same person on Tuesday.
Every module's "already ingested" list is scoped to whatever id happens to be in
localStorage. The feature and the hole are the same missing piece.

### What it needs

This is a **contract** before it is an implementation, which is why it is here
and not in a module. `ai_core` already owns the shapes nineteen repos must agree
on — `EvidenceRef`, `DependencyStatus`, the mastery states. Identity is the same
kind of thing: if each module invents its own notion of "who is asking", they
will disagree, and the disagreement will be a leak rather than a bug.

- ⬜ **A `Principal` contract in `ai_core`** — who is asking, and in what role
      (student · placement officer · researcher · admin). One definition, read
      by all nineteen.
- ⬜ **A dependency every router can take** that resolves a request to a
      `Principal`, and a helper that says whether that principal may see a given
      `candidate_id`. The check has to be one call, or it will be skipped.
- ⬜ **Fail closed.** No principal → no candidate-scoped data. Not "the default
      candidate", not an empty list that looks like a normal empty state.
- ⬜ **Login and signup in `Platform_Shell`**, with the session available to
      every mounted module UI, replacing each module's local candidate control.
- ⬜ **`candidate_id` stops being a URL parameter** for student-facing reads.
      "My resumes" means the caller's, derived from the session — never from a
      value the caller typed.
- ⬜ **A test every module can import** that asserts a candidate-scoped endpoint
      refuses an unauthenticated request. A shared check, because nineteen
      hand-written ones is nineteen chances to forget.

### What already exists to build on

M01's `retention.py` has the *authorisation* half in miniature: `ShareGrant` and
`disclosure_for(...)` already answer "may this viewer see this student's claims"
and already fail closed to `aggregate_only`. It says so in its own docstring —
*"There is no auth in this platform yet, so this ANSWERS the question rather
than enforcing it."*  It is the right decision function waiting for a caller
that knows who is asking. Generalise it; do not rewrite it.

### Why it is not just "add auth later"

Two reasons it gets worse with time:

1. Every module built before this ships takes `candidate_id` from the caller,
   and each one becomes a call site to find and change.
2. §15 decision 4 — whether a placement officer may see an individual student's
   risky claims — cannot be *enforced* by anyone, only answered. The ethics
   sign-off and the placement cell's policy both land on a system that cannot
   act on either.
