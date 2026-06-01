"""
Approximate historical Brazilian arabica production, in 1000 60kg bags.

Source: USDA PSD historical series (production, arabica only). Approximate —
values rounded to the nearest 100k bags. Real numbers vary slightly between
USDA, CONAB, and ICO; the absolute level matters less than the year-over-year
SHAPE for analog forecasting (the visible biennial up/down cycle is what
drives the signal).

The crop "year" key is the calendar year of the harvest (Brazilian arabica
harvest = May-Sep of year Y, produced by weather Aug Y-1 to May Y). Replace
this seed with the real CONAB safra series when one is plumbed in (a future
PR can read directly from CONAB's API or annual report PDFs).
"""

# {harvest_calendar_year: production_1000_60kg_bags}
BRAZIL_ARABICA_PRODUCTION: dict[int, int] = {
    1996: 16500,
    1997: 28500,
    1998: 23000,
    1999: 34200,
    2000: 22000,
    2001: 31300,
    2002: 23300,
    2003: 41000,
    2004: 24700,
    2005: 33500,
    2006: 26000,
    2007: 37500,
    2008: 32000,
    2009: 41800,
    2010: 32700,
    2011: 39400,
    2012: 32800,
    2013: 43400,
    2014: 38000,
    2015: 35200,
    2016: 36400,
    2017: 43700,
    2018: 32500,
    2019: 47500,
    2020: 37900,
    2021: 48700,
    2022: 31300,
    2023: 38400,
    2024: 44800,
    2025: 39800,
}


def yoy_change_pct(year: int) -> float | None:
    """Year-over-year production change (% change of year vs year-1).
    Returns None if either year is missing from the seed."""
    cur = BRAZIL_ARABICA_PRODUCTION.get(year)
    prev = BRAZIL_ARABICA_PRODUCTION.get(year - 1)
    if cur is None or prev is None or prev == 0:
        return None
    return round((cur - prev) / prev * 100, 1)
