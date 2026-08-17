"""ai-core — shared backend foundation for the AI Interviewer platform.

Every module package imports from here rather than duplicating wiring, so there
is exactly one definition of how we connect to the database, what the modules
are, and how a module behaves when an upstream is missing.

    from ai_core.config import settings
    from ai_core.db import create_all, get_session
    from ai_core.dependencies import DependencyRegistry
    from ai_core.modules_meta import MODULES, module_status
    from ai_core.schema_repair import ensure_schema

v0.3.0 adds the contracts M04 §5.1 and §5.3 require to live outside any one
module, because more than one module speaks them:

    from ai_core.evidence import EvidenceRef, EvidenceSpan, resolve
    from ai_core.concepts import Concept, ConceptEdge, normalise_alias
    from ai_core.mastery import MasteryState, evaluate, se_effective, state
    from ai_core.timeutil import utcnow

The test for whether something belongs here is the one `dependencies.txt`
already applies to the provenance components: *is this a promise the platform
makes, or is it one module's implementation?* `EvidenceRef` is the first —
"every number traces to evidence" is only true if every repo means the same
thing by a reference — and so is the five-state mastery rule, which five
surfaces render and none of them may reinterpret. Layout and chrome are not,
and stay module-local.
"""

__version__ = "0.4.0"

from ai_core.concepts import (
    Concept,
    ConceptDomain,
    ConceptEdge,
    ConceptLevel,
    EdgeKind,
    normalise_alias,
)
from ai_core.dependencies import (
    DegradedFeature,
    Dependency,
    DependencyRegistry,
    DependencyStatus,
)
from ai_core.evidence import (
    ArtifactState,
    ArtifactStore,
    EvidenceRef,
    EvidenceResolution,
    EvidenceSpan,
    EvidenceState,
    UnresolvableEvidence,
    resolve,
    sha256_hex,
)
from ai_core.mastery import (
    STATE_THRESHOLDS_VERSION,
    MasteryState,
    MasteryView,
    evaluate,
    gap_severity,
    mastery_p,
    se_effective,
    state,
)
from ai_core.modules_meta import MODULES, ModuleMeta, ModuleStatus, all_statuses, module_status
from ai_core.schema_repair import ensure_schema
from ai_core.timeutil import as_utc, days_between, utcnow
from ai_core.versions import UNKNOWN_SHA, VersionStamp

__all__ = [
    "MODULES",
    "STATE_THRESHOLDS_VERSION",
    "ArtifactState",
    "ArtifactStore",
    "Concept",
    "ConceptDomain",
    "ConceptEdge",
    "ConceptLevel",
    "DegradedFeature",
    "Dependency",
    "DependencyRegistry",
    "DependencyStatus",
    "EdgeKind",
    "EvidenceRef",
    "EvidenceResolution",
    "EvidenceSpan",
    "EvidenceState",
    "MasteryState",
    "MasteryView",
    "ModuleMeta",
    "ModuleStatus",
    "UNKNOWN_SHA",
    "UnresolvableEvidence",
    "VersionStamp",
    "__version__",
    "all_statuses",
    "as_utc",
    "days_between",
    "ensure_schema",
    "evaluate",
    "gap_severity",
    "mastery_p",
    "module_status",
    "normalise_alias",
    "resolve",
    "se_effective",
    "sha256_hex",
    "state",
    "utcnow",
]
