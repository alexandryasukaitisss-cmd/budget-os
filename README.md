# BudgetOS

English · [Русский](README.ru.md)

A local budget app for people who already write expenses in plain-text notes.
Paste the familiar list instead of entering every category again; compare planned and actual spending and add detailed records when needed.
The app runs as static HTML, CSS and JavaScript without a bank connection or account.

## Run

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. For phone installation and offline use, deploy the static files over HTTPS, for example with GitHub Pages.
The interface is Russian and displayed amounts use BYN. Starter categories and amounts are synthetic.

## Import example

```text
Траты (январь) 2026
100 (35) продукты
40 (10) транспорт
```

Open **Импорт**, paste the text and choose **Импортировать**.
The parser understands planned/actual amounts, category names, and supported service lines such as income/expense headings.
Review the resulting categories after import. There is no preview screen before applying an import.

## Features and limits

- Monthly categories, planned/actual amounts and remaining budget.
- Optional individual expense records and compact spending comparisons.
- Local browser storage and JSON export. No bank integration or synchronization.
- The starter month is December 2025. The app can import another month.

The Export button copies a JSON backup to the clipboard. Save that text yourself; a JSON restore UI is not implemented.
Use a month heading such as `Траты (январь) 2026`; an unrecognized heading applies the import to the selected month.
Clearing site data loses the local budget. The optional Google Fonts request can be unavailable offline; system fonts remain available.
The ZIP is rebuilt from the sanitized source, without household data.

## Origin

A standalone tool built around importing an existing notes format. No upstream GitHub project was identified.

## License

Own source: MIT.
