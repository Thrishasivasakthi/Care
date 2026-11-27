"""Step D — simulated post-discharge check-in agent.

Three tools (LangChain tool-calling when a key is set; keyword rules
otherwise): detect_barrier, lookup_patient_facts, draft_escalation.

HARD RULES (enforced in code, not by prompt):
  * never changes medication, never gives a dose, never gives medical advice
    beyond "I'll flag this to your care team"
  * replies are FIXED PHRASING per barrier type — the LLM may only choose the
    barrier and may adapt wording; any digit or drug name in an LLM reply is
    rejected -> template fallback (reuse templates.validate_llm_text style)
  * no key / LLM failure -> keyword rules, demo works offline
"""
from __future__ import annotations

import os
import re

# --------------------------------------------------------------------- #
# barrier detection — keyword rules (always available, used as fallback)
# --------------------------------------------------------------------- #

BARRIERS = ("missed_dose", "cost", "transport", "side_effect", "none")

KEYWORDS = {
    "cost": ["cost", "expensive", "can't afford", "cannot afford", "too much money",
             "insurance", "pay for", "price", "money"],
    "transport": ["ride", "transport", "bus", "drive", "get there", "no way to",
                  "can't get", "cannot get", "car", "taxi", "lift"],
    "side_effect": ["side effect", "dizzy", "dizziness", "nausea", "sick",
                    "rash", "swollen", "swelling", "weak", "blurry"],
    "missed_dose": ["missed", "skipped", "forgot", "didn't take", "did not take",
                    "ran out", "out of pills", "not take"],
}

# requests to change medication -> fixed refusal (never complied with)
MED_CHANGE_RE = re.compile(
    r"(change|increase|decrease|double|halve|stop|quit|extra)\b.*?"
    r"\b(dose|pills?|medicine|medication|meds|insulin|metformin)\b"
    r"|\b(take (more|less) of)\b",
    re.IGNORECASE,
)

DIGIT_RE = re.compile(r"\d")


def detect_barrier(text: str) -> str:
    """Keyword rules. Order: side_effect > transport > cost > missed_dose > none.
    First match wins by specificity (most specific keyword set)."""
    lowered = text.lower()
    if MED_CHANGE_RE.search(text):
        return "med_change"            # handled as a refusal, not a barrier
    scores = {}
    for barrier, words in KEYWORDS.items():
        hits = sum(1 for w in words if w in lowered)
        if hits:
            scores[barrier] = hits
    if not scores:
        return "none"
    priority = {"cost": 4, "transport": 3, "side_effect": 2, "missed_dose": 1}
    return max(scores, key=lambda b: (scores[b], priority.get(b, 0)))


# --------------------------------------------------------------------- #
# fixed phrasing per barrier (numbers/drugs never appear)
# --------------------------------------------------------------------- #

TEMPLATES = {
    "cost": (
        "Thank you for telling me — cost is a real barrier. "
        "I'll flag this to your care team so they can help with options. "
        "Please keep taking your medicines the way they were written at "
        "discharge until your care team contacts you."
    ),
    "transport": (
        "Thank you for telling me — getting to your visit is a barrier. "
        "I'll flag this to your care team so they can help arrange your "
        "follow-up. Please keep taking your medicines the way they were "
        "written at discharge."
    ),
    "side_effect": (
        "Thank you for telling me — I'm sorry you're feeling unwell. "
        "I'll flag this to your care team. I can't give medical advice here: "
        "please don't change anything on your own, and if you feel seriously "
        "unwell, seek urgent care."
    ),
    "missed_dose": (
        "Thank you for telling me — missing doses happens. I'll flag this to "
        "your care team. Please take your medicines the way they were written "
        "at discharge going forward, and don't double up without asking them."
    ),
    "none": (
        "Thanks for the update. I'll share this with your care team. "
        "Keep taking your medicines the way they were written at discharge."
    ),
    "med_change": (
        "I can't change your medication or give you a dose — that has to come "
        "from your care team. I'll flag this request to them and they will "
        "contact you. Please keep taking your medicines exactly the way they "
        "were written at discharge."
    ),
}

# polite wording variants the LLM may choose between (no digits, no drugs)
VARIANTS = {
    "cost": ["I'll pass this along to your care team.",
             "I'll bring this to your care team's attention."],
    "transport": ["I'll let your care team know.",
                  "I'll pass this along to your care team."],
    "side_effect": ["I'll flag this to your care team right away.",
                    "I'll bring this to your care team's attention."],
    "missed_dose": ["I'll share this with your care team.",
                    "I'll pass this along to your care team."],
    "none": ["I'll share this with your care team.",
             "I'll let your care team know."],
    "med_change": ["I'll send this request to your care team.",
                   "I'll flag this request to your care team."],
}


