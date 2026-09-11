"""One use case per module.

**This is the convention the planner broke.** It arrived as a single 15 KiB
`meal_plan.py` holding thirteen classes, while the other twenty-six use cases
were one per file at under a kilobyte each. Nothing failed because of it — it was
simply the file nobody wanted to open, and the kitchens work would have pushed it
past 18 KiB.

The rule is worth a test rather than a note because it only ever breaks the same
way: someone adds a second class to an existing module because the import is
already there, and each addition looks harmless on its own.
"""

import ast
from pathlib import Path

import pytest

USE_CASES = Path(__file__).resolve().parents[2] / "src" / "app" / "use_cases"


def _modules() -> list[Path]:
    return sorted(p for p in USE_CASES.glob("*.py") if p.name != "__init__.py")


def test_there_are_use_cases_to_check() -> None:
    # Without this, a glob that silently matches nothing makes every test below
    # pass by vacuum.
    assert len(_modules()) > 20


@pytest.mark.parametrize("module", _modules(), ids=lambda p: p.name)
def test_a_module_holds_at_most_one_use_case(module: Path) -> None:
    tree = ast.parse(module.read_text())
    # A use case is a class with an `execute` method. Helper dataclasses and
    # exceptions living alongside one are fine and are not what this guards.
    use_cases = [
        node.name for node in tree.body if isinstance(node, ast.ClassDef) and any(isinstance(child, ast.FunctionDef) and child.name == "execute" for child in node.body)
    ]
    assert len(use_cases) <= 1, f"{module.name} holds {len(use_cases)} use cases: {use_cases}"
