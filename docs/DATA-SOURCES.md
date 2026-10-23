# Where Papurr gets its data

Papurr has no server of its own, and nothing is sent to its author. It contacts the services below only to look up
papers or, when you click, to fetch a PDF. Papurr is not affiliated with, or endorsed by, any of them.

| Service | What Papurr uses it for | What is sent |
| --- | --- | --- |
| **arXiv**: the API and the feed (`export.arxiv.org`) | Titles, authors, abstracts and versions; the list of Today's arXiv | arXiv identifiers, or the categories you follow (with the notification switched on, the feed of those categories is asked in the background, at most 8 times per announcement) |
| **arXiv** (`arxiv.org`) | The PDF of the paper you click; the HTML version, when you ask for a summary | The address of that paper |
| **INSPIRE** (`inspirehep.net`) | The arXiv number of a journal paper; "My papers"; your research profile; the INSPIRE page's search, a result's BibTeX | A DOI or arXiv number; the INSPIRE author ID you enter; the search you type, after you press Enter; the number of a result whose BibTeX you ask for |
| **Crossref** (`api.crossref.org`) | Title, authors and journal of a DOI or of a scanned article; identifying a PDF you import | A DOI or bibcode; the title written in a PDF you import |
| **OpenAlex** (`api.openalex.org`) | The arXiv number of a journal paper, when INSPIRE does not have it | A DOI |
| **NASA ADS** (`articles.adsabs.harvard.edu`) | The scanned article you click | The address of that article |
| **Publishers' sites** | The PDF of the article you click | The address of that PDF |
| **Your AI command** (`claude`, `codex` or `kimi`, on your computer) | Ranking, "Why recommended", translation and summaries, only when you press a button that says it uses your quota | What Settings and Help list; nothing else |

## How Papurr uses them

- **arXiv.** Requests to its API and feed are made one at a time, at least three seconds apart, across all Papurr pages
  together, as arXiv's terms ask. Metadata for many papers (Update index) is requested in batches, at the same pace.
  arXiv states that its descriptive metadata is available under CC0.
- **PDFs.** A PDF is fetched only after you click its link, one at a time, and saved in your own folder for your own use.
  Papurr never uploads, serves or redistributes a PDF, and downloads nothing in bulk or on a timer.
- **Publishers.** The PDF is fetched by your own browser with your own session, as if you saved the file yourself. Papurr
  does not sign in for you; you need access to the article, for example through your university.
- **NASA ADS.** One scanned article per click, saved in your folder. Links to ADS pages are ordinary links.
- **Your AI command.** Papurr has no AI and no API key. It runs the command you installed and signed in to, under your
  own plan, and never reads or sends your sign-in; a sign-in with an API key is refused. Nothing is sent unless you press
  a button that says it uses your quota.

## Your data

Settings stay in your browser. Your library (the PDFs, `index.json`, your notes and the research profile) stays in the
folder you chose. There are no accounts and no analytics.
