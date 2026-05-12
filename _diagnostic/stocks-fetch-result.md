# Stocks-fetch diagnostic

- commit: `54d055945a491a97ae5f143e316ba107d0d7cb4f`
- run:    https://github.com/loicscanu-ctrl/Coffee-intel-map/actions/runs/25760449229
- date:   2026-05-12 20:31 UTC

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
### ECF: https://www.ecf-coffee.org/category/publications/stocks/
  200 text/html; charset=UTF-8 75,403 bytes  magic=HTML
  links of interest (39):
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
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2026/03/2026-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2026/01/2025-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2025/01/2024-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2024/01/2023-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2023/01/2022-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2021/11/2021-Stocks-European-Ports_updated.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2021/03/2020-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2020/09/2019-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2020/09/2018-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2020/09/2017-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2020/09/2016-Stocks-European-Ports.pdf
    [FILE] 'Download'                                             https://www.ecf-coffee.org/wp-content/uploads/2020/09/2015-Stocks-European-Ports.pdf
    [    ] '2'                                                    https://www.ecf-coffee.org/category/publications/stocks/page/2/
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/

### ECF: https://www.ecf-coffee.org/stocks-in-european-ports-january-february-2026/
  200 text/html; charset=UTF-8 52,880 bytes  magic=HTML
  links of interest (26):
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
    [FILE] 'Download the full report'                             https://www.ecf-coffee.org/wp-content/uploads/2026/03/2026-Stocks-European-Ports.pdf
    [    ] 'Disclaimer'                                           https://www.ecf-coffee.org/disclaimer/
  number/stock phrases:
    … tocks in European Ports – January &amp; February 2026 25/03/2026 The European Coffee Federation
    … cks in European Ports report , covering January and February 2026 . The report provides a bi-monthl
    … ators across Europe. Key figures Total stocks decreased from 458,801 tons in December 2025 to 441,32
    … figures Total stocks decreased from 458,801 tons in December 2025 to 441,323 tons in January 2026
    … Total stocks decreased from 458,801 tons in December 2025 to 441,323 tons in January 2026 , and furt
    … cember 2025 to 441,323 tons in January 2026 , and further to 408,152 tons in February 2026 The decli
    … ns in January 2026 , and further to 408,152 tons in February 2026 The decline was observed across

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

## Stage 4 — real AJCA scraper run
- cache file written: `no`

```
[ajca] Could not extract figures from hub page — retaining cache
```

## Stage 5 — real ECF scraper run
```
[ecf_stocks] no stocks posts found at category index
{
  "count": 0,
  "items": []
}
```
