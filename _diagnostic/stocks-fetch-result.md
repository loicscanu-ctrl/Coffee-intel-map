# Stocks-fetch diagnostic

- commit: `9942511955e06d14c50d6aef4d862db8349efd07`
- run:    https://github.com/loicscanu-ctrl/Coffee-intel-map/actions/runs/25757872715
- date:   2026-05-12 19:41 UTC
- runner: ubuntu-22.04 (20.169.74.226)

## Verdict
- ICE scraper cache written : no
- PSD scraper cache written : yes

## Stage 1 — bare requests probe (test_stocks_fetch.py)
```
════════════════════════════════════════════════════════════
             Stocks-scraper connectivity check              
════════════════════════════════════════════════════════════

[ICE] https://www.theice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls
  status     : 404
  bytes      : 196
  Content-Type: text/html; charset=iso-8859-1
  ✗ non-200 — ICE likely blocked this IP. Body preview:
<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"> <html><head> <title>404 Not Found</title> </head><body> <h1>Not Found</h1> <p>The requested URL was not found on this server.</p> </body></html> 

[PSD Japan] https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip
  status     : 200
  bytes      : 431,553
  Content-Type: application/x-zip-compressed
  zip contents: ['psd_coffee.csv']
  csv rows    : 85,938
  Japan rows  : 456
  ✓ sample Japan row:
    0711100,"Coffee, Green",JA,"Japan",2002,2015,06,029,"Arabica Production",02,"(1000 60 KG BAGS)",0.0000
════════════════════════════════════════════════════════════
  ICE Arabica certified : ✗
  USDA PSD Japan        : ✓
════════════════════════════════════════════════════════════
```

## Stage 1b — alternate ICE URL probes
```
Probing ICE candidate URLs ...
  https://www.theice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls
    404 196 text/html; charset=iso-8859-1 -> https://www.ice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls
  https://www.ice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls
    404 196 text/html; charset=iso-8859-1 -> https://www.ice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls
  https://www.ice.com/publicdocs/futures_us/coffee/Coffee_C_Cert_Stocks.xls
    404 196 text/html; charset=iso-8859-1 -> https://www.ice.com/publicdocs/futures_us/coffee/Coffee_C_Cert_Stocks.xls
  https://www.ice.com/publicdocs/Coffee_C_Cert_Stocks.xls
    404 196 text/html; charset=iso-8859-1 -> https://www.ice.com/publicdocs/Coffee_C_Cert_Stocks.xls
  https://www.theice.com/publicdocs/futures/Coffee_C_Cert_Stocks.xls
    404 196 text/html; charset=iso-8859-1 -> https://www.ice.com/publicdocs/futures/Coffee_C_Cert_Stocks.xls
  https://www.theice.com/marketdata/reports/126
    404 64437 text/html; charset=utf-8 -> https://www.ice.com/report/126
  https://www.theice.com/marketdata/reports/datawarehouse/ConsolidatedEndOfDayReportPDF.shtml?selectedReport=ICE_FUTURES_US_COFFEE_C_CERTIFIED_INVENTORIES
    200 104982 text/html; charset=utf-8 -> https://www.ice.com/report-center
    head(hex): 00000000: 3c21 444f 4354 5950 4520 6874 6d6c 3e3c  <!DOCTYPE html><
  https://www.ice.com/products/15/Coffee-C-Futures/data
    200 75601 text/html; charset=utf-8 -> https://www.ice.com/products/15/Coffee-C-Futures/data
    head(hex): 00000000: 3c21 444f 4354 5950 4520 6874 6d6c 3e3c  <!DOCTYPE html><
  https://www.theice.com/products/15/Coffee-C-Futures/data
    200 75601 text/html; charset=utf-8 -> https://www.ice.com/products/15/Coffee-C-Futures/data
    head(hex): 00000000: 3c21 444f 4354 5950 4520 6874 6d6c 3e3c  <!DOCTYPE html><
  https://www.ice.com/marketdata/reports/126?selectedReport=126
    404 64437 text/html; charset=utf-8 -> https://www.ice.com/report/126
  https://www.theice.com/marketdata/CertifiedReportsStocksCoffee.xls
    404 64416 text/html;charset=UTF-8 -> https://www.ice.com/marketdata/CertifiedReportsStocksCoffee.xls
  https://www.theice.com/clear_us/danotices
    404 64437 text/html; charset=utf-8 -> https://www.ice.com/clear_us/danotices
```

## Stage 2 — real ICE scraper run
```
[ice_certified] requests download failed: 404 Client Error: Not Found for url: https://www.ice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls
[ice_certified] requests blocked — falling back to Playwright
[ice_certified] No data — retaining cache
```

## Stage 3 — real PSD Japan scraper run
```
[psd_japan] 2025 imports=360000 MT stocks=126000 MT
```
