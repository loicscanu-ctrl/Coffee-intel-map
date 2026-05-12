# Stocks-fetch diagnostic

- commit: `dba1d3c462988401c72a9f34d6ff43178037d1ec`
- run:    https://github.com/loicscanu-ctrl/Coffee-intel-map/actions/runs/25758166365
- date:   2026-05-12 19:46 UTC

## Verdict
- PSD scraper cache written : yes

## Stage 1 — bare requests probe
```
════════════════════════════════════════════════════════════
             Stocks-scraper connectivity check              
════════════════════════════════════════════════════════════

[USDA PSD] https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip
  status     : 200
  bytes      : 431,553
  Content-Type: application/x-zip-compressed
  zip contents: ['psd_coffee.csv']
  csv rows    : 85,938
  Japan rows  : 456
  EU rows     : 456
  ✓ sample Japan row:
    0711100,"Coffee, Green",JA,"Japan",2002,2015,06,029,"Arabica Production",02,"(1000 60 KG BAGS)",0.0000
  ✓ sample EU row:
    0711100,"Coffee, Green",E4,"European Union",2002,2015,06,029,"Arabica Production",02,"(1000 60 KG BAGS)",0.0000
════════════════════════════════════════════════════════════
  USDA PSD coffee (EU + Japan) : ✓
════════════════════════════════════════════════════════════
```

## Stage 2 — real PSD scraper run
```
[psd_coffee] EU 2025 imp=2820000 MT stocks=468000 MT | Japan 2025 imp=360000 MT stocks=126000 MT
```
