from unittest.mock import MagicMock, patch

from scraper.translate import translate_to_english


def test_translate_english_passthrough():
    # English text should return unchanged without calling translator
    result = translate_to_english("Coffee prices rise", "en")
    assert result == "Coffee prices rise"

def test_translate_portuguese():
    with patch("scraper.translate.GoogleTranslator") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.translate.return_value = "Coffee price today"
        mock_cls.return_value = mock_instance

        result = translate_to_english("Preço do café hoje", "pt")
        assert result == "Coffee price today"
        mock_cls.assert_called_once_with(source="pt", target="en")

def test_translate_returns_original_on_failure():
    with patch("scraper.translate.GoogleTranslator") as mock_cls:
        mock_cls.side_effect = Exception("network error")
        result = translate_to_english("Preço do café hoje", "pt")
        assert result == "Preço do café hoje"

def test_translate_empty_string_passthrough():
    result = translate_to_english("", "pt")
    assert result == ""
