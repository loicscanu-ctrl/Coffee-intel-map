from deep_translator import GoogleTranslator

def translate_to_english(text: str, source_lang: str) -> str:
    """Translate text to English. Returns original text on any failure."""
    if not text or source_lang == "en":
        return text
    try:
        return GoogleTranslator(source=source_lang, target="en").translate(text)
    except Exception:
        return text
