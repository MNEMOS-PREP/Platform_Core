"""ai-core — shared backend foundation for the AI Interviewer platform.

Every module package imports from here rather than duplicating wiring, so there
is exactly one definition of how we connect to the database, what the modules
are, and how a module behaves when an upstream is missing.

    from ai_core.config import settings
    from ai_core.db import create_all, get_session
    from ai_core.dependencies import DependencyRegistry
    from ai_core.modules_meta import MODULES, module_status
"""

__version__ = "0.1.0"

from ai_core.dependencies import (
    DegradedFeature,
    Dependency,
    DependencyRegistry,
    DependencyStatus,
)
from ai_core.modules_meta import MODULES, ModuleMeta, ModuleStatus, all_statuses, module_status

__all__ = [
    "MODULES",
    "DegradedFeature",
    "Dependency",
    "DependencyRegistry",
    "DependencyStatus",
    "ModuleMeta",
    "ModuleStatus",
    "__version__",
    "all_statuses",
    "module_status",
]
