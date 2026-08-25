# Platform_Core

Shared foundation for the [AI Interviewer](https://github.com/MNEMOS-PREP)
platform. Every module repo depends on this — one definition of what a sourced
fact looks like, how the database is wired, and what happens when an upstream
module isn't running.

**This exists so nineteen repos cannot drift apart.** If each module owned a
copy of `Provenance.tsx`, the copies would diverge and "every fact shows its
source" would quietly stop being true in whichever module fell behind — while
that module's own tests kept passing. Versioning it makes divergence a
deliberate, visible act.

---

## Install

Pin a tag. Never track `main` from a module repo — that is how you get
surprise breakage on a Tuesday.

**Frontend**

```json
{
  "dependencies": {
    "@ai/core": "github:MNEMOS-PREP/Platform_Core#v0.1.0"
  }
}
```

**Backend**

```bash
pip install "ai-core @ git+https://github.com/MNEMOS-PREP/Platform_Core@v0.1.0#subdirectory=python"
```

Upgrading is deliberate: bump the tag, run your module's tests, commit the
bump. Your module keeps working on the old version until you choose to move.

---

## What's in it

### Frontend — `@ai/core`

| Export | What it's for |
|---|---|
| `SourceChip` | Any fact. Opens the full source list with dates. |
| `VerificationBadge` | Confirmed / community-reported / reports-disagree |
| `CommunityTray` | Single-source facts. **Never render these inline.** |
| `ContestedFact` | Two versions side by side with counts |
| `StaleBadge` | Old data — shown with its age, never silently |
| `CompanySaysVsStudentsReport` | Official claims beside lived experience |
| `DependencyAlert` | Page banner: what's switched off and which module it needs |
| `DegradedSection` | Inline replacement for a section that couldn't be built |
| `DependencyTable` | Developer view of upstream health |
| `MasteryBar` | The five mastery states. **Cannot render a number for a state that has none.** |
| `NotYetTested` | The collapsed count for untested concepts — never a row of empty bars |
| `Icon` | The icon set. 40 stroke glyphs, `currentColor`, no emoji anywhere |
| `Card` `Button` `EmptyState` `Spinner` `ErrorNote` | Shared states, for a module that has not grown its own |
| `api` `relativeDays` `MODULES` | Fetch wrapper, formatting, module registry |

`Layout`, `ModulePlaceholder` and `NavItem` were removed in 0.7.0. **A module
owns its own frame.** `Layout` claimed a shared one and was imported by nothing;
the only module with a UI had already replaced it and disagreed with it on every
value. What makes the platform one product is the vocabulary underneath the
frame — the provenance components, the mastery bar, the icon set and the tokens
— not a shared header.

```tsx
import { DependencyAlert, SourceChip, Icon } from "@ai/core";
import "@ai/core/styles.css";
```

### Design tokens

`styles.css` owns the palettes, **including dark mode**, so a module inherits
them rather than re-picking them. Beyond the verification and mastery states:
`--color-on-brand` (the label on a brand fill — never `text-white`),
`--color-surface-raised`, `--color-scrim`, a six-hue **categorical** palette
(identity, never quality), a five-step **sequential** ramp (magnitude), five
**transient session state** colours, and an **evaluator-agreement** hue.

Those last four exist because ten of the nineteen §8 specifications reach for a
colour that has no token, and the nearest thing to hand is always the
verification palette. If a failing test, a rejected candidate and a recording
indicator all render in `contested` red, then `contested` stops meaning "reports
disagree" and the platform's one real UI contract is gone.

A module may override any token — its stylesheet is imported after this one. It
must not define dark mode from scratch.

### Backend — `ai_core`

| Module | What it's for |
|---|---|
| `ai_core.config` | Settings; `DATABASE_URL` defaults to SQLite |
| `ai_core.db` | Engine, `create_all()`, `get_session()` dependency |
| `ai_core.modules_meta` | The 19-module registry, ports, spec paths |
| `ai_core.dependencies` | Upstream probing and graceful degradation |
| `ai_core.evidence` | `EvidenceRef` + resolution — Rule 3, as a type |
| `ai_core.concepts` | `Concept`, `ConceptEdge`, `normalise_alias` — the graph's shape |
| `ai_core.mastery` | The five states, decay, hysteresis. One definition, published. |
| `ai_core.timeutil` | One UTC clock. SQLite hands back naive datetimes; this is the fix. |
| `ai_core.schema_repair` | Additive `ALTER TABLE` on startup, so a pull never costs a dev their `dev.db` |
| `ai_core.models` | **The model roster.** Every LLM id the platform calls, named once |

---

## The two contracts added at v0.3.0

Both come from M04 §5, and both are here for the same reason `Provenance.tsx`
is: more than one module speaks them, and a second interpretation is how the
promise breaks.

**`EvidenceRef` — why a number is what it is.** M13 produces them, M04 stores
them, M19 projects over them, M16 renders them. Resolution is the part that
matters: the artifact must still exist, its checksum must match what was
recorded at write time, and a quoted span must really be at those offsets.

```python
from ai_core.evidence import EvidenceRef, resolve

result = resolve(ref, store)
result.state       # resolved | tombstoned | unresolvable
result.storable    # tombstoned counts: retention deleting a recording must
                   # not erase a student's history (M04 EC-4.9)
```

**The five mastery states — "not tested" is not zero.** Rendered by M04, M05,
M15, M16 and M19.

```python
from ai_core.mastery import evaluate

view = evaluate(theta=1.2, se=0.3, n_direct=5, last_evidence_at=then)
view.state         # not_tested | emerging | weak | adequate | strong
view.mastery_p     # None when there is nothing to claim — NEVER 0.0
view.stale         # decayed, but the bar is held open by hysteresis
```

Decay widens the error bar and never lowers the estimate: a student must never
appear to get worse by doing nothing.

---

## The model roster (v0.8.0)

Nineteen modules will each want a route to a model. If each hardcodes an id, a
deprecation updates one module and leaves eighteen calling a dead name — and
each reports it as a different kind of outage.

**A module names a tier. This package says which model that is today.**

```python
from ai_core.models import resolve

route = resolve("generation")          # or "extraction" | "classification" | "guard"
if not route:
    log.info("generation off: %s", route.unusable)   # never raises
else:
    route.model, route.provider.base_url, route.keys, route.profile.json_schema
```

Change one line in `_TIER_MODEL` and every module moves with it. Override
without an edit: `AI_MODEL_GENERATION` platform-wide, or a per-job env name a
module passes as `job_env` when one call needs something different.

`RETIRED` is the half people skip. M15 named `llama-3.1-8b-instant` for two of
its three jobs; that model 404s on the platform's account, so both calls failed
on every run and the only record of the name was one module's `keys.txt`. An id
in `RETIRED` is refused with the reason it was retired, instead of reaching a
provider and coming back as a 404 that reads like a bad key.

```bash
python -c "from ai_core.models import verify; print(*verify(), sep='
')"
```

`verify()` is the only function here that opens a socket, and nothing in the
suite calls it. It lists each provider's models and reports whether the roster's
ids are actually served — the command that would have caught the M15 drift the
day it happened.

**Send `ai_core.models.USER_AGENT` on every request.** Groq is behind
Cloudflare, and a default `Python-urllib/3.x` is answered with HTTP 403 and body
`error code: 1010` — a browser-signature ban that reads exactly like a rejected
API key. Two modules have now lost time to it.

---

## The degradation contract

The platform has three rules (see any module's spec). This package encodes the
second one at the service layer:

> **A missing dependency narrows the SCOPE of what we show, never the quality,
> and never silently.**

A module must not crash because an upstream is down. It drops the feature that
needed it, names the missing module, and renders everything else.

```python
from ai_core.dependencies import DependencyRegistry

deps = DependencyRegistry.from_manifest("module.json")

theta = fetch_theta(candidate_id) if deps.is_available("M04") else None
page.degraded = deps.degraded()      # -> the UI banner
```

```tsx
<DependencyAlert degraded={page.degraded} />
```

Declare dependencies in your module's `module.json`:

```json
{
  "module": "M15",
  "depends_on": [
    {
      "module": "M04",
      "name": "Skill Graph & MNEMOS Memory",
      "reason": "candidate theta per topic",
      "on_missing": "Your preparation — needs M04 to compare you against this drive's bar",
      "base_url": "http://127.0.0.1:8104",
      "required": false
    }
  ]
}
```

`on_missing` is shown to a student. Write it as a sentence they can act on, not
as an error code.

**Keep `required: false` unless the module genuinely cannot do its job without
the upstream.** Marking a dependency required turns someone else's outage into
your outage.

Point at a running instance without editing the manifest:

```bash
M04_BASE_URL=http://127.0.0.1:8104
```

---

## Development

```bash
npm install && npm run typecheck

cd python
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m ruff check .
```

## Platform TODO

Cross-cutting work that belongs to no single module lives in
[PLATFORM_TODO.md](PLATFORM_TODO.md). The top item is that the platform has no
identity: every module takes `candidate_id` from the caller and returns that
student's data to whoever asked.

## Releasing

Changing this package changes every module. Three rules:

1. **Additive changes only within a minor version.** Renaming or removing an
   export breaks nineteen repos at once.
2. **Tag every release.** Module repos pin tags; an untagged change is
   unreachable and an unpinned one is a future outage.
3. **Move all four version declarations in the same commit.**

   ```
   package.json              "version"
   src/index.ts              CORE_VERSION
   python/pyproject.toml     version
   python/ai_core/__init__.py __version__
   ```

   This has now been got wrong twice, the same way both times: the TypeScript
   half moves and the Python half does not, and it stays wrong for two releases
   because nothing looks. `python/tests/test_version_parity.py` reads all four
   as files and fails if they disagree — it reads `__version__` from source
   rather than importing it, because this package is installed into each
   module's virtualenv as a copy and `import ai_core` inside this checkout can
   resolve to a snapshot from a different release.

```bash
git tag v0.2.0 && git push origin v0.2.0
```

Then bump the tag in each module repo when that team is ready — not before.

## Licence

MIT. See [LICENSE](LICENSE).
