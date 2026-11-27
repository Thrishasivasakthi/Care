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
        "अस्पताल से घर जाने के बाद के निर्देश\n"
        "- अपनी {DRUG_1} दवा डॉक्टर के निर्देशानुसार लें। खुराक छोड़ें या दोगुनी न करें।\n"
        "- आपकी देखभाल टीम ने {INTERVENTION} तय किया है। आपकी फॉलो-अप तारीख {FOLLOWUP_DATE} है।\n"
        "- आराम करें और सामान्य रूप से खाना-पीना जारी रखें।\n"
        "- यदि आपकी तबीयत बहुत बिगड़ जाए, तो तुरंत आपातकालीन विभाग जाएँ या अपनी देखभाल टीम को कॉल करें।\n"
        "- इस कागज़ को अपनी अगली मुलाकात पर साथ लाएँ।"
    ),
    "mr": (
        "रुग्णालयातून घरी गेल्यानंतरच्या सूचना\n"
        "- {DRUG_1} औषध डॉक्टरांनी सांगितल्याप्रमाणे घ्या. मात्रा चुकवू नका किंवा दुप्पट घेऊ नका.\n"
        "- तुमच्या उपचार पथकाने {INTERVENTION} ठरवले आहे. तुमची फॉलो-अप तारीख {FOLLOWUP_DATE} आहे.\n"
        "- विश्रांती घ्या आणि नेहमीप्रमाणे खाणे-पिणे सुरू ठेवा.\n"
        "- प्रकृती खूप बिघडल्यास त्वरित आपत्कालीन विभागात जा किंवा उपचार पथकाशी संपर्क साधा.\n"
        "- पुढील भेटीला हे कागदपत्र सोबत आणा."
    ),
    "ta": (
        "மருத்துவமனையிலிருந்து வீடு திரும்பிய பின் கடைப்பிடிக்க வேண்டியவை\n"
        "- உங்கள் {DRUG_1} மருந்தை மருத்துவர் கூறியபடி எடுத்துக்கொள்ளுங்கள். அளவைத் தவிர்க்கவோ இரட்டிப்பாக எடுத்துக்கொள்ளவோ வேண்டாம்.\n"
        "- உங்கள் பராமரிப்புக் குழு {INTERVENTION} ஏற்பாடு செய்துள்ளது. உங்கள் தொடர் சந்திப்பு தேதி {FOLLOWUP_DATE}.\n"
        "- ஓய்வெடுத்து, வழக்கம்போல் உணவு மற்றும் தண்ணீர் எடுத்துக்கொள்ளுங்கள்.\n"
        "- உடல்நிலை மிகவும் மோசமடைந்தால் உடனடியாக அவசர சிகிச்சைப் பிரிவுக்குச் செல்லுங்கள் அல்லது பராமரிப்புக் குழுவை அழையுங்கள்.\n"
        "- அடுத்த மருத்துவச் சந்திப்பிற்கு இந்தத் தாளைக் கொண்டு வாருங்கள்."
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
