"""Plain-language discharge instructions (English only).

Contract (spec 4.6):
  * The LLM writes text containing ONLY slot placeholders:
    {DRUG_1}, {FOLLOWUP_DATE}, {INTERVENTION}.
  * CODE fills every slot from the patient record. The LLM never writes a
    drug name, date, dose or number - if it does, we discard it.
  * No key / LLM failure / invalid output / unfilled slot -> fixed template.
  * `verified` is True only when code confirms every slot was filled from
    the record (no placeholder left behind).

Every LLM use has a no-LLM fallback: this module works with no key set.
"""

from __future__ import annotations

import os
import re
from datetime import date, timedelta

from backend.decision import catalog as cat
from backend.ml import features as F
from backend.language import regional as reg

ALLOWED_SLOTS = ("DRUG_1", "FOLLOWUP_DATE", "INTERVENTION")

SYSTEM_PROMPT = (
    "You write short discharge instruction text for patients at a 6th-grade "
    "reading level. You may ONLY use these placeholders: {DRUG_1}, "
    "{FOLLOWUP_DATE}, {INTERVENTION}. Never write a drug name, a number, a "
    "date or a dose. Never add medical advice of your own. Output 4-6 short "
    "sentences and nothing else."
)

_PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")
_DIGIT_RE = re.compile(r"\d")


# --------------------------------------------------------------------- #
# slots filled from the record (code, never the LLM)
# --------------------------------------------------------------------- #

def active_drugs(patient: dict) -> list[str]:
    drugs = patient.get("active_drugs") or []
    return [d for d in drugs if d]


def slot_values(
    patient: dict, intervention: dict | None, demo_date: date,
    followup_date: date | None = None,
) -> dict:
    """Compute every slot from the patient record and the shared task date."""
    drugs = active_drugs(patient)
    if followup_date is not None:
        followup = followup_date
    elif demo_date and intervention:
        followup = demo_date + timedelta(days=int(intervention["window_start_day"]))
    elif demo_date:
        followup = demo_date + timedelta(days=2)
    else:
        followup = None
    return {
        "DRUG_1": drugs[0] if drugs else None,
        "FOLLOWUP_DATE": followup.isoformat() if followup else None,
        "INTERVENTION": intervention["name"] if intervention else None,
    }


def fill(text: str, slots: dict) -> tuple[str, list[str]]:
    """Replace placeholders; return (filled_text, missing_slot_names)."""
    missing: list[str] = []

    def _sub(m: re.Match) -> str:
        name = m.group(1)
        value = slots.get(name)
        if value is None:
            if name not in missing:
                missing.append(name)
            return m.group(0)          # leave the placeholder visible
        return str(value)

    return _PLACEHOLDER_RE.sub(_sub, text), missing


# --------------------------------------------------------------------- #
# fixed template (always available)
# --------------------------------------------------------------------- #

def fallback_template(slots: dict) -> str:
    """Built by code. Drug sentence only appears when a drug slot exists."""
    if slots.get("DRUG_1"):
        drug_line = (
            "- Take your {DRUG_1} exactly the way your doctor wrote it down. "
            "Do not skip or double up on doses."
        )
    else:
        drug_line = (
            "- Take your medicines exactly the way your doctor wrote them down."
        )
    if slots.get("INTERVENTION"):
        plan_line = (
            "- Your care team scheduled: {INTERVENTION}. Your follow-up date "
            "is {FOLLOWUP_DATE}."
        )
    else:
        plan_line = (
            "- Your care team will call you about a follow-up visit. Your "
            "follow-up date is {FOLLOWUP_DATE}."
        )
    return (
        "Going home after your hospital stay\n"
        f"{drug_line}\n"
        f"{plan_line}\n"
        "- Keep eating and drinking as you usually do, and rest.\n"
        "- If you feel much worse, go to the emergency department or call "
        "your care team.\n"
        "- Bring this paper to your next visit."
    )


# --------------------------------------------------------------------- #
# LLM path (optional) + validation
# --------------------------------------------------------------------- #

def llm_configured() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("LLM_API_KEY"))


