"""IPHM (Integrated Plant Health Management) v1 ruleset.

Authoritative source-of-truth for the agronomic alert engine. Each rule is a
declarative spec the engine in `scraper.agronomic_alerts` evaluates against
the live weather + VHI feeds. Threshold semantics:

  *_min:  the field's value must be >= the threshold for the condition to hold
  *_max:  the field's value must be <= the threshold for the condition to hold

Fields the engine recognises (must match keys produced by
`agronomic_alerts.extract_region_values`):

  spi_1, spi_3           Standardised Precipitation Index, monthly / 3-month
  spei_1, spei_3         SPEI (water-balance), monthly / 3-month
  vhi                    NOAA STAR Vegetation Health Index (0–100)
  temp_mean              Latest observed monthly mean temperature, °C
  temp_min               7-day forecast min temperature (worst-case across days), °C
  forecast_7d_rain       Sum of the next 7 days' forecast rain, mm

Optional rule keys:
  origins  list[str]  ISO-3 country codes the rule applies to (default: all)
  months   list[int]  Calendar months 1-12 the rule applies to (default: all)

Severity tiers (strict lowercase to match the existing quant-signal
convention; presentation layer applies any title-casing for display):
  "watch"     — informational; visually contained
  "alert"     — act-soon
  "critical"  — act-now
"""

IPHM_RULES: list[dict] = [
    {
        "threat_id": "fungal_rust_outbreak",
        "name": "Elevated Fungal / Leaf Rust Risk",
        "conditions": {
            "spi_1_min":      1.5,    # Extremely wet 1-month rolling
            "temp_mean_min":  21.0,   # Ideal fungal incubation temp
            "temp_mean_max":  25.0,
        },
        "severity": "alert",
        "market_impact": "High probability of bean defects and yield reduction.",
    },
    {
        "threat_id": "severe_defoliation",
        "name": "Severe Defoliation / Bean Shrinkage",
        "conditions": {
            "vhi_max":     35.0,      # High vegetative stress
            "spei_3_max": -1.5,       # Prolonged 3-month drought
        },
        "severity": "critical",
        "market_impact": "Irreversible yield reduction likely. Bean size shrinkage.",
    },
    {
        "threat_id": "brazil_frost_risk",
        "name": "Critical Frost Threat",
        "origins": ["BRA"],            # Only evaluate for Brazil
        "months":  [5, 6, 7, 8],       # May through August only
        "conditions": {
            "temp_min_max": 3.0,       # Minimum temp dropping below 3 °C
        },
        "severity": "critical",
        "market_impact": "Immediate systemic threat to next year's vegetative growth.",
    },
    {
        "threat_id": "blossom_drop",
        "name": "Flowering Disruption / Blossom Drop",
        "conditions": {
            "spei_3_max":            -1.0,   # Was in drought…
            "forecast_7d_rain_min":  50.0,   # …followed by sudden heavy rain forecast
        },
        "severity": "watch",
        "market_impact": "Potential false flowering or dropped blossoms. Harvest delay.",
    },
]
