# NEEDS NATIVE-SPEAKER REVIEW
# All regional-language templates below were produced as a draft by the
# development team. They MUST be reviewed by a native speaker before any
# clinical use. Until then the UI shows "template pending native review".

from __future__ import annotations

import os

# Supported languages: default Hindi. Override with REGIONAL_LANG=hi|mr|ta.
SUPPORTED = ("hi", "mr", "ta")

# Slot placeholders only — {DRUG_1}, {FOLLOWUP_DATE}, {INTERVENTION}.
# List format so a slot never breaks a word ending.
TEMPLATES: dict[str, str] = {
    "hi": (
        "Ghar jaane ke baad ka nirdesh\n"
        "- Apni {DRUG_1} doctor ke nirdesh ke anusaar lein. Dose skip ya double na karein.\n"
        "- Aapki care team ne {INTERVENTION} schedule kiya hai. Aapki follow-up date {FOLLOWUP_DATE} hai.\n"
        "- Aaram karein, khana aur paani normal tarah se lein.\n"
        "- Agar tabiyat bahut kharab ho, turant emergency ya apni care team ko call karein.\n"
        "- Yeh paper apne agle visit par le jaayein."
    ),
    "mr": (
        "Gharagelgi nirdesh\n"
        "- Tumchi {DRUG_1} doctoranchya nirdeshanusar ghyaa. Dose skip karoo naka.\n"
        "- Tumchya care team ne {INTERVENTION} schedule kele ahe. Follow-up date {FOLLOWUP_DATE}.\n"
        "- Vishraam ghyaa, jedha-pani samanya riti ne ghyaa.\n"
        "- Jar tabiyat khup kharaab zali tar turant emergency la ja.\n"
        "- He kaagad pudhchya visit la gheun ja."
    ),
    "ta": (
        "Veedu sellum podhu paadu\n"
        "- Unga {DRUG_1} doctor solliya padhiye seyyunga. Dose thavaraamal thavaraamal.\n"
        "- Unga care team {INTERVENTION} schedule pannirukkirargal. Follow-up thiyathi {FOLLOWUP_DATE}.\n"
        "- Oyvu edunga, samanya unavu neer seyyunga.\n"
        "- Unga uyirukku aspaththiriya irundhal emergency ku sellunga.\n"
        "- Indha varthai unga muthal visit ku kondu vaanga."
    ),
}

# English back-translation (readability aid only, not clinically verified)
BACK_TRANSLATION: dict[str, str] = {
    "hi": ("Back-translation (readability aid only, not clinically verified): "
           "Take your {DRUG_1} as the doctor directed; don't skip or double doses. "
           "Your care team scheduled {INTERVENTION}; follow-up on {FOLLOWUP_DATE}. "
           "Rest and eat and drink normally."),
    "mr": ("Back-translation (readability aid only, not clinically verified): "
           "Take your {DRUG_1} as the doctor directed. "
           "Your care team scheduled {INTERVENTION}; follow-up on {FOLLOWUP_DATE}. "
           "Rest and eat and drink normally."),
    "ta": ("Back-translation (readability aid only, not clinically verified): "
           "Take your {DRUG_1} as the doctor directed. "
           "Your care team scheduled {INTERVENTION}; follow-up on {FOLLOWUP_DATE}. "
           "Rest and eat and drink normally."),
}


def configured_lang() -> str:
    v = os.getenv("REGIONAL_LANG", "hi").strip().lower()
    return v if v in SUPPORTED else "hi"


def regional_template(lang: str) -> str:
    return TEMPLATES.get(lang, TEMPLATES["hi"])


def needs_review() -> bool:
    return True   # remove this line once native review is done
