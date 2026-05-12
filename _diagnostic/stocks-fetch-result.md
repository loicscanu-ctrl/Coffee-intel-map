# Stocks-fetch diagnostic

- commit: `2e2a66bd715a4b6ac31abc0e3dbc5b35a5e6ad8f`
- run:    https://github.com/loicscanu-ctrl/Coffee-intel-map/actions/runs/25758596664
- date:   2026-05-12 19:55 UTC

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

## Stage 3 — AJCA + ECF source catalog
```
════════════════════════════════════════════════════════════
  AJCA — All Japan Coffee Association probe
════════════════════════════════════════════════════════════
### AJCA: https://www.ajca.or.jp/
  200 text/html; charset=UTF-8 66,708 bytes  magic=HTML
  -> https://coffee.ajca.or.jp/
  links of interest (40):
    [    ] '(no text)'                                            https://coffee.ajca.or.jp/
    [    ] '協会について'                                               https://coffee.ajca.or.jp/about/
    [    ] '会長挨拶'                                                 https://coffee.ajca.or.jp/about/message/
    [    ] '会員団体・企業'                                              https://coffee.ajca.or.jp/about/members/
    [    ] '国際コーヒーデー'                                             https://coffee.ajca.or.jp/about/international-coffee-day/
    [    ] '出版物'                                                  https://coffee.ajca.or.jp/about/publication/
    [    ] '知る・楽しむ'                                               https://coffee.ajca.or.jp/column/
    [    ] '健康'                                                   https://coffee.ajca.or.jp/column/category/health/
    [    ] '美容'                                                   https://coffee.ajca.or.jp/column/category/beauty/
    [    ] '世界'                                                   https://coffee.ajca.or.jp/column/category/abroad/
    [    ] 'SDGs'                                                 https://coffee.ajca.or.jp/column/category/sdgs/
    [    ] '数字'                                                   https://coffee.ajca.or.jp/column/category/statistics/
    [    ] 'イベント'                                                 https://coffee.ajca.or.jp/column/category/event/
    [    ] 'コーヒーの基礎知識'                                            https://coffee.ajca.or.jp/column/category/basic/
    [    ] 'コーヒーの楽しみ方'                                            https://coffee.ajca.or.jp/column/category/enjoy/
    [    ] 'おいしいコーヒーの淹れ方'                                         https://coffee.ajca.or.jp/column/category/howto/
    [    ] '統計資料'                                                 https://coffee.ajca.or.jp/data/
    [    ] 'コーヒー需要動向調査'                                           https://coffee.ajca.or.jp/data/survey/
    [    ] '重大ニュース'                                               https://coffee.ajca.or.jp/data/topics/
    [    ] 'サイエンスと健康'                                             https://coffee.ajca.or.jp/health/
    [    ] 'SDGsの取り組み'                                            https://coffee.ajca.or.jp/sdgs/
    [    ] '会員企業の取り組み'                                            https://coffee.ajca.or.jp/sdgs/members/
    [    ] 'お知らせ'                                                 https://coffee.ajca.or.jp/news/
    [    ] 'English'                                              https://coffee.ajca.or.jp/english/
    [    ] '協会員サイト'                                               https://member.ajca.or.jp/
    [    ] '全日本コーヒー協会における人権尊重ガイドラインについて'                          https://coffee.ajca.or.jp/news/8489/
    [    ] '１０月１日は「国際コーヒーデー」と定める国連決議について'                         https://coffee.ajca.or.jp/news/8377/
    [    ] '2025年の重大ニュースを発表'                                      https://coffee.ajca.or.jp/data/topics/2025/
    [    ] '朝のコーヒーで腸が活発に動き出す⁉'                                    https://coffee.ajca.or.jp/column/8463/
    [    ] '腸内環境'                                                 https://coffee.ajca.or.jp/column/category/health/bio/
    [    ] 'ポリフェノール'                                              https://coffee.ajca.or.jp/column/category/health/%e3%83%9d%e3%83%aa%e3%83%95%e3%82%a7%e3%83%8e%e3%83%bc%e3%83%ab-health/
    [    ] '腸内'                                                   https://coffee.ajca.or.jp/column/category/health/%e8%85%b8%e5%86%85/
    [    ] 'ポリフェノール'                                              https://coffee.ajca.or.jp/column/category/beauty/%e3%83%9d%e3%83%aa%e3%83%95%e3%82%a7%e3%83%8e%e3%83%bc%e3%83%ab/
    [    ] '自律神経'                                                 https://coffee.ajca.or.jp/column/category/beauty/%e8%87%aa%e5%be%8b%e7%a5%9e%e7%b5%8c/
    [    ] '捨てるのはもったいない！ 資源になる抽出後のコーヒー粉 （コーヒーグラウンズ）'              https://coffee.ajca.or.jp/column/8291/
    [    ] 'デカフェコーヒーの輸入推移から見える、新たなコーヒー習慣'                         https://coffee.ajca.or.jp/column/8298/
    [    ] '(no text)'                                            https://www.instagram.com/coffee.ajca/
    [    ] '(no text)'                                            https://www.facebook.com/AllJapanCoffeeAssociation/
    [    ] 'お問い合わせ'                                               https://coffee.ajca.or.jp/contact/
    [    ] 'プライバシーポリシー'                                           https://coffee.ajca.or.jp/privacy-policy/
  number/stock phrases:
    … 活に欠かせないものとなっており、世界的に見ても消費が多いことがわかります。 世界のコーヒー消費量（2023年） （単位：1,000袋、前年比％） 資料：コーヒー機関（ICO) （注）1袋：60

### AJCA: https://www.ajca.or.jp/statistics/
  404 text/html; charset=UTF-8 39,120 bytes  magic=HTML
  links of interest (30):
    [    ] '(no text)'                                            https://coffee.ajca.or.jp/
    [    ] '協会について'                                               https://coffee.ajca.or.jp/about/
    [    ] '会長挨拶'                                                 https://coffee.ajca.or.jp/about/message/
    [    ] '会員団体・企業'                                              https://coffee.ajca.or.jp/about/members/
    [    ] '国際コーヒーデー'                                             https://coffee.ajca.or.jp/about/international-coffee-day/
    [    ] '出版物'                                                  https://coffee.ajca.or.jp/about/publication/
    [    ] '知る・楽しむ'                                               https://coffee.ajca.or.jp/column/
    [    ] '健康'                                                   https://coffee.ajca.or.jp/column/category/health/
    [    ] '美容'                                                   https://coffee.ajca.or.jp/column/category/beauty/
    [    ] '世界'                                                   https://coffee.ajca.or.jp/column/category/abroad/
    [    ] 'SDGs'                                                 https://coffee.ajca.or.jp/column/category/sdgs/
    [    ] '数字'                                                   https://coffee.ajca.or.jp/column/category/statistics/
    [    ] 'イベント'                                                 https://coffee.ajca.or.jp/column/category/event/
    [    ] 'コーヒーの基礎知識'                                            https://coffee.ajca.or.jp/column/category/basic/
    [    ] 'コーヒーの楽しみ方'                                            https://coffee.ajca.or.jp/column/category/enjoy/
    [    ] 'おいしいコーヒーの淹れ方'                                         https://coffee.ajca.or.jp/column/category/howto/
    [    ] '統計資料'                                                 https://coffee.ajca.or.jp/data/
    [    ] 'コーヒー需要動向調査'                                           https://coffee.ajca.or.jp/data/survey/
    [    ] '重大ニュース'                                               https://coffee.ajca.or.jp/data/topics/
    [    ] 'サイエンスと健康'                                             https://coffee.ajca.or.jp/health/
    [    ] 'SDGsの取り組み'                                            https://coffee.ajca.or.jp/sdgs/
    [    ] '会員企業の取り組み'                                            https://coffee.ajca.or.jp/sdgs/members/
    [    ] 'お知らせ'                                                 https://coffee.ajca.or.jp/news/
    [    ] 'English'                                              https://coffee.ajca.or.jp/english/
    [    ] '協会員サイト'                                               https://member.ajca.or.jp/
    [    ] 'トップに戻る'                                               https://coffee.ajca.or.jp
    [    ] '(no text)'                                            https://www.instagram.com/coffee.ajca/
    [    ] '(no text)'                                            https://www.facebook.com/AllJapanCoffeeAssociation/
    [    ] 'お問い合わせ'                                               https://coffee.ajca.or.jp/contact/
    [    ] 'プライバシーポリシー'                                           https://coffee.ajca.or.jp/privacy-policy/

### AJCA: https://www.ajca.or.jp/data/
  200 text/html; charset=UTF-8 134,988 bytes  magic=HTML
  links of interest (40):
    [    ] '(no text)'                                            https://coffee.ajca.or.jp/
    [    ] '協会について'                                               https://coffee.ajca.or.jp/about/
    [    ] '会長挨拶'                                                 https://coffee.ajca.or.jp/about/message/
    [    ] '会員団体・企業'                                              https://coffee.ajca.or.jp/about/members/
    [    ] '国際コーヒーデー'                                             https://coffee.ajca.or.jp/about/international-coffee-day/
    [    ] '出版物'                                                  https://coffee.ajca.or.jp/about/publication/
    [    ] '知る・楽しむ'                                               https://coffee.ajca.or.jp/column/
    [    ] '健康'                                                   https://coffee.ajca.or.jp/column/category/health/
    [    ] '美容'                                                   https://coffee.ajca.or.jp/column/category/beauty/
    [    ] '世界'                                                   https://coffee.ajca.or.jp/column/category/abroad/
    [    ] 'SDGs'                                                 https://coffee.ajca.or.jp/column/category/sdgs/
    [    ] '数字'                                                   https://coffee.ajca.or.jp/column/category/statistics/
    [    ] 'イベント'                                                 https://coffee.ajca.or.jp/column/category/event/
    [    ] 'コーヒーの基礎知識'                                            https://coffee.ajca.or.jp/column/category/basic/
    [    ] 'コーヒーの楽しみ方'                                            https://coffee.ajca.or.jp/column/category/enjoy/
    [    ] 'おいしいコーヒーの淹れ方'                                         https://coffee.ajca.or.jp/column/category/howto/
    [    ] '統計資料'                                                 https://coffee.ajca.or.jp/data/
    [    ] 'コーヒー需要動向調査'                                           https://coffee.ajca.or.jp/data/survey/
    [    ] '重大ニュース'                                               https://coffee.ajca.or.jp/data/topics/
    [    ] 'サイエンスと健康'                                             https://coffee.ajca.or.jp/health/
    [    ] 'SDGsの取り組み'                                            https://coffee.ajca.or.jp/sdgs/
    [    ] '会員企業の取り組み'                                            https://coffee.ajca.or.jp/sdgs/members/
    [    ] 'お知らせ'                                                 https://coffee.ajca.or.jp/news/
    [    ] 'English'                                              https://coffee.ajca.or.jp/english/
    [    ] '協会員サイト'                                               https://member.ajca.or.jp/
    [FILE] 'data-jukyu202603'                                     https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/05/data-jukyu202603.pdf
    [FILE] 'data-yunyu-suii2025'                                  https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/03/data-yunyu-suii2025.pdf
    [FILE] 'data-24-2025-2'                                       https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/03/data-24-2025-2.pdf
    [FILE] 'data-24-202603'                                       https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/05/data-24-202603.pdf
    [FILE] 'data-gc-yunyuryo-tanka2025'                           https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/03/data-gc-yunyuryo-tanka2025.pdf
    [FILE] 'data-rcic-yunyuryo-tanka2025'                         https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/03/data-rcic-yunyuryo-tanka2025.pdf
    [FILE] 'data7-import-nama2024'                                https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-nama2024.pdf
    [FILE] 'data7-import-gc2024'                                  https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-gc2024.pdf
    [FILE] 'data7-import-rc2024'                                  https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-rc2024.pdf
    [FILE] 'data7-import-ic2024'                                  https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-ic2024.pdf
    [FILE] 'data7-import-other2024'                               https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-other2024.pdf
    [FILE] 'data7-export2024'                                     https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-export2024.pdf
    [FILE] 'data-decaf202603'                                     https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/05/data-decaf202603.pdf
    [FILE] 'j-import202603'                                       https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/05/j-import202603.pdf
    [FILE] 'j-export202603'                                       https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/05/j-export202603.pdf
  number/stock phrases:
    … コーヒー消費 日本のコーヒー消費量は世界的に見ても高い水準で、世界４位となっています。 2025年の日本のコーヒー消費量 397,272 トン （前年比99.3％） 日本のコーヒー需給表 更新日：202
    … ビアの上位 3 ヶ国からの輸入が４分の３近くを占めています。 日本の生豆輸入量（国別） 2025年のコーヒー生豆の輸入量 359,382 トン 凡例 日本のコーヒーの輸入量の推移 更新日：2026年3月
    … 月15日 data-sekai-shohi202411 PDFダウンロード 世界のコーヒー消費量（2023年） （単位：1,000袋、前年比％） 資料：コーヒー機関（ICO) （注）1袋：60
    … odata-yunyu-seisan2024 PDFダウンロード 世界のコーヒー輸入量（生豆） 凡例 （単位：60キロ/1,000袋） （年） 世界のコーヒー生産は、ブラジル、ベトナムなど上位
    … 産は、ブラジル、ベトナムなど上位５カ国で約７割を占めるものとなっています。 世界のコーヒー生産量（生豆） 凡例 （単位：1,000袋） コーヒー価格の推移 コーヒー価格は、生産見通しなどの需要

### AJCA: https://www.ajca.or.jp/coffee_data/
  404 text/html; charset=UTF-8 39,120 bytes  magic=HTML
  links of interest (30):
    [    ] '(no text)'                                            https://coffee.ajca.or.jp/
    [    ] '協会について'                                               https://coffee.ajca.or.jp/about/
    [    ] '会長挨拶'                                                 https://coffee.ajca.or.jp/about/message/
    [    ] '会員団体・企業'                                              https://coffee.ajca.or.jp/about/members/
    [    ] '国際コーヒーデー'                                             https://coffee.ajca.or.jp/about/international-coffee-day/
    [    ] '出版物'                                                  https://coffee.ajca.or.jp/about/publication/
    [    ] '知る・楽しむ'                                               https://coffee.ajca.or.jp/column/
    [    ] '健康'                                                   https://coffee.ajca.or.jp/column/category/health/
    [    ] '美容'                                                   https://coffee.ajca.or.jp/column/category/beauty/
    [    ] '世界'                                                   https://coffee.ajca.or.jp/column/category/abroad/
    [    ] 'SDGs'                                                 https://coffee.ajca.or.jp/column/category/sdgs/
    [    ] '数字'                                                   https://coffee.ajca.or.jp/column/category/statistics/
    [    ] 'イベント'                                                 https://coffee.ajca.or.jp/column/category/event/
    [    ] 'コーヒーの基礎知識'                                            https://coffee.ajca.or.jp/column/category/basic/
    [    ] 'コーヒーの楽しみ方'                                            https://coffee.ajca.or.jp/column/category/enjoy/
    [    ] 'おいしいコーヒーの淹れ方'                                         https://coffee.ajca.or.jp/column/category/howto/
    [    ] '統計資料'                                                 https://coffee.ajca.or.jp/data/
    [    ] 'コーヒー需要動向調査'                                           https://coffee.ajca.or.jp/data/survey/
    [    ] '重大ニュース'                                               https://coffee.ajca.or.jp/data/topics/
    [    ] 'サイエンスと健康'                                             https://coffee.ajca.or.jp/health/
    [    ] 'SDGsの取り組み'                                            https://coffee.ajca.or.jp/sdgs/
    [    ] '会員企業の取り組み'                                            https://coffee.ajca.or.jp/sdgs/members/
    [    ] 'お知らせ'                                                 https://coffee.ajca.or.jp/news/
    [    ] 'English'                                              https://coffee.ajca.or.jp/english/
    [    ] '協会員サイト'                                               https://member.ajca.or.jp/
    [    ] 'トップに戻る'                                               https://coffee.ajca.or.jp
    [    ] '(no text)'                                            https://www.instagram.com/coffee.ajca/
    [    ] '(no text)'                                            https://www.facebook.com/AllJapanCoffeeAssociation/
    [    ] 'お問い合わせ'                                               https://coffee.ajca.or.jp/contact/
    [    ] 'プライバシーポリシー'                                           https://coffee.ajca.or.jp/privacy-policy/

### AJCA: https://www.ajca.or.jp/data/data01.html
  404 text/html; charset=UTF-8 39,120 bytes  magic=HTML
  links of interest (30):
    [    ] '(no text)'                                            https://coffee.ajca.or.jp/
    [    ] '協会について'                                               https://coffee.ajca.or.jp/about/
    [    ] '会長挨拶'                                                 https://coffee.ajca.or.jp/about/message/
    [    ] '会員団体・企業'                                              https://coffee.ajca.or.jp/about/members/
    [    ] '国際コーヒーデー'                                             https://coffee.ajca.or.jp/about/international-coffee-day/
    [    ] '出版物'                                                  https://coffee.ajca.or.jp/about/publication/
    [    ] '知る・楽しむ'                                               https://coffee.ajca.or.jp/column/
    [    ] '健康'                                                   https://coffee.ajca.or.jp/column/category/health/
    [    ] '美容'                                                   https://coffee.ajca.or.jp/column/category/beauty/
    [    ] '世界'                                                   https://coffee.ajca.or.jp/column/category/abroad/
    [    ] 'SDGs'                                                 https://coffee.ajca.or.jp/column/category/sdgs/
    [    ] '数字'                                                   https://coffee.ajca.or.jp/column/category/statistics/
    [    ] 'イベント'                                                 https://coffee.ajca.or.jp/column/category/event/
    [    ] 'コーヒーの基礎知識'                                            https://coffee.ajca.or.jp/column/category/basic/
    [    ] 'コーヒーの楽しみ方'                                            https://coffee.ajca.or.jp/column/category/enjoy/
    [    ] 'おいしいコーヒーの淹れ方'                                         https://coffee.ajca.or.jp/column/category/howto/
    [    ] '統計資料'                                                 https://coffee.ajca.or.jp/data/
    [    ] 'コーヒー需要動向調査'                                           https://coffee.ajca.or.jp/data/survey/
    [    ] '重大ニュース'                                               https://coffee.ajca.or.jp/data/topics/
    [    ] 'サイエンスと健康'                                             https://coffee.ajca.or.jp/health/
    [    ] 'SDGsの取り組み'                                            https://coffee.ajca.or.jp/sdgs/
    [    ] '会員企業の取り組み'                                            https://coffee.ajca.or.jp/sdgs/members/
    [    ] 'お知らせ'                                                 https://coffee.ajca.or.jp/news/
    [    ] 'English'                                              https://coffee.ajca.or.jp/english/
    [    ] '協会員サイト'                                               https://member.ajca.or.jp/
    [    ] 'トップに戻る'                                               https://coffee.ajca.or.jp
    [    ] '(no text)'                                            https://www.instagram.com/coffee.ajca/
    [    ] '(no text)'                                            https://www.facebook.com/AllJapanCoffeeAssociation/
    [    ] 'お問い合わせ'                                               https://coffee.ajca.or.jp/contact/
    [    ] 'プライバシーポリシー'                                           https://coffee.ajca.or.jp/privacy-policy/

### AJCA: https://www.ajca.or.jp/data/data02.html
  404 text/html; charset=UTF-8 39,120 bytes  magic=HTML
  links of interest (30):
    [    ] '(no text)'                                            https://coffee.ajca.or.jp/
    [    ] '協会について'                                               https://coffee.ajca.or.jp/about/
    [    ] '会長挨拶'                                                 https://coffee.ajca.or.jp/about/message/
    [    ] '会員団体・企業'                                              https://coffee.ajca.or.jp/about/members/
    [    ] '国際コーヒーデー'                                             https://coffee.ajca.or.jp/about/international-coffee-day/
    [    ] '出版物'                                                  https://coffee.ajca.or.jp/about/publication/
    [    ] '知る・楽しむ'                                               https://coffee.ajca.or.jp/column/
    [    ] '健康'                                                   https://coffee.ajca.or.jp/column/category/health/
    [    ] '美容'                                                   https://coffee.ajca.or.jp/column/category/beauty/
    [    ] '世界'                                                   https://coffee.ajca.or.jp/column/category/abroad/
    [    ] 'SDGs'                                                 https://coffee.ajca.or.jp/column/category/sdgs/
    [    ] '数字'                                                   https://coffee.ajca.or.jp/column/category/statistics/
    [    ] 'イベント'                                                 https://coffee.ajca.or.jp/column/category/event/
    [    ] 'コーヒーの基礎知識'                                            https://coffee.ajca.or.jp/column/category/basic/
    [    ] 'コーヒーの楽しみ方'                                            https://coffee.ajca.or.jp/column/category/enjoy/
    [    ] 'おいしいコーヒーの淹れ方'                                         https://coffee.ajca.or.jp/column/category/howto/
    [    ] '統計資料'                                                 https://coffee.ajca.or.jp/data/
    [    ] 'コーヒー需要動向調査'                                           https://coffee.ajca.or.jp/data/survey/
    [    ] '重大ニュース'                                               https://coffee.ajca.or.jp/data/topics/
    [    ] 'サイエンスと健康'                                             https://coffee.ajca.or.jp/health/
    [    ] 'SDGsの取り組み'                                            https://coffee.ajca.or.jp/sdgs/
    [    ] '会員企業の取り組み'                                            https://coffee.ajca.or.jp/sdgs/members/
    [    ] 'お知らせ'                                                 https://coffee.ajca.or.jp/news/
    [    ] 'English'                                              https://coffee.ajca.or.jp/english/
    [    ] '協会員サイト'                                               https://member.ajca.or.jp/
    [    ] 'トップに戻る'                                               https://coffee.ajca.or.jp
    [    ] '(no text)'                                            https://www.instagram.com/coffee.ajca/
    [    ] '(no text)'                                            https://www.facebook.com/AllJapanCoffeeAssociation/
    [    ] 'お問い合わせ'                                               https://coffee.ajca.or.jp/contact/
    [    ] 'プライバシーポリシー'                                           https://coffee.ajca.or.jp/privacy-policy/

### AJCA: https://www.ajca.or.jp/toukei/
  404 text/html; charset=UTF-8 39,120 bytes  magic=HTML
  links of interest (30):
    [    ] '(no text)'                                            https://coffee.ajca.or.jp/
    [    ] '協会について'                                               https://coffee.ajca.or.jp/about/
    [    ] '会長挨拶'                                                 https://coffee.ajca.or.jp/about/message/
    [    ] '会員団体・企業'                                              https://coffee.ajca.or.jp/about/members/
    [    ] '国際コーヒーデー'                                             https://coffee.ajca.or.jp/about/international-coffee-day/
    [    ] '出版物'                                                  https://coffee.ajca.or.jp/about/publication/
    [    ] '知る・楽しむ'                                               https://coffee.ajca.or.jp/column/
    [    ] '健康'                                                   https://coffee.ajca.or.jp/column/category/health/
    [    ] '美容'                                                   https://coffee.ajca.or.jp/column/category/beauty/
    [    ] '世界'                                                   https://coffee.ajca.or.jp/column/category/abroad/
    [    ] 'SDGs'                                                 https://coffee.ajca.or.jp/column/category/sdgs/
    [    ] '数字'                                                   https://coffee.ajca.or.jp/column/category/statistics/
    [    ] 'イベント'                                                 https://coffee.ajca.or.jp/column/category/event/
    [    ] 'コーヒーの基礎知識'                                            https://coffee.ajca.or.jp/column/category/basic/
    [    ] 'コーヒーの楽しみ方'                                            https://coffee.ajca.or.jp/column/category/enjoy/
    [    ] 'おいしいコーヒーの淹れ方'                                         https://coffee.ajca.or.jp/column/category/howto/
    [    ] '統計資料'                                                 https://coffee.ajca.or.jp/data/
    [    ] 'コーヒー需要動向調査'                                           https://coffee.ajca.or.jp/data/survey/
    [    ] '重大ニュース'                                               https://coffee.ajca.or.jp/data/topics/
    [    ] 'サイエンスと健康'                                             https://coffee.ajca.or.jp/health/
    [    ] 'SDGsの取り組み'                                            https://coffee.ajca.or.jp/sdgs/
    [    ] '会員企業の取り組み'                                            https://coffee.ajca.or.jp/sdgs/members/
    [    ] 'お知らせ'                                                 https://coffee.ajca.or.jp/news/
    [    ] 'English'                                              https://coffee.ajca.or.jp/english/
    [    ] '協会員サイト'                                               https://member.ajca.or.jp/
    [    ] 'トップに戻る'                                               https://coffee.ajca.or.jp
    [    ] '(no text)'                                            https://www.instagram.com/coffee.ajca/
    [    ] '(no text)'                                            https://www.facebook.com/AllJapanCoffeeAssociation/
    [    ] 'お問い合わせ'                                               https://coffee.ajca.or.jp/contact/
    [    ] 'プライバシーポリシー'                                           https://coffee.ajca.or.jp/privacy-policy/

### AJCA: https://ajca.or.jp/
  200 text/html; charset=UTF-8 66,708 bytes  magic=HTML
  -> https://coffee.ajca.or.jp/
  links of interest (40):
    [    ] '(no text)'                                            https://coffee.ajca.or.jp/
    [    ] '協会について'                                               https://coffee.ajca.or.jp/about/
    [    ] '会長挨拶'                                                 https://coffee.ajca.or.jp/about/message/
    [    ] '会員団体・企業'                                              https://coffee.ajca.or.jp/about/members/
    [    ] '国際コーヒーデー'                                             https://coffee.ajca.or.jp/about/international-coffee-day/
    [    ] '出版物'                                                  https://coffee.ajca.or.jp/about/publication/
    [    ] '知る・楽しむ'                                               https://coffee.ajca.or.jp/column/
    [    ] '健康'                                                   https://coffee.ajca.or.jp/column/category/health/
    [    ] '美容'                                                   https://coffee.ajca.or.jp/column/category/beauty/
    [    ] '世界'                                                   https://coffee.ajca.or.jp/column/category/abroad/
    [    ] 'SDGs'                                                 https://coffee.ajca.or.jp/column/category/sdgs/
    [    ] '数字'                                                   https://coffee.ajca.or.jp/column/category/statistics/
    [    ] 'イベント'                                                 https://coffee.ajca.or.jp/column/category/event/
    [    ] 'コーヒーの基礎知識'                                            https://coffee.ajca.or.jp/column/category/basic/
    [    ] 'コーヒーの楽しみ方'                                            https://coffee.ajca.or.jp/column/category/enjoy/
    [    ] 'おいしいコーヒーの淹れ方'                                         https://coffee.ajca.or.jp/column/category/howto/
    [    ] '統計資料'                                                 https://coffee.ajca.or.jp/data/
    [    ] 'コーヒー需要動向調査'                                           https://coffee.ajca.or.jp/data/survey/
    [    ] '重大ニュース'                                               https://coffee.ajca.or.jp/data/topics/
    [    ] 'サイエンスと健康'                                             https://coffee.ajca.or.jp/health/
    [    ] 'SDGsの取り組み'                                            https://coffee.ajca.or.jp/sdgs/
    [    ] '会員企業の取り組み'                                            https://coffee.ajca.or.jp/sdgs/members/
    [    ] 'お知らせ'                                                 https://coffee.ajca.or.jp/news/
    [    ] 'English'                                              https://coffee.ajca.or.jp/english/
    [    ] '協会員サイト'                                               https://member.ajca.or.jp/
    [    ] '全日本コーヒー協会における人権尊重ガイドラインについて'                          https://coffee.ajca.or.jp/news/8489/
    [    ] '１０月１日は「国際コーヒーデー」と定める国連決議について'                         https://coffee.ajca.or.jp/news/8377/
    [    ] '2025年の重大ニュースを発表'                                      https://coffee.ajca.or.jp/data/topics/2025/
    [    ] '朝のコーヒーで腸が活発に動き出す⁉'                                    https://coffee.ajca.or.jp/column/8463/
    [    ] '腸内環境'                                                 https://coffee.ajca.or.jp/column/category/health/bio/
    [    ] 'ポリフェノール'                                              https://coffee.ajca.or.jp/column/category/health/%e3%83%9d%e3%83%aa%e3%83%95%e3%82%a7%e3%83%8e%e3%83%bc%e3%83%ab-health/
    [    ] '腸内'                                                   https://coffee.ajca.or.jp/column/category/health/%e8%85%b8%e5%86%85/
    [    ] 'ポリフェノール'                                              https://coffee.ajca.or.jp/column/category/beauty/%e3%83%9d%e3%83%aa%e3%83%95%e3%82%a7%e3%83%8e%e3%83%bc%e3%83%ab/
    [    ] '自律神経'                                                 https://coffee.ajca.or.jp/column/category/beauty/%e8%87%aa%e5%be%8b%e7%a5%9e%e7%b5%8c/
    [    ] '捨てるのはもったいない！ 資源になる抽出後のコーヒー粉 （コーヒーグラウンズ）'              https://coffee.ajca.or.jp/column/8291/
    [    ] 'デカフェコーヒーの輸入推移から見える、新たなコーヒー習慣'                         https://coffee.ajca.or.jp/column/8298/
    [    ] '(no text)'                                            https://www.instagram.com/coffee.ajca/
    [    ] '(no text)'                                            https://www.facebook.com/AllJapanCoffeeAssociation/
    [    ] 'お問い合わせ'                                               https://coffee.ajca.or.jp/contact/
    [    ] 'プライバシーポリシー'                                           https://coffee.ajca.or.jp/privacy-policy/
  number/stock phrases:
    … 活に欠かせないものとなっており、世界的に見ても消費が多いことがわかります。 世界のコーヒー消費量（2023年） （単位：1,000袋、前年比％） 資料：コーヒー機関（ICO) （注）1袋：60

════════════════════════════════════════════════════════════
  ECF — European Coffee Federation probe
════════════════════════════════════════════════════════════
### ECF: https://www.ecf-coffee.org/
  200 text/html; charset=UTF-8 52,967 bytes  magic=HTML
  links of interest (29):
    [    ] '(no text)'                                            https://www.ecf-coffee.org
    [    ] 'About us'                                             https://www.ecf-coffee.org/about/
    [    ] 'Mission'                                              https://www.ecf-coffee.org/about/role-and-mission/
    [    ] 'Food safety & compliance'                             https://www.ecf-coffee.org/about/food-safety/
    [    ] 'Responsible Sourcing & Consumption'                   https://www.ecf-coffee.org/about/sourcing/
    [    ] 'International Trade'                                  https://www.ecf-coffee.org/about/international-trade/
    [    ] 'Governance'                                           https://www.ecf-coffee.org/about/structure/
    [    ] 'Secretariat'                                          https://www.ecf-coffee.org/about/secretariat/
    [    ] 'Our network'                                          https://www.ecf-coffee.org/about/network/
    [    ] 'Contact us'                                           https://www.ecf-coffee.org/contact-us/
    [    ] 'Members'                                              https://www.ecf-coffee.org/category/members/
    [    ] 'National Associations'                                https://www.ecf-coffee.org/category/members/national-associations/
    [    ] 'Companies'                                            https://www.ecf-coffee.org/category/members/companies/
    [    ] 'Become a Member'                                      https://www.ecf-coffee.org/membership/
    [    ] 'Publications'                                         https://www.ecf-coffee.org/category/publications/
    [    ] 'European Coffee Reports'                              https://www.ecf-coffee.org/category/publications/european-coffee-reports/
    [    ] 'Guidelines documents'                                 https://www.ecf-coffee.org/category/publications/guidance-documents/
    [    ] 'Stocks in European Ports'                             https://www.ecf-coffee.org/category/publications/stocks/
    [    ] 'European Standard Contract for Coffee (ESCC)'         https://www.ecf-coffee.org/category/publications/contracts/
    [    ] 'Press releases'                                       https://www.ecf-coffee.org/category/publications/press-releases/
    [    ] 'Infographics'                                         https://www.ecf-coffee.org/category/publications/infographics/
    [    ] 'News & Events'                                        https://www.ecf-coffee.org/category/whats-new/
    [    ] 'News'                                                 https://www.ecf-coffee.org/category/whats-new/news/
    [    ] 'Events & Meetings'                                    https://www.ecf-coffee.org/category/whats-new/events/
    [    ] 'Commission proposes including soluble coffee in EU'   https://www.ecf-coffee.org/soluble-coffee-enters-eudr-scope-under-commission-draftdelegated-act/
    [    ] 'ECF participates in the launch of the Internationa'   https://www.ecf-coffee.org/ecf-participates-in-the-launch-of-the-international-trade-centre-brussels-office/
    [    ] 'ECF Annual General Meeting 2026, Tallinn, Estonia'    https://www.ecf-coffee.org/ecf-annual-general-meeting-2026-tallinn-estonia/
    [    ] 'Transport Packaging in the context of PPWR'           https://www.ecf-coffee.org/transport-packaging-in-the-context-of-ppwr/
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/
  number/stock phrases:
    … Brussels Office Read more Events ECF Annual General Meeting 2026, Tallinn, Estonia 19/05/2026 - 2

### ECF: https://www.ecf-coffee.org/resources/statistics/
  404 text/html; charset=UTF-8 45,391 bytes  magic=HTML
  links of interest (25):
    [    ] 'Return home?'                                         https://www.ecf-coffee.org
    [    ] 'About us'                                             https://www.ecf-coffee.org/about/
    [    ] 'Mission'                                              https://www.ecf-coffee.org/about/role-and-mission/
    [    ] 'Food safety & compliance'                             https://www.ecf-coffee.org/about/food-safety/
    [    ] 'Responsible Sourcing & Consumption'                   https://www.ecf-coffee.org/about/sourcing/
    [    ] 'International Trade'                                  https://www.ecf-coffee.org/about/international-trade/
    [    ] 'Governance'                                           https://www.ecf-coffee.org/about/structure/
    [    ] 'Secretariat'                                          https://www.ecf-coffee.org/about/secretariat/
    [    ] 'Our network'                                          https://www.ecf-coffee.org/about/network/
    [    ] 'Contact us'                                           https://www.ecf-coffee.org/contact-us/
    [    ] 'Members'                                              https://www.ecf-coffee.org/category/members/
    [    ] 'National Associations'                                https://www.ecf-coffee.org/category/members/national-associations/
    [    ] 'Companies'                                            https://www.ecf-coffee.org/category/members/companies/
    [    ] 'Become a Member'                                      https://www.ecf-coffee.org/membership/
    [    ] 'Publications'                                         https://www.ecf-coffee.org/category/publications/
    [    ] 'European Coffee Reports'                              https://www.ecf-coffee.org/category/publications/european-coffee-reports/
    [    ] 'Guidelines documents'                                 https://www.ecf-coffee.org/category/publications/guidance-documents/
    [    ] 'Stocks in European Ports'                             https://www.ecf-coffee.org/category/publications/stocks/
    [    ] 'European Standard Contract for Coffee (ESCC)'         https://www.ecf-coffee.org/category/publications/contracts/
    [    ] 'Press releases'                                       https://www.ecf-coffee.org/category/publications/press-releases/
    [    ] 'Infographics'                                         https://www.ecf-coffee.org/category/publications/infographics/
    [    ] 'News & Events'                                        https://www.ecf-coffee.org/category/whats-new/
    [    ] 'News'                                                 https://www.ecf-coffee.org/category/whats-new/news/
    [    ] 'Events & Meetings'                                    https://www.ecf-coffee.org/category/whats-new/events/
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/

### ECF: https://www.ecf-coffee.org/resources/
  404 text/html; charset=UTF-8 45,391 bytes  magic=HTML
  links of interest (25):
    [    ] 'Return home?'                                         https://www.ecf-coffee.org
    [    ] 'About us'                                             https://www.ecf-coffee.org/about/
    [    ] 'Mission'                                              https://www.ecf-coffee.org/about/role-and-mission/
    [    ] 'Food safety & compliance'                             https://www.ecf-coffee.org/about/food-safety/
    [    ] 'Responsible Sourcing & Consumption'                   https://www.ecf-coffee.org/about/sourcing/
    [    ] 'International Trade'                                  https://www.ecf-coffee.org/about/international-trade/
    [    ] 'Governance'                                           https://www.ecf-coffee.org/about/structure/
    [    ] 'Secretariat'                                          https://www.ecf-coffee.org/about/secretariat/
    [    ] 'Our network'                                          https://www.ecf-coffee.org/about/network/
    [    ] 'Contact us'                                           https://www.ecf-coffee.org/contact-us/
    [    ] 'Members'                                              https://www.ecf-coffee.org/category/members/
    [    ] 'National Associations'                                https://www.ecf-coffee.org/category/members/national-associations/
    [    ] 'Companies'                                            https://www.ecf-coffee.org/category/members/companies/
    [    ] 'Become a Member'                                      https://www.ecf-coffee.org/membership/
    [    ] 'Publications'                                         https://www.ecf-coffee.org/category/publications/
    [    ] 'European Coffee Reports'                              https://www.ecf-coffee.org/category/publications/european-coffee-reports/
    [    ] 'Guidelines documents'                                 https://www.ecf-coffee.org/category/publications/guidance-documents/
    [    ] 'Stocks in European Ports'                             https://www.ecf-coffee.org/category/publications/stocks/
    [    ] 'European Standard Contract for Coffee (ESCC)'         https://www.ecf-coffee.org/category/publications/contracts/
    [    ] 'Press releases'                                       https://www.ecf-coffee.org/category/publications/press-releases/
    [    ] 'Infographics'                                         https://www.ecf-coffee.org/category/publications/infographics/
    [    ] 'News & Events'                                        https://www.ecf-coffee.org/category/whats-new/
    [    ] 'News'                                                 https://www.ecf-coffee.org/category/whats-new/news/
    [    ] 'Events & Meetings'                                    https://www.ecf-coffee.org/category/whats-new/events/
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/

### ECF: https://www.ecf-coffee.org/knowledge/statistics/
  404 text/html; charset=UTF-8 45,391 bytes  magic=HTML
  links of interest (25):
    [    ] 'Return home?'                                         https://www.ecf-coffee.org
    [    ] 'About us'                                             https://www.ecf-coffee.org/about/
    [    ] 'Mission'                                              https://www.ecf-coffee.org/about/role-and-mission/
    [    ] 'Food safety & compliance'                             https://www.ecf-coffee.org/about/food-safety/
    [    ] 'Responsible Sourcing & Consumption'                   https://www.ecf-coffee.org/about/sourcing/
    [    ] 'International Trade'                                  https://www.ecf-coffee.org/about/international-trade/
    [    ] 'Governance'                                           https://www.ecf-coffee.org/about/structure/
    [    ] 'Secretariat'                                          https://www.ecf-coffee.org/about/secretariat/
    [    ] 'Our network'                                          https://www.ecf-coffee.org/about/network/
    [    ] 'Contact us'                                           https://www.ecf-coffee.org/contact-us/
    [    ] 'Members'                                              https://www.ecf-coffee.org/category/members/
    [    ] 'National Associations'                                https://www.ecf-coffee.org/category/members/national-associations/
    [    ] 'Companies'                                            https://www.ecf-coffee.org/category/members/companies/
    [    ] 'Become a Member'                                      https://www.ecf-coffee.org/membership/
    [    ] 'Publications'                                         https://www.ecf-coffee.org/category/publications/
    [    ] 'European Coffee Reports'                              https://www.ecf-coffee.org/category/publications/european-coffee-reports/
    [    ] 'Guidelines documents'                                 https://www.ecf-coffee.org/category/publications/guidance-documents/
    [    ] 'Stocks in European Ports'                             https://www.ecf-coffee.org/category/publications/stocks/
    [    ] 'European Standard Contract for Coffee (ESCC)'         https://www.ecf-coffee.org/category/publications/contracts/
    [    ] 'Press releases'                                       https://www.ecf-coffee.org/category/publications/press-releases/
    [    ] 'Infographics'                                         https://www.ecf-coffee.org/category/publications/infographics/
    [    ] 'News & Events'                                        https://www.ecf-coffee.org/category/whats-new/
    [    ] 'News'                                                 https://www.ecf-coffee.org/category/whats-new/news/
    [    ] 'Events & Meetings'                                    https://www.ecf-coffee.org/category/whats-new/events/
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/

### ECF: https://www.ecf-coffee.org/knowledge/
  404 text/html; charset=UTF-8 45,391 bytes  magic=HTML
  links of interest (25):
    [    ] 'Return home?'                                         https://www.ecf-coffee.org
    [    ] 'About us'                                             https://www.ecf-coffee.org/about/
    [    ] 'Mission'                                              https://www.ecf-coffee.org/about/role-and-mission/
    [    ] 'Food safety & compliance'                             https://www.ecf-coffee.org/about/food-safety/
    [    ] 'Responsible Sourcing & Consumption'                   https://www.ecf-coffee.org/about/sourcing/
    [    ] 'International Trade'                                  https://www.ecf-coffee.org/about/international-trade/
    [    ] 'Governance'                                           https://www.ecf-coffee.org/about/structure/
    [    ] 'Secretariat'                                          https://www.ecf-coffee.org/about/secretariat/
    [    ] 'Our network'                                          https://www.ecf-coffee.org/about/network/
    [    ] 'Contact us'                                           https://www.ecf-coffee.org/contact-us/
    [    ] 'Members'                                              https://www.ecf-coffee.org/category/members/
    [    ] 'National Associations'                                https://www.ecf-coffee.org/category/members/national-associations/
    [    ] 'Companies'                                            https://www.ecf-coffee.org/category/members/companies/
    [    ] 'Become a Member'                                      https://www.ecf-coffee.org/membership/
    [    ] 'Publications'                                         https://www.ecf-coffee.org/category/publications/
    [    ] 'European Coffee Reports'                              https://www.ecf-coffee.org/category/publications/european-coffee-reports/
    [    ] 'Guidelines documents'                                 https://www.ecf-coffee.org/category/publications/guidance-documents/
    [    ] 'Stocks in European Ports'                             https://www.ecf-coffee.org/category/publications/stocks/
    [    ] 'European Standard Contract for Coffee (ESCC)'         https://www.ecf-coffee.org/category/publications/contracts/
    [    ] 'Press releases'                                       https://www.ecf-coffee.org/category/publications/press-releases/
    [    ] 'Infographics'                                         https://www.ecf-coffee.org/category/publications/infographics/
    [    ] 'News & Events'                                        https://www.ecf-coffee.org/category/whats-new/
    [    ] 'News'                                                 https://www.ecf-coffee.org/category/whats-new/news/
    [    ] 'Events & Meetings'                                    https://www.ecf-coffee.org/category/whats-new/events/
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/

### ECF: https://www.ecf-coffee.org/news/
  200 image/jpeg 54,214 bytes  magic=?
  -> https://www.ecf-coffee.org/wp-content/uploads/2020/10/news.jpg

### ECF: https://www.ecf-coffee.org/publications/
  200 text/html; charset=UTF-8 67,762 bytes  magic=HTML
  links of interest (29):
    [    ] '(no text)'                                            https://www.ecf-coffee.org
    [    ] 'About us'                                             https://www.ecf-coffee.org/about/
    [    ] 'Mission'                                              https://www.ecf-coffee.org/about/role-and-mission/
    [    ] 'Food safety & compliance'                             https://www.ecf-coffee.org/about/food-safety/
    [    ] 'Responsible Sourcing & Consumption'                   https://www.ecf-coffee.org/about/sourcing/
    [    ] 'International Trade'                                  https://www.ecf-coffee.org/about/international-trade/
    [    ] 'Governance'                                           https://www.ecf-coffee.org/about/structure/
    [    ] 'Secretariat'                                          https://www.ecf-coffee.org/about/secretariat/
    [    ] 'Our network'                                          https://www.ecf-coffee.org/about/network/
    [    ] 'Contact us'                                           https://www.ecf-coffee.org/contact-us/
    [    ] 'Members'                                              https://www.ecf-coffee.org/category/members/
    [    ] 'National Associations'                                https://www.ecf-coffee.org/category/members/national-associations/
    [    ] 'Companies'                                            https://www.ecf-coffee.org/category/members/companies/
    [    ] 'Become a Member'                                      https://www.ecf-coffee.org/membership/
    [    ] 'Publications'                                         https://www.ecf-coffee.org/category/publications/
    [    ] 'European Coffee Reports'                              https://www.ecf-coffee.org/category/publications/european-coffee-reports/
    [    ] 'Guidelines documents'                                 https://www.ecf-coffee.org/category/publications/guidance-documents/
    [    ] 'Stocks in European Ports'                             https://www.ecf-coffee.org/category/publications/stocks/
    [    ] 'European Standard Contract for Coffee (ESCC)'         https://www.ecf-coffee.org/category/publications/contracts/
    [    ] 'Press releases'                                       https://www.ecf-coffee.org/category/publications/press-releases/
    [    ] 'Infographics'                                         https://www.ecf-coffee.org/category/publications/infographics/
    [    ] 'News & Events'                                        https://www.ecf-coffee.org/category/whats-new/
    [    ] 'News'                                                 https://www.ecf-coffee.org/category/whats-new/news/
    [    ] 'Events & Meetings'                                    https://www.ecf-coffee.org/category/whats-new/events/
    [    ] 'Position papers'                                      https://www.ecf-coffee.org/category/publications/position-papers/
    [    ] '2'                                                    https://www.ecf-coffee.org/publications/page/2/
    [    ] '3'                                                    https://www.ecf-coffee.org/publications/page/3/
    [    ] '5'                                                    https://www.ecf-coffee.org/publications/page/5/
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/

### ECF: https://www.ecf-coffee.org/category/news/
  200 text/html; charset=UTF-8 75,154 bytes  magic=HTML
  links of interest (40):
    [    ] '(no text)'                                            https://www.ecf-coffee.org
    [    ] 'About us'                                             https://www.ecf-coffee.org/about/
    [    ] 'Mission'                                              https://www.ecf-coffee.org/about/role-and-mission/
    [    ] 'Food safety & compliance'                             https://www.ecf-coffee.org/about/food-safety/
    [    ] 'Responsible Sourcing & Consumption'                   https://www.ecf-coffee.org/about/sourcing/
    [    ] 'International Trade'                                  https://www.ecf-coffee.org/about/international-trade/
    [    ] 'Governance'                                           https://www.ecf-coffee.org/about/structure/
    [    ] 'Secretariat'                                          https://www.ecf-coffee.org/about/secretariat/
    [    ] 'Our network'                                          https://www.ecf-coffee.org/about/network/
    [    ] 'Contact us'                                           https://www.ecf-coffee.org/contact-us/
    [    ] 'Members'                                              https://www.ecf-coffee.org/category/members/
    [    ] 'National Associations'                                https://www.ecf-coffee.org/category/members/national-associations/
    [    ] 'Companies'                                            https://www.ecf-coffee.org/category/members/companies/
    [    ] 'Become a Member'                                      https://www.ecf-coffee.org/membership/
    [    ] 'Publications'                                         https://www.ecf-coffee.org/category/publications/
    [    ] 'European Coffee Reports'                              https://www.ecf-coffee.org/category/publications/european-coffee-reports/
    [    ] 'Guidelines documents'                                 https://www.ecf-coffee.org/category/publications/guidance-documents/
    [    ] 'Stocks in European Ports'                             https://www.ecf-coffee.org/category/publications/stocks/
    [    ] 'European Standard Contract for Coffee (ESCC)'         https://www.ecf-coffee.org/category/publications/contracts/
    [    ] 'Press releases'                                       https://www.ecf-coffee.org/category/publications/press-releases/
    [    ] 'Infographics'                                         https://www.ecf-coffee.org/category/publications/infographics/
    [    ] 'News & Events'                                        https://www.ecf-coffee.org/category/whats-new/
    [    ] 'News'                                                 https://www.ecf-coffee.org/category/whats-new/news/
    [    ] 'Events & Meetings'                                    https://www.ecf-coffee.org/category/whats-new/events/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/soluble-coffee-enters-eudr-scope-under-commission-draftdelegated-act/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/ecf-participates-in-the-launch-of-the-international-trade-centre-brussels-office/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/stocks-in-european-ports-january-february-2026/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/ecf-brings-together-producing-country-missions-to-address-eu-sustainability-and-trade-implications-for-coffee/
    [    ] '(no text)'                                            https://www.ecf-coffee.org/category/uncategorised/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/msc-awarded-ecf-best-shipping-line-of-the-year-2024-2025/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/environmental-footprint-methodology-for-coffee-shadow-pefcr-of-the-european-coffee-federation/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/european-coffee-report-2024-2025/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/european-coffee-report-2023-2024/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/ilos-vision-zero-fund-and-the-european-coffee-federation-collaborate-to-improve-occupational-safety-and-health-in-the-global-coffee-supply-chain/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/european-coffee-report-2022-2023/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/ignazio-messina-c-receives-the-ecf-best-shipping-line-of-the-year-award-for-the-coffee-year-2021-2022/
    [    ] 'Read more'                                            https://www.ecf-coffee.org/the-german-coffee-association-has-launched-ear4u-a-grievance-mechanism-to-report-concerns-on-human-rights-and-environmental-risks/
    [    ] '2'                                                    https://www.ecf-coffee.org/category/news/page/2/
    [    ] '3'                                                    https://www.ecf-coffee.org/category/news/page/3/
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/

════════════════════════════════════════════════════════════
  Sample file probes (10 files)
════════════════════════════════════════════════════════════
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/05/data-jukyu202603.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/03/data-yunyu-suii2025.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/03/data-24-2025-2.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/05/data-24-202603.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/03/data-gc-yunyuryo-tanka2025.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2026/03/data-rcic-yunyuryo-tanka2025.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-nama2024.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-gc2024.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-rc2024.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
  206 application/pdf len=4096 magic=PDF
    https://coffee.ajca.or.jp/wordpress/wp-content/uploads/2025/09/data7-import-ic2024.pdf
    head: 25 50 44 46 2d 31 2e 36 0d 25 e2 e3 cf d3 0d 0a
```
