"""App-wide constants. Day 0 for every timing window is today's demo date."""

from __future__ import annotations

from datetime import date

# Day 0 of every intervention timing window (demo discharge date).
DEMO_DATE: date = date.today()

SYSTEM_RULE = (
    "ML scores. Rules recommend. The optimizer prioritizes. "
    "The LLM only phrases. A clinician approves."
)

HONESTY = [
    "Intervention effect sizes and the timing curve are assumptions in a "
    "synthetic table, labelled \"assumption, not a prediction\" everywhere they appear.",
    "The LLM only phrases text from slots. It never scores, ranks, or recommends.",
    "Every high-risk flag needs clinician review; every decision is logged.",
    "Decision support only. Not a diagnostic tool. Dataset is old (1999-2008) "
    "and has diabetes drugs only.",
]

VALID_ROLES = ("coordinator", "clinician")

# request header carrying the demo role switcher
ROLE_HEADER = "X-Role"
ACTOR_HEADER = "X-User"