def llm_raw_text(slots: dict) -> str | None:
    """Ask the LLM for slot-only text. Returns None on any failure so the
    caller falls back. This is the ONLY place a model is called."""
    if not llm_configured():
        return None
    try:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.prompts import ChatPromptTemplate

        model = os.getenv("LLM_MODEL") or os.getenv("ANTHROPIC_MODEL") or "claude-3-5-haiku-latest"
        llm = ChatAnthropic(model=model, temperature=0, max_tokens=500, timeout=20)
        prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human", "Available slots: {slots}\nWrite the instruction text now."),
        ])
        message = (prompt | llm).invoke({"slots": ", ".join(ALLOWED_SLOTS)})
        content = message.content
        if isinstance(content, list):            # content blocks
            content = "".join(
                b.get("text", "") if isinstance(b, dict) else str(b) for b in content
            )
        return str(content).strip()
    except Exception:                            # no key, no network, any error
        return None


def validate_llm_text(text: str) -> bool:
    """Reject anything that invents a slot, hides a number, or names a drug."""
    if not text:
        return False
    found = set(_PLACEHOLDER_RE.findall(text))
    if not found.issubset(set(ALLOWED_SLOTS)):
        return False                             # invented slot such as {DOSE_1}
    if found != set(ALLOWED_SLOTS):
        return False                             # a required slot is missing
    without_slots = _PLACEHOLDER_RE.sub(" ", text)
    if _DIGIT_RE.search(without_slots):
        return False                             # the LLM wrote a number/date
    lowered = without_slots.lower()
    if any(drug in lowered for drug in F.DRUG_COLUMNS):
        return False                             # the LLM wrote a drug name
    return True


# --------------------------------------------------------------------- #
# public entry point
# --------------------------------------------------------------------- #

def render_discharge_instructions(
    patient: dict, intervention: dict | None, demo_date: date,
    followup_date: date | None = None,
) -> dict:
    slots = slot_values(patient, intervention, demo_date, followup_date)
    source = "fallback"
    text = fallback_template(slots)

    if llm_configured():
        raw = llm_raw_text(slots)
        if raw and validate_llm_text(raw):
            text, source = raw, "llm"

    filled, missing = fill(text, slots)
    verified = not missing and "{" not in filled
    slots_used = {k: v for k, v in slots.items() if v is not None}
    return {
        "text": filled,
        "source": source,
        "verified": verified,
        "missing_slots": missing,
        "slots_used": slots_used,
        "slots_filled": len(slots_used),
        "slots_total": len(ALLOWED_SLOTS),
        "llm_configured": llm_configured(),
        "note": (
            "Written by the LLM from slots only; every value filled from the "
            "patient record by code."
            if source == "llm"
            else "Fixed template (no LLM key or LLM output rejected); every "
                 "value filled from the patient record by code."
        ),
    }


# --------------------------------------------------------------------- #
# regional (Step E): same slot contract, different template
# --------------------------------------------------------------------- #

def render_regional_instructions(
    patient: dict, intervention: dict | None, demo_date: date,
    lang: str | None = None, followup_date: date | None = None,
) -> dict:
    lang = lang or reg.configured_lang()
    slots = slot_values(patient, intervention, demo_date, followup_date)
    text = reg.regional_template(lang)
    filled, missing = fill(text, slots)
    verified = not missing and "{" not in filled
    slots_used = {k: v for k, v in slots.items() if v is not None}
    bt_raw = reg.BACK_TRANSLATION.get(lang, "")
    bt_filled, _ = fill(bt_raw, slots)
    return {
        "text": filled,
        "source": "regional-template",
        "verified": verified,
        "missing_slots": missing,
        "slots_used": slots_used,
        "slots_filled": len(slots_used),
        "slots_total": len(ALLOWED_SLOTS),
        "language": lang,
        "back_translation": bt_filled,
        "needs_native_review": reg.needs_review(),
        "note": ("Fixed regional-language template (slot-based, code-filled). "
                 "Read the English back-translation; the regional text is "
                 "pending native-speaker review."),
    }


# --------------------------------------------------------------------- #
# simulated reminders (text only, nothing is sent)
# --------------------------------------------------------------------- #

def simulated_reminders(tasks: list[dict], demo_date: date) -> list[str]:
    lines = []
    for t in tasks:
        lines.append(
            f"[SIMULATED - NOT SENT] {demo_date.isoformat()} 09:00  "
            f"-> SMS text for patient {t.get('patient_id')}: "
            f"\"Hi, this is your care team. Reminder: {t['title']} is due "
            f"{t['due_date']}. Reply or call us if you need help.\""
        )
    if not lines:
        lines.append(
            f"[SIMULATED - NOT SENT] {demo_date.isoformat()} 09:00  "
            "-> No follow-up tasks yet, so no reminders were generated."
        )
    return lines
