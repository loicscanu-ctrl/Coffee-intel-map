"""
fetch_kaffeesteuer.py
Downloads all monthly Steuereinnahmen PDFs from bundesfinanzministerium.de
and extracts the Kaffeesteuer (coffee tax) monthly value (in Tsd. EUR).
"""
import sys, re, requests, pdfplumber, io, time, json
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://www.bundesfinanzministerium.de"
ROOT = Path(__file__).resolve().parents[2]

PDFS = [
    ("2026-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2026-03-20-steuereinnahmen-februar-2026.pdf?__blob=publicationFile&v=2"),
    ("2026-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2026-02-20-steuereinnahmen-januar-2026.pdf?__blob=publicationFile&v=2"),
    ("2025-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-01-29-steuereinnahmen-dezember-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-12-23-steuereinnahmen-november-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-11-20-steuereinnahmen-oktober-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-10-21-steuereinnahmen-september-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-09-23-steuereinnahmen-august-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-08-21-steuereinnahmen-juli-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-07-22-steuereinnahmen-juni-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-06-20-steuereinnahmen-mai-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-05-22-steuereinnahmen-april-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-04-23-steuereinnahmen-maerz-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-02-25-steuereinnahmen-februar-2025.pdf?__blob=publicationFile&v=2"),
    ("2025-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-02-25-steuereinnahmen-januar-2025.pdf?__blob=publicationFile&v=2"),
    ("2024-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2025-01-30-steuereinnahmen-Dezember-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-12-20-steuereinnahmen-november-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-11-21-steuereinnahmen-oktober-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-10-22-steuereinnahmen-september-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-09-20-steuereinnahmen-august-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-08-22-steuereinnahmen-juli-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-07-23-steuereinnahmen-juni-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-06-20-steuereinnahmen-mai-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-05-24-steuereinnahmen-april-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-04-23-steuereinnahmen-maerz-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-03-21-steuereinnahmen-februar-2024.pdf?__blob=publicationFile&v=2"),
    ("2024-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-02-22-steuereinnahmen-januar-2024.pdf?__blob=publicationFile&v=2"),
    ("2023-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2024-01-30-steuereinnahmen-Dezember-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-12-21-steuereinnahmen-november-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-11-21-steuereinnahmen-oktober-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-10-20-steuereinnahmen-september-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-09-21-steuereinnahmen-august-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-08-24-steuereinnahmen-juli-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-07-20-steuereinnahmen-juni-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-06-22-steuereinnahmen-mai-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-05-19-steuereinnahmen-april-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-04-21-steuereinnahmen-maerz-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-03-21-steuereinnahmen-februar-2023.pdf?__blob=publicationFile&v=2"),
    ("2023-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-02-21-steuereinnahmen-januar-2023.pdf?__blob=publicationFile&v=2"),
    ("2022-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2023-01-27-steuereinnahmen-Dezember-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-12-22-steuereinnahmen-november-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-11-22-steuereinnahmen-oktober-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-10-20-steuereinnahmen-september-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-09-22-steuereinnahmen-august-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-08-19-steuereinnahmen-juli-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-07-21-steuereinnahmen-juni-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-06-21-steuereinnahmen-mai-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-05-20-steuereinnahmen-april-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-04-22-steuereinnahmen-maerz-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-03-22-steuereinnahmen-februar-2022.pdf?__blob=publicationFile&v=2"),
    ("2022-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-02-22-steuereinnahmen-januar-2022.pdf?__blob=publicationFile&v=2"),
    ("2021-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2022-01-28-steuereinnahmen-dezember-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-12-21-steuereinnahmen-november-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-11-19-steuereinnahmen-oktober-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-10-21-steuereinnahmen-september-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-09-21-steuereinnahmen-august-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-08-20-steuereinnahmen-juli-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-07-22-steuereinnahmen-juni-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-06-22-steuereinnahmen-mai-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-05-20-steuereinnahmen-april-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-04-22-steuereinnahmen-maerz-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-03-19-steuereinnahmen-februar-2021.pdf?__blob=publicationFile&v=2"),
    ("2021-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-02-19-steuereinnahmen-januar-2021.pdf?__blob=publicationFile&v=2"),
    ("2020-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2021-01-29-steuereinnahmen-dezember-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-12-22-steuereinnahmen-november-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-11-20-steuereinnahmen-oktober-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-10-22-steuereinnahmen-september-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-09-22-steuereinnahmen-august-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-08-20-steuereinnahmen-juli-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-07-21-steuereinnahmen-juni-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-06-19-steuereinnahmen-mai-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-05-22-steuereinnahmen-april-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-04-21-steuereinnahmen-maerz-2020.pdf?__blob=publicationFile&v=2"),
    ("2020-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-03-20-steuereinnahmen-februar-2020-html.pdf?__blob=publicationFile&v=2"),
    ("2020-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-02-21-steuereinnahmen-januar-2020.pdf?__blob=publicationFile&v=2"),
    ("2019-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2020-01-31-steuereinnahmen-dezember-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-12-20-steuereinnahmen-november-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-11-21-steuereinnahmen-oktober-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-10-21-steuereinnahmen-september-2018.pdf?__blob=publicationFile&v=2"),
    ("2019-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-09-20-steuereinnahmen-august-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-08-22-steuereinnahmen-juli-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-07-22-steuereinnahmen-juni-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-06-20-steuereinnahmen-mai-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-05-20-steuereinnahmen-april-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-04-23-steuereinnahmen-maerz-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-03-21-steuereinnahmen-februar-2019.pdf?__blob=publicationFile&v=2"),
    ("2019-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-02-21-steuereinnahmen-januar-2019.pdf?__blob=publicationFile&v=2"),
    ("2018-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2019-01-31-steuereinnahmen-dezember-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-12-20-steuereinnahmen-november-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-11-22-steuereinnahmen-oktober-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-10-22-steuereinnahmen-september-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-09-20-steuereinnahmen-august-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-08-20-steuereinnahmen-juli-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-07-20-steuereinnahmen-juni-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-06-21-steuereinnahmen-mai-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-05-22-steuereinnahmen-april-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-04-20-steuereinnahmen-maerz-2018.pdf?__blob=publicationFile&v=2"),
    ("2018-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-02-22-steuereinnahmen-januar-2018.pdf?__blob=publicationFile&v=2"),
    ("2017-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2018-01-26-steuereinnahmen-dezember-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-12-21-steuereinnahmen-november-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-11-23-steuereinnahmen-oktober-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-10-20-steuereinnahmen-september-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-09-21-steuereinnahmen-august-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-08-21-steuereinnahmen-juli-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-07-20-steuereinnahmen-juni-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-06-22-steuereinnahmen-mai-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-04", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-05-22-steuereinnahmen-april-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-03", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-04-21-steuereinnahmen-maerz-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-02", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-03-23-steuereinnahmen-februar-2017.pdf?__blob=publicationFile&v=2"),
    ("2017-01", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-02-23-steuereinnahmen-januar-2017.pdf?__blob=publicationFile&v=2"),
    ("2016-12", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2017-01-27-steuereinnahmen-dezember-2016.pdf?__blob=publicationFile&v=2"),
    ("2016-11", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2016-12-22-steuereinnahmen-november-2016.pdf?__blob=publicationFile&v=2"),
    ("2016-10", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2016-11-21-steuereinnahmen-oktober-2016.pdf?__blob=publicationFile&v=2"),
    ("2016-09", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2016-10-21-steuereinnahmen-September-2016.pdf?__blob=publicationFile&v=2"),
    ("2016-08", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2016-09-22-steuereinnahmen-august-2016.pdf?__blob=publicationFile&v=2"),
    ("2016-07", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2016-08-19-steuereinnahmen-juli-2016.pdf?__blob=publicationFile&v=2"),
    ("2016-06", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2016-07-21-steuereinnahmen-juni-2016.pdf?__blob=publicationFile&v=2"),
    ("2016-05", "/Content/DE/Standardartikel/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/2016-06-20-steuereinnahmen-mai-2016.pdf?__blob=publicationFile&v=2"),
]


def extract_kaffeesteuer(pdf_bytes: bytes) -> int | None:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.splitlines():
                if "Kaffeesteuer" in line:
                    nums = re.findall(r"\d+\.\d+", line)
                    if nums:
                        return int(nums[0].replace(".", ""))
    return None


def main():
    headers = {"User-Agent": "Mozilla/5.0"}
    results = {}
    for period, path in PDFS:
        url = BASE + path
        try:
            r = requests.get(url, headers=headers, timeout=20)
            val = extract_kaffeesteuer(r.content)
            status = str(val) if val else "NOT FOUND"
            print(f"{period}: {status}")
            if val:
                results[period] = val
        except Exception as e:
            print(f"{period}: ERROR {e}")
        time.sleep(0.3)

    out_path = ROOT / "data" / "kaffeesteuer.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    print(f"\nSaved {len(results)} records to {out_path}")


if __name__ == "__main__":
    main()