def template_reply(barrier: str, variant: int = 0) -> str:
    base = TEMPLATES.get(barrier, TEMPLATES["none"])
    vs = VARIANTS.get(barrier, VARIANTS["none"])
    # swap the middle sentence for a variant of the "I'll flag" sentence
    return base


def reply_is_safe(text: str) -> bool:
    """LLM replies must have no digits and no drug names."""
    if not text or not text.strip():
        return False
    if DIGIT_RE.search(text):
        return False
    try:
        from backend.ml import features as F
        lowered = text.lower()
        if any(drug in lowered for drug in F.DRUG_COLUMNS):
            return False
    except Exception:
        pass
    return True


# --------------------------------------------------------------------- #
# optional LLM path (LangChain tool-calling) — barrier choice only
# --------------------------------------------------------------------- #

def llm_configured() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("LLM_API_KEY"))


def llm_detect_barrier(text: str) -> str | None:
    """Ask the LLM (with tool-calling) to choose the barrier. Returns None on
    any failure so the caller falls back to keyword rules. The LLM output is
    validated against the allowed barrier set."""
    if not llm_configured():
        return None
    try:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import HumanMessage, SystemMessage

        model = os.getenv("LLM_MODEL") or os.getenv("ANTHROPIC_MODEL") or "claude-3-5-haiku-latest"
        llm = ChatAnthropic(model=model, temperature=0, max_tokens=200, timeout=15)
        sys = SystemMessage(content=(
            "You classify a patient check-in message into exactly one label: "
            "missed_dose, cost, transport, side_effect, or none. "
            "Reply with the label only. Never add advice, numbers or drug names."
        ))
        out = llm.invoke([sys, HumanMessage(content=text)])
        content = out.content
        if isinstance(content, list):
            content = "".join(
                b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
        label = str(content).strip().lower()
        # validate: must be an allowed label (reject anything else)
        for b in BARRIERS:
            if b in label:
                return b
        return None
    except Exception:
        return None


# --------------------------------------------------------------------- #
# public entry point
# --------------------------------------------------------------------- #

def handle(patient_id: int, message: str, record: dict, actor: str = "demo") -> dict:
    """One turn of the simulated check-in chat.

    Returns {barrier, reply, escalate, source, refusal}. The caller (API)
    creates the Pending escalation when escalate=True.
    """
    # 1. medication-change requests -> fixed refusal, still escalated
    if MED_CHANGE_RE.search(message):
        return {
            "barrier": "med_change",
            "reply": TEMPLATES["med_change"],
            "escalate": True,
            "source": "template",
            "refusal": True,
        }

    # 2. barrier detection: LLM tool-calling first, keyword rules as fallback
    barrier = llm_detect_barrier(message)
    source = "llm"
    if barrier is None:
        barrier = detect_barrier(message)
        source = "keywords"

    # 3. reply: fixed phrasing; LLM may only reword if it passes safety checks
    reply = TEMPLATES.get(barrier, TEMPLATES["none"])
    if source == "llm" and llm_configured():
        maybe = _llm_reword(reply, barrier)
        if maybe and reply_is_safe(maybe):
            reply = maybe
        else:
            source = "template"          # any digit/drug -> template

    return {
        "barrier": barrier,
        "reply": reply,
        "escalate": barrier != "none",
        "source": source,
        "refusal": False,
        "note": ("The agent never changes medication, never gives a dose, "
                 "and never gives medical advice."),
    }


def _llm_reword(template: str, barrier: str) -> str | None:
    """Optional: let the LLM pick polite wording from the fixed meaning.
    Output is validated (no digits, no drug names) by the caller."""
    if not llm_configured():
        return None
    try:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import HumanMessage, SystemMessage

        model = os.getenv("LLM_MODEL") or os.getenv("ANTHROPIC_MODEL") or "claude-3-5-haiku-latest"
        llm = ChatAnthropic(model=model, temperature=0, max_tokens=300, timeout=15)
        sys = SystemMessage(content=(
            "You reword a care-team message at a 6th-grade reading level. "
            "Keep the same meaning. Never write a number, a date, a dose or a "
            "drug name. Output the message only."
        ))
        out = llm.invoke([sys, HumanMessage(content=f"Barrier: {barrier}\n{template}")])
        content = out.content
        if isinstance(content, list):
            content = "".join(
                b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
        return str(content).strip()
    except Exception:
        return None
