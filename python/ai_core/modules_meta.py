"""The module registry.

Single source of truth in code for what the 19 modules are, where their spec
lives, and which are actually implemented. Mirrors plan_in_depth/README.md and
PORTS.txt — if you change one, change all three.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True)
class ModuleMeta:
    id: str
    num: int
    name: str
    slug: str
    #: Folder name, identical in plan_in_depth/, sys_design/, Backend/ and
    #: Frontend/ — deliberately, so spec and code map at a glance.
    folder: str
    phase: str
    owner: str
    implemented: bool
    reserved_port: int

    @property
    def backend_package(self) -> str:
        return f"backend_{self.folder}"

    @property
    def frontend_package(self) -> str:
        return f"frontend_{self.folder}"


# id   name                                  slug            folder                        phase  owner    built
_TABLE = [
    ("M01", "Resume Ingestion & Claim Extraction", "resume",        "M01_Resume_Ingestion",       "1",   "E3",     False),
    ("M02", "JD Parser & Coverage Planner",        "jd",            "M02_JD_Parser",              "1",   "E3",     False),
    ("M03", "GitHub Analyzer & Forensics",         "github",        "M03_GitHub_Analyzer",        "1",   "E3",     False),
    ("M04", "Skill Graph & MNEMOS Memory",         "skill-graph",   "M04_Skill_Graph_Memory",     "1",   "E3",     False),
    ("M05", "Question Intelligence",               "questions",     "M05_Question_Intelligence",  "1-2", "E3",     False),
    ("M06", "Mock Interview Engine",               "mock",          "M06_Mock_Interview_Engine",  "1-2", "E2",     False),
    ("M07", "Live Coding & Auto-Judge",            "coding",        "M07_Live_Coding",            "1",   "E2",     False),
    ("M08", "System Design Canvas",                "system-design", "M08_System_Design_Canvas",   "2",   "E2",     False),
    ("M09", "ML / Research Viva",                  "viva",          "M09_ML_Research_Viva",       "2",   "E1",     False),
    ("M10", "Aptitude & OA Engine",                "aptitude",      "M10_Aptitude_OA_Engine",     "2",   "E3",     False),
    ("M11", "Voice & Conversation Engine",         "voice",         "M11_Voice_Engine",           "3",   "E2",     False),
    ("M12", "Multimodal Analysis Suite",           "multimodal",    "M12_Multimodal_Suite",       "3",   "E1+E3",  False),
    ("M13", "Evaluation Engine",                   "evaluation",    "M13_Evaluation_Engine",      "1",   "E1",     False),
    ("M14", "Group Discussion Arena",              "gd",            "M14_GD_Arena",               "3",   "E2",     False),
    ("M15", "Company Guider",                      "companies",     "M15_Company_Guider",         "3",   "E3",     True),
    ("M16", "Counselor & Study Plan",              "counselor",     "M16_Counselor",              "4",   "E3",     False),
    ("M17", "Communication Coach",                 "communication", "M17_Communication_Coach",    "3",   "E1",     False),
    ("M18", "Integrity & Proctoring",              "integrity",     "M18_Integrity",              "3",   "E2",     False),
    ("M19", "Reports & Evidence Ledger",           "reports",       "M19_Reports_Dashboards",     "2-4", "E3",     False),
]

#: Reserved ports follow the formula in PORTS.txt: backend 8100 + module number.
MODULES: tuple[ModuleMeta, ...] = tuple(
    ModuleMeta(
        id=mid,
        num=num,
        name=name,
        slug=slug,
        folder=folder,
        phase=phase,
        owner=owner,
        implemented=built,
        reserved_port=8100 + num,
    )
    for num, (mid, name, slug, folder, phase, owner, built) in enumerate(_TABLE, start=1)
)

BY_ID = {m.id: m for m in MODULES}


class ModuleStatus(BaseModel):
    """What a module reports about itself."""

    id: str
    name: str
    slug: str
    phase: str
    owner: str
    implemented: bool
    spec: str
    reserved_port: int
    detail: str


def module_status(module_id: str) -> ModuleStatus:
    m = BY_ID[module_id]
    detail = (
        "Implemented."
        if m.implemented
        else (
            "Not implemented yet. The package and routes exist so this module is "
            "visible in the schema and callers can tell 'not built' from 'broken'."
        )
    )
    return ModuleStatus(
        id=m.id,
        name=m.name,
        slug=m.slug,
        phase=m.phase,
        owner=m.owner,
        implemented=m.implemented,
        spec=f"plan_in_depth/{m.folder}.md",
        reserved_port=m.reserved_port,
        detail=detail,
    )


def all_statuses() -> list[ModuleStatus]:
    return [module_status(m.id) for m in MODULES]
