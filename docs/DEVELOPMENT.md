# Papurr — contributor guide

How Papurr is built and which rules keep it safe. Read this before changing code (`CLAUDE.md` has the short version).

## 1. What Papurr is

A Chrome extension (Manifest V3, plain JavaScript, no build step; one vendored library, KaTeX, for formulas) for researchers who read papers on
arXiv, INSPIRE, NASA ADS and journal sites.

**Core idea** (inspired by Yuji Tachikawa's Mac app *spires*, which keeps an index of downloaded PDFs and opens the local copy
instead of downloading again):

1. The user chooses **one papers folder** (anywhere, typically a cloud-synced folder).
2. Clicking a PDF link on a supported site is intercepted. The extension looks the paper up in the folder's `index.json`.
3. **Saved** → open the saved copy, download nothing. **Not saved** → download, save into the folder, record in the index, open.

There is no server and no database. **The folder is the library**: PDFs + `index.json`.

Why not just use Chrome's download folder? Users clean their Downloads folder, and Chrome only allows saving *inside*
it. Hence the File System Access API (a user-chosen directory handle), which also lets the extension look at the real
folder contents.

Additional product ideas that are part of the identity:
- arXiv versions (`v1`, `v2`, …) and the **journal version** are separate files of the *same* paper.
- Library page with search, sort, tags, per-version delete, links to arXiv/INSPIRE/ADS/DOI.
- Designed for **cloud-synced folders shared by several computers** (this is a primary use case, not an edge case).
- **Importing a collection the user already has**: PDFs put into the folder by hand are identified by reading them (arXiv stamp → number + version, journal PDF → DOI), renamed to Papurr's scheme **after the user approves**, and added to the index — so nobody has to download their library again.
- **Today's arXiv** (own page): latest papers of the followed categories with abstracts.
- "Show in folder" per paper (system file manager) and optional opening in an **external PDF app**, both through a small native-messaging helper.
- English, Japanese and Simplified Chinese UI; light/dark/auto theme; visual identity taken from the maintainer's website (violet/pink, a cat with a ring).

Name: *Papurr* = paper + purr. The repository, README and manifest use it. Some internal identifiers keep old names on
purpose (see §9).

---

## 2. Repository layout

| Path | Role |
| --- | --- |
| `extension/` | The extension (what is loaded unpacked in Chrome). |
| `extension/manifest.json` | MV3 manifest. Version, permissions, **required host permissions** for all default sites, `optional_host_permissions: https://*/*` for user-added sites, icons. |
| `extension/background.js` | Service worker: opens `open.html` for messages from the content script, toolbar icon → library, registers the content script dynamically for the user's site list, publisher-site migration, "handle PDF links" context menu + badge. Loads `i18n.js` and `common.js` with `importScripts`. |
| `extension/content.js` | Injected into the watched sites. Intercepts clicks on PDF links (arXiv by URL pattern; journals by DOI-in-URL or by `<meta citation_doi/citation_pdf_url>`). Respects the on/off switch (there is no keyboard bypass: a click with Ctrl, Shift, Alt or Cmd is snatched like any other; the switch is the one way to let links work as usual). |
| `extension/common.js` | **Shared core**: folder handle storage, the index (read/update/lock/backup/repair/merge/rebuild), arXiv/Crossref/INSPIRE/OpenAlex lookups, file-name helpers, settings getters, native-messaging call, how an AI's answer is read (`parseLooseJson`, `jsonLikeField`, `normalizeAiText`: a fence, a raw line break, single LaTeX backslashes, `\\( \\)` turned into `$ $`) and the language style line (`AI_LANGUAGE_STYLE`: Japanese in the polite form). Used by every page and by the service worker. |
| `extension/import-ui.js` | The Settings → Folder part of the import: note with the count, **Identify and rename…** button, the review panel (checkboxes, Check/Uncheck all, "Yes to all"), progress and summary. Loaded by `options.html` only (the library page just shows a note with a link: `updateImportBanner` in `library.js`). |
| `extension/import.js` | Importing PDFs added by hand: `scanPdf` (reads a PDF: arXiv stamp, DOI, title; no library, uses the browser's `DecompressionStream`), `identify`, `planImport` (looks up, proposes names, changes nothing), `renameFile`, `applyImport`, `findUnmanagedPdfs`. No DOM; loaded by `library.html` only. |
| `extension/today.js` / `today.html` | "Today's arXiv": the latest announcement of the categories chosen in Settings (arXiv's feed `export.arxiv.org/rss/A+B`, new + cross-lists, with their details: one request; the API by `id_list` only for a feed without details; fallback without feed: API listing reconstructed from submission times), the count as arXiv gives it, abstracts, category filter chips, "In library" marks, Load more (older papers) / Refresh. The kept list stays fresh until the next announcement is due (`cacheIsFresh`: arXiv announces Sunday to Thursday at 20:00 US Eastern time, dated the next weekday; a list made from submission times is kept 6 hours); the row of the last 5 announcement days also works at weekends (`lastAnnouncedDate` takes the date from the clock when the feed is empty); a full storage never breaks the page (`keepQuietly`). |
| `extension/ai.js` | The only place that may ask the AI: `aiClick` (proof of a click), `aiRun` (needs the click token, the switch, the agreement, Mac/Linux; one run at a time; cancel; logs every run), settings (`ai` in `chrome.storage.local`), `estimateTokens`, usage log, install commands to copy (`AI_COMMANDS`), the **technical level of summaries** (`SUMMARY_LEVELS`: overview / standard / technical) and the user's own instructions for summaries (`summaryNote`, at most 600 characters, `cleanSummaryNote`; the consent text names them). No timers, no retries. |
| `extension/ai-ui.js` | Settings → AI: agreement, switch, **Check** (asks the helper `ai_status`; never on page load), model/effort lists read from the command, install / sign-in help, estimate switch, usage list. |
| `extension/profile.js` | The research profile, no DOM, never talks to the AI: INSPIRE (`fetchInspirePapers`, `fetchInspireAuthor`, address parsing), the fixed prompt (`buildProfilePrompt`), the checked answer (`parseProfileAnswer`), the file `papurr-profile.json` in the papers folder (`readProfile` with conflict-copy merge, `updateProfile`, `sanitizeProfile` for a synced and therefore untrusted file), what is new (`papersToRead`, `pendingReactions`, `profileAfterAnswer`). |
| `extension/profile-ui.js` | Settings → AI → "My research": the form and the **two steps** (prepare = INSPIRE + estimate, no quota; run = the only `aiRun` call, from its own click). |
| `extension/reason.js` | "Why recommended", no DOM, never talks to the AI: the fixed prompt (`buildReasonPrompt`: profile + one paper's title and abstract, answer language = UI language, names no field or topic), the checked answer (`parseReasonAnswer`, schema `{reason}`), the cache (`aiReasons`, per paper, 14 days), `writeReasonToNote` (only if the paper has a note), `fetchArxivPaper` (the abstract for the note page; no quota). |
| `extension/summary.js` | Full-text summary, never talks to the AI: the text from arXiv's HTML version (`fetchFullText` → `extractArxivHtml`: LaTeXML article, formulas as LaTeX from `alttext`, figures → "[Figure: caption]", no bibliography; needs the browser's DOMParser), errors (`SourceError` kinds nohtml / unreachable / format / toolong), the kept text (`summarySources`, 3 days, last 3 papers), the fixed prompt (`buildSummaryPrompt`: sections Gist / Background / Main results / Method / Limitations and open questions / Relation to your research (only with a profile), output language, LaTeX formulas), `parseSummaryAnswer`, `summaryBlock`. |
| `extension/translate.js` | Translation, no DOM, never talks to the AI: the fixed prompt (`buildTranslatePrompt`: into the AI's output language; formulas and Markdown kept, nothing added), `parseTranslateAnswer`, `translateOutputTokens`, kept translated abstracts (`aiTranslations`, per paper and language, 14 days), `writeTranslationsToNote` (block `abstract@<lang>`, only if the paper has a note). |
| `extension/rank.js` | Ranking, no DOM, never talks to the AI: the fixed prompt (`buildRankPrompt`), the answer schema (root object `{scores: [{id, score}]}`), the checked answer (`parseRankAnswer`: only asked ids, once, 0..100), the score cache (`getScores` / `saveScores`, key `aiScores`, tied to `rankStamp` = profile version + level, 14 days), `papersToRank`, `papersToRerank` ("Re-rank with the current model": scores carry the model chosen in Settings), `orderByRelevance` (not interested last), `setReaction` (saved in the profile file without changing its version). |
| `extension/inspire.js` | The INSPIRE API, no DOM: `inspireSearchUrl` (the API address: the query, 25 a page, the order, only the fields of a list), `parseInspireHits` (every value checked; the list is drawn as text), `inspireAuthorQuery`, `fetchInspireSearch` (one request, 60 s, errors as plain sentences), `fetchInspireBibtex`. Loaded by `inspire.html`. |
| `extension/inspire.html`, `extension/inspire-page.js` | **The INSPIRE page** (header link "INSPIRE"): its own search box, cards in the library's look. Only Enter or the Search button starts a request (never opening the page or typing). Cards, order chips, BibTeX, Cited by / References, author links and "Show more" as in; "Add to library" saves in a background tab with `&save=1&quiet=1` and a quiet `added` message makes the page re-read its "In library" set; "In library" opens the paper in the library. |
| `extension/open.js` / `open.html` | The page that *performs* a click: finds the saved file or downloads it, updates the index, then shows the PDF (Chrome tab via a blob URL, or the external app). |
| `extension/library.js` / `library.html` | Library UI: list, search (with scopes: standard / title / authors / tag / notes), sort, note filters, tags (+ manager), version/journal chips, "Note" button (note icon; tooltip says what the note holds) or "Add note", "PDF not saved", highlighting a paper added from another tab (`highlight`, channel `papurr`, `?highlight=<id>`), delete, "Show in folder", update index, repair box, empty state, and the import note. |
| `extension/note.js` / `note.html` | The note page of one paper (`note.html?id=<key>[&summarize=1]`, opened in the same tab since 0.15.2): the full-text summary in two steps (`prepareSummary`: source + estimate, no quota; `runSummary`: the AI call, from the button that shows the estimate; a paper not yet in the library is added as note-only only when the summary is made), creates the note on first open (and writes a reason still kept in the browser into it), shows Papurr's sections read-only (Delete; the reason also "Redo with the current model": `redoReason`, an AI call site), edits only the user's section with explicit save (button, Ctrl/Cmd+S), conflict check, "Open in my editor" (helper `edit`), "Show in folder"; a small safe Markdown renderer (builds DOM nodes; formulas stay LaTeX text). |
| `extension/options.js` / `options.html` | Settings: language and theme, folder, open-with (with a line that says whether the helper is registered and points to Help if not: `showHelperStatus`; opening Settings only *pings* the helper), sites (+ link icons), credit line. |
| `extension/i18n.js` | Dictionaries (`I18N.en`, `I18N.ja`, `I18N.zh`), `tr()`, `dateLocale()`, page translation. |
| `extension/theme.js` | Colour themes (`THEMES`, chosen in Settings), the shared header (current page, the "Snatch PDF links" switch ("横取りモード" / "截胡 PDF 链接"), a link to the INSPIRE page) **and the working indicator** (`startBusy`/`endBusy`/`withBusy`: the ring of the mark spins and, after 250 ms, a label appears in the status line, a fixed-height row under the header that is there from the start, so nothing moves; `statusLine()`). |
| `extension/style.css` | Single stylesheet for all pages (CSS variables, light + dark palettes). |
| `extension/vendor/katex/` | **KaTeX 0.16.11** (MIT), unmodified: `katex.min.js`, `katex.min.css`, the `.woff2` fonts, `LICENSE` and a README with the source and checksum. Loaded by the note page and Today's arXiv; `mathElement` / `textWithMath` in `common.js` use it. The only third-party code in Papurr. |
| `extension/icons/` | Toolbar/store icons (PNG, from the maintainer's favicon) and `mark.svg`. |
| `native/paper_opener.py` | Native-messaging helper (actions `edit` (a note `.md` in the default text editor: `open -t` on a Mac, `xdg-open`, Windows file association or Notepad), `ping` (also names the app that will open PDFs: on a Mac the Launch Services choice for `com.adobe.pdf` or Preview, found with Spotlight; on Linux `xdg-mime` + the `.desktop` name), `locate` (full path of the papers folder), `open`, `reveal` (PDFs and notes)): opens a PDF of the papers folder in an external app, or shows it in the file manager (`open -R` on a Mac). Python 3 standard library only. |
| `native/ai_runner.py` | The AI part of the helper: `ai_status` (command, version, `claude auth status`, model catalog; no quota) and `ai_run` (fixed safety flags, the answer read leniently by `loose_json`, prompt through stdin, temporary working directory, API-billing variables removed, refuses non-subscription logins, one run at a time via a lock file, time limit, **closing the pipe cancels**: the command is killed and everything removed). |
| `native/install.py` | Registers the helper for Chrome/Chromium/Brave/Edge: Linux and macOS (manifest in each browser's settings folder; on macOS through a generated `.sh` launcher), Windows (manifest `native/com.paper_folder_manager.opener.json` + generated `paper_opener_launcher.bat`, one `HKCU\Software\…\NativeMessagingHosts\<name>` registry key per installed browser; the `.bat` is written in the console code page, or in UTF-8 after `chcp 65001` when the path has characters it cannot write). Both generated files are git-ignored. |
| `native/Install helper (Windows).bat` | Double-clickable wrapper around `install.py` for Windows users (`py -3`, else `python`; explains how to get Python 3 if it fails). |
| `native/Install helper (Mac).command` | Double-clickable wrapper around `install.py` for Mac users (the maintainer must never need an assistant or a terminal to set up). |
| `extension/help.html` / `help.js` | The **Help page** ("使い方" / "Help" in every header, and a **?** next to each Settings section that opens the matching part: `help.html#<id>`). The user's manual: getting started, folder and cloud sync, library, notes, import, Today's arXiv, sites, helper, AI features (rules, what is sent, quota guide), privacy, limits. `HELP_SECTIONS` lists the sections and their keys; the texts are `help.*` in all three dictionaries (a list item can nest a list: `[key, [keys]]`); `**bold**` and `` `code` `` in a text become `<strong>` / `<code>` (built as elements, never HTML). **Update it with every user-visible change.** |
| `docs/INSTALL-AGENT.md` | Instructions for **the user's own AI assistant** when the user asks it to install, set up or update Papurr (README "A. Let an AI assistant do it"). Strict rules: no repository changes, nothing installed without asking, no sign-ins or credentials, no touching Chrome's files except `native/install.py`, the papers folder and all agreements are the user's. `CLAUDE.md` and `AGENTS.md` point to it in a box at the very top. Keep it in step with the real UI labels and the installer when either changes. |
| `dev-tests/` | Automatic checks (see §8). Not part of the extension. |
| `README.md`, `README.ja.md` | User-facing documentation. |
| `LICENSE` | MIT licence, © 2026 Atsuhisa Ota (chosen by the maintainer; do not change). |
| `docs/DEVELOPMENT.md`, `CLAUDE.md`, `AGENTS.md` | This guide and its short entry points. |
| `docs/DATA-SOURCES.md` | The public, factual list of what Papurr contacts and why (exported). |

Total code is about 11,000 lines (extension about 9,800, of which the three dictionaries are about 1,800; helper about 1,250), the tests about 5,100 more (2026-10-13). Everything is deliberately plain: no framework, no bundler, no TypeScript; the only third-party code is KaTeX (vendored, for formulas).

---

## 3. Data model

### 3.1 `index.json` (in the papers folder)

```json
{
  "schemaVersion": 3,
  "papers": {
    "2402.01234": {
      "title": "…", "authors": ["Ann Smith", "Bo Chen"], "authorCount": 7,
      "added": "2026-10-01T00:00:00Z", "modified": "2026-10-03T12:00:00Z",
      "doi": "10.1007/jhep01(2024)001",
      "tags": ["symmetry", "TFT"],
      "versions": { "v1": "2402.01234v1.pdf", "v2": "2402.01234v2.pdf" },
      "journal": { "file": "10.1007_jhep01(2024)001.pdf", "doi": "10.1007/jhep01(2024)001", "name": "JHEP", "year": 2024 },
      "note": "2402.01234.md"
    },
    "doi:10.1103/physrevd.108.045001": { "…": "journal-only paper: no arXiv ID, versions is {}" },
    "2405.00007": { "…": "note-only paper: versions is {}, no journal, but a note (schema 3)" }
  }
}
```

- **Key** = arXiv ID (new `2402.01234` or old style `hep-th/9901001`), `ads:<bibcode>` for a paper known only by its NASA ADS bibcode, or `doi:<lowercase doi>` for journal-only papers.
- `authors` keeps at most 5 names (`MAX_AUTHORS`); `authorCount` is the true count (the UI shows "et al.").
- `versions` maps `v<N>` (or `"unversioned"`) → file name. `journal` is optional. `note` (optional) is the file name of the paper's note (§3.3).
- **Schema 3** (Papurr 0.11): an entry may have **no PDF but a note** ("note-only"; e.g. its PDFs were deleted, later: a summary made without the PDF). Schema 2 code would drop such entries in Update index, so the version was raised and older versions refuse the file (`index.newer`); version-2 files are read as they are and written back as 3. `hasPdf(entry)` tells the two kinds apart (Today's "In library" uses it).
- `modified` is set by `touch(entry)` on every change; it decides the winner when two copies are merged.
- Older formats are read and migrated in `parseIndexText` (a plain map without `schemaVersion`; entries with `file` instead of `versions`).
- **Odd values are put right on reading** (`tidyEntry`): a number as title → text, a single author or tag → a list of one, non-text authors/tags converted or dropped, version files that are not names, a `journal` without a file, and non-text `note`/`doi`/`added`/`modified`/`bibcode` are left out. A correct entry is left exactly as it is. Before, one such value (an index edited by hand or written by another program) made the whole library list fail.
- Files in the folder: arXiv `<id>v<N>.pdf` (old-style IDs: `/` → `_`), journal `journalFileName(doi)` (unsafe characters → `_`, long names shortened with a hash), notes `<id>.md` (no version; `noteFileName`) or the DOI name with `.md` for journal-only papers.
- Other files created by the extension: `index.json.bak` (rolling backup), `index.damaged.json` (unreadable index kept aside), `.paper-folder-id` (marker for the helper).

### 3.2 Where everything else lives

| Data | Location |
| --- | --- |
| Folder handle | IndexedDB `papers` → store `kv` → key `dir` (a `FileSystemDirectoryHandle`; Chrome never reveals the real path). Per browser profile and computer. |
| Settings: `sites`, `dbLinks`, `openMode`, `viewer`, `language`, `captureEnabled`, `publisherSitesSeen` (legacy `publishersAdded`) | `chrome.storage.local` |
| "Why recommended" answers (`aiReasons`: id → language → {text, at, model}, 14 days; the older form id → {text, …} is read as the interface language) | `chrome.storage.local` |
| The assembled full text of the last few summarized papers (`summarySources`: id+version → {text, at}; 3 days, at most 3), for a retry or redo without downloading again | `chrome.storage.local` |
| Translated abstracts (`aiTranslations`: id → language → {text, at, model}, 14 days) | `chrome.storage.local` |
| The language the AI writes in (`ai.outputLang`: "" = the interface language, or a code of `AI_OUTPUT_LANGUAGES` in `common.js`) | `chrome.storage.local` (per computer, like the other AI settings) |
| Followed arXiv categories (`arxivCategories`), cached Today list (`todayCache`), kept lists of earlier announcements (`todayHistory`: [{date, categories, announced, papers}], 5 announcement days per category choice, 15 entries in all), library files without a version that were checked and have none to give (`unversionedChecked`) | `chrome.storage.local` |
| **Last-opened times** (`opened`: id → ISO time) | `chrome.storage.local` — **deliberately not in `index.json`** (see §5) |
| What the library shows about each note (`noteInfo`: file → modification time, has summary / reason / user text), and `notesChanged` (a time stamp the note page sets so open library tabs read their list again) | `chrome.storage.local`; the notes' full text is read only when the Notes search scope is used and kept in the page's memory |
| Theme, sort choice, cached language | `localStorage` of the extension pages |
| Helper: marker token → real path | `~/.cache/paper-folder-manager/folders.json` (written by `paper_opener.py`) |

### 3.3 Note files (`<id>.md`, one per paper, in the papers folder)

```markdown
<!-- papurr:head -->
# Title
Ann Smith, Bo Chen · [arXiv:2402.01234](https://arxiv.org/abs/2402.01234)
<!-- /papurr:head -->

<!-- papurr:reason model=… date=2026-10-09T10:00:00Z lang=ja -->
…why recommended (stage 2), in Japanese…
<!-- /papurr:reason -->

<!-- papurr:reason model=… date=… lang=en -->
…the same in English (each language is its own block; making one never replaces another)…
<!-- /papurr:reason -->

<!-- papurr:summary model=… date=… version=v2 lang=ja -->
…summary (stage 3): Markdown with ### sections, in the language of lang…
<!-- /papurr:summary -->

## Notes            (or "## メモ": the heading is written in the UI language and kept as the user has it)

The user's own text. Papurr never changes it except when the user saves it from the note page.
```

- The order of the sections can be chosen on the note page (↑ / ↓) and is kept in the head block's `order` attribute; without it, Papurr's sections come first.
- `parseNote(text)` → `{ blocks: {key: {attrs, body}}, user }`, where the key is the block name plus its language (`noteBlockKey`: `"reason@ja"`; a block without `lang`, written by 0.12 before languages were kept, is keyed `"reason"` and shown as "Earlier version"; redoing it replaces it with a version in the output language); `buildNote(note)` writes Papurr's blocks first in the order `NOTE_BLOCKS` (head, reason, summary; unknown block names from a newer Papurr are kept, sorted after them), then the user's text. Attribute values have no spaces. **Text Papurr is not sure is its own stays the user's**: a start marker without its end marker, or a second block of the same name, is left in the user's text. Text the user typed *between* blocks in another editor moves below the blocks when Papurr next writes (nothing is lost). `buildNote(parseNote(t)) === t` for a file in this layout (tested), also with Windows line ends read.
- Notes are changed only through `editNote(dir, name, change)` (lock `papurr-notes`, re-reads the file, writes only if changed) or the note page's save (same lock, compares the user's section with the one editing started from). `ensureNote(dir, key)` creates a missing note (index lock, then notes lock: **always in this order**) and sets `entry.note`. `moveNote` / `mergeNotes` / `absorbDoiEntry` handle a journal-only paper that is linked to arXiv (open.js both paths, import.js both paths): its journal file, **tags** (union; before 0.11 they were lost) and note go to the arXiv entry; the DOI-named note is renamed to `<id>.md`, merged with an existing one (both user texts kept, Papurr's newer block wins by `date`), and removed only after the new file was written; if writing fails the entry keeps pointing at the old note.

---

## 4. Control flow

```
page with a PDF link ──click──> content.js ──message──> background.js ──opens tab──> open.html?<request>
                                                                                        │ open.js
   request forms:  ?id=2402.01234[&v=v2]   arXiv paper (no v = latest, checked on arXiv)
                   ?id=<key>&local=1       newest saved copy, never goes online (library title link)
                   ?id=<key>&journal=1     saved journal copy (library "Journal" chip)
                   ?doi=…&pdf=<url>        journal PDF link clicked on a publisher site
                   ?id=…[&v=vN]&save=1      save without opening ("Add to library" in Today's arXiv), then hand over to the library
                                                                                        │
        find in index (+ file still exists?) ── yes ──> markOpened() ──> show()
                         │ no
        download (arXiv: pdf URL; journal: fetch with the user's cookies, must start with "%PDF-")
        → write file → updateIndex(...) → markOpened() → show()
        show(): Chrome tab = blob URL of the file   |   external app = native message to paper_opener.py
```

- **Interception** (`content.js`): arXiv links by regex (`/pdf/<id>[vN][.pdf]`). Journal links: (1) link equals the page's `citation_pdf_url` and the page has `citation_doi`; (2) the path contains `/pdf` or `.pdf` and a DOI (`10.\d{4,9}/…`). Non-left clicks and the "snatch PDF links" switch being off all leave the link alone. The handler must call `preventDefault` synchronously, so the switch value is cached in a variable (updated through `chrome.storage.onChanged`).
- **Refused journal downloads** (`fetchThroughPage` in `open.js`): if the extension's own request is refused (e.g. 403 from bot protection: the request comes from the extension's page and may lack the site's cookies) or returns no PDF, the tab where the link was clicked (`src`, passed by `background.js`) is asked once, via `chrome.scripting.executeScript` (isolated world), to fetch exactly that PDF URL (`pagePdfFetch`): only https, only the same site as that tab, at most 40 MB, must start with `%PDF-`; nothing else of the page is read or changed. If that fails too, the error, "Open the PDF the normal way" and a suggestion to save the PDF into the papers folder and use Settings → "Identify and rename..." are shown.
- **ADS scanned articles** (`runAdsLink`): a click on `articles.adsabs.harvard.edu/pdf/<bibcode>` (content.js: `open-ads`, with the `citation_title` / `citation_author` of the ADS page, else its `<title>`) → `open.html?ads=<bibcode>&pdf=…&title=…&authors=[…]` → saved as `<bibcode>.pdf` under `ads:<bibcode>` (no lookup at ADS: it shows programs a human-verification page; an empty title is filled from Crossref by Update index, `fetchBibcodeMetadata`). `fetchPdf` (shared with journals) tries the extension's request, then the page's. Host permission `articles.adsabs.harvard.edu` added.
- **Journal handling** (`downloadJournal`): DOI → Crossref (title, authors, journal, year) and `findArxivIdForDoi` (INSPIRE, then OpenAlex). If an arXiv ID is found the journal PDF is attached to the arXiv entry; otherwise a `doi:` entry is created. When an arXiv version is later saved and its arXiv metadata carries the same DOI, the `doi:` entry is merged in.
- **Add to library** (in the row of every paper in Today's arXiv, where "In library" is shown once it is saved; with or without AI): Today opens `open.html?…&save=1` in a background tab (in front if the folder still needs a permission prompt); it saves the PDF if needed (no `markOpened`, nothing shown), then posts `{type: "added", id}` on the `BroadcastChannel("papurr")`. A library tab answers `{type: "shown"}`, brings itself to the front, reloads its list and highlights the paper for 4 s (clearing a search or filter that would hide it); the saving tab then closes itself. With no answer within 1 s the saving tab turns into `library.html?highlight=<id>`. Today hears the same message and marks the paper "In library".
- **Notes**: the library's "Note" button / title of a note-only paper / "Add note" (and "Summarize the full text...") open `note.html?id=<key>` **in the same tab** (maintainer, 0.15.2; `openNote` in `library.js`; the library reads its list again when it is restored with Back, `pageshow`); opening it creates the note (`ensureNote`). The page saves only on request and, if the file's user section changed since editing started (another computer, an editor), shows "Load that version" / "Save my version"; a change only in Papurr's blocks is merged silently. Coming back to the tab reloads a file that changed (unless editing). Deleting a paper's last PDF keeps the entry if it has a note.
- **Latest version**: an unversioned arXiv link asks the arXiv API for the latest version and downloads it only if not saved (older versions are kept).
- **Sites**: `getSites()` (storage, default `DEFAULT_SITES` = arXiv, INSPIRE, ADS + `PUBLISHER_SITES`). `background.js` registers one content script (`chrome.scripting.registerContentScripts`) for exactly the sites that are in the list **and** for which the extension has host permission. Default sites need `host_permissions` in the manifest; user-added sites are requested at runtime (`chrome.permissions.request` from a click, inside `options.js`).
- **Link icons**: `DEFAULT_DB_LINKS` (arXiv, INSPIRE, ADS); users can add an icon + URL template (`{id}` = arXiv ID) together with a site. The DOI icon is built in.

---

### 4.2 Today's arXiv (`today.js`) and the working indicator

- Settings → Today's arXiv: preset buttons + a text box (`isArxivCategory` validates); stored as an array in `chrome.storage.local.arxivCategories`.
- `today.html` → `arxivListingUrl(categories)` = `search_query=cat:A+OR+cat:B`, `sortBy=submittedDate`, descending (cross-lists included; archives with subjects such as `astro-ph`, `math`, `cs` become `astro-ph.*`; `math` does not include `math-ph`). First the feed (`arxivFeedUrl`, `parseArxivFeed`: announcement date and items with `announce_type` new / cross / replace / replace-cross, each with title, version, abstract, categories and authors); the new + cross papers are taken **from the feed itself** (arXiv's order: new, then cross-lists; headed "New submissions" / "Cross-lists"; the announcement date stands in for the submission time) and marked `latest`; only a feed without details falls back to the API by `id_list` (100 per request); the count line says "N papers announced on <date> (x new, y cross-lists); z replacements are not listed" (verified 2026-10-09 against arXiv's new pages for hep-th, hep-ph, astro-ph.CO, gr-qc: 71 new + 19 cross = 90, exactly). Empty feed (weekends, holidays) or feed failure: pages of 200 of the listing until the announcement reconstructed from submission times is complete (`latestAnnouncement` in `rank.js`; at most 5 requests), and the count line says it is estimated. "Load more" reads the listing on from `apiOffset` (skipping papers already listed, reading on until something is added) and adds older papers (pause ≥ 3 s between requests, as arXiv asks); the result is kept per category set until the next announcement is due (see `cacheIsFresh`); Refresh forces a request. The title opens `open.html?id=<id>&v=<version>` (so the paper is saved); "In library" comes from `index.json` when the folder is readable without a prompt.
- Where the import lives (maintainer's decision): **Settings, under *Choose folder***. The library shows its "not shown correctly" note **only after a rename run in Settings that left files behind** (`chrome.storage.local.importNotice`, set by `applyChosen`), with a × that clears the flag; it disappears by itself when nothing is left, and only the next such run can bring it back.
- Library header: link "Today's arXiv" next to Settings; Today header: Library and Settings; Settings keeps only "Library" (the structure stays Library ↔ Settings, Today is a second reading page).
- **Working indicator**: `withBusy(label, fn)` around anything slow (loading the library, Update index, import, saving, Show in folder, fetching, opening a paper). The label goes into the status line under the header; pages without a header (the open page) only get the spinning ring.

### 4.1 Importing PDFs added by hand (`import.js`, panel in `library.js`)

```
Settings → Folder (and the note in the library) ─> findUnmanagedPdfs (*.pdf not named in index.json) ─> "N PDFs not in the library yet"
                                   │ user presses "Identify and rename…" in Settings
       planImport:  1 read every file (scanPdf → identify)         arXiv stamp > DOI in metadata > ADS bibcode printed twice > DOI repeated in text
                                                                    > file name > exact title found at Crossref
                    2 arXiv metadata in batches of 50 / Crossref + INSPIRE/OpenAlex per journal PDF / Crossref per bibcode
                    3 decide per file: rename | same (already named right) | duplicate | unknown     (nothing is changed;
                      files without a final %%EOF, i.e. cut off, are marked and decided last, so a complete copy wins)
       review panel: old → new, title, "Please check" for uncertain ones (start unchecked), Check all / Uncheck all,
                     "Rename N checked", "Yes to all"; duplicates and unknown files listed with the reason
       applyImport: renameFile (move(), else copy + size check + delete; never overwrites) → updateIndex in batches of 50
```

- The scheme is the one `open.js` uses: arXiv `<id>v<N>.pdf` (`/` → `_`), journal `journalFileName(doi)`; a journal PDF whose DOI maps to an arXiv ID (INSPIRE/OpenAlex) is attached to that arXiv entry, otherwise `doi:<doi>`.
- **How a PDF is read** (`scanPdf`): find `stream … endstream` objects, skip pictures/fonts, inflate with `DecompressionStream("deflate")` (it refuses trailing bytes, so the stream is cut at `/Length` or before the final line break), take text from `BT … ET` objects (`Tj`/`TJ`, big negative kerning = space). The arXiv stamp counts only when a *whole text object* is `arXiv:<id>v<N> [cat] <date>` (a reference list never matches). DOIs: metadata fields (XMP `prism:doi`, `dc:identifier`, Info `/Subject`…) win; otherwise the DOI repeated most often in text/links (3+ times = trusted, otherwise "please check"). Hex-encoded CID text cannot be read (no font tables) — such PDFs rely on metadata/file name.
- The maintainer's rule: **a file that is not renamed is not indexed** (the library would show it wrongly) and the UI says so (banner, review text, summary). Files already named correctly need no consent and are just indexed.

## 5. Invariants — do not break these

1. **Every change to `index.json` goes through `updateIndex(dir, mutate)`** in `common.js`. It takes a lock (`navigator.locks`, name `paper-folder-index`, 30 s timeout), reads, calls `mutate`, and writes **only if the content changed**. Never write the index with `writeFileText` directly (the only exceptions are the repair functions and the conflict merge, which hold the lock themselves).
2. **An unreadable index must never be overwritten.** `readIndex`/`parseIndexText` throw `IndexError` (`kind: "damaged" | "newer"`); the UI offers *Restore from backup* / *Start over from the files*. A schema newer than `SCHEMA_VERSION` is refused (another computer may run a newer version).
3. **Compute new state from the stored state inside `updateIndex`, not from what is on screen.** (Bug found by testing: adding three tags quickly lost two because each save started from stale UI state. `editTags()` is the pattern to follow.)
4. **Per-computer data stays out of the shared file** (last-opened times → `chrome.storage.local`). Writing it into `index.json` would make every open a synced change and cause conflicts.
5. **Schema changes** require bumping `SCHEMA_VERSION`, a migration in `parseIndexText`, and tests. Old files must still be readable.
6. **Cloud-sync safety**: conflict copies (`index (conflicted copy …).json`, `index (1).json`, `index.sync-conflict-….json`, …) are merged entry by entry (`mergeEntries`: newer `modified` wins per entry, saved files are unioned) and then deleted — only after the merged index is written. `Update index` asks before removing many entries (files may just not have synced yet).
7. **UI text goes through `tr()`** (§7). Code comments are English. UI languages: English, Japanese and Simplified Chinese (`I18N.zh`; every key in all three dictionaries, checked by `test-i18n.js`); the credit line is English in all.
8. **Do not use a popup for the folder picker.** `showDirectoryPicker` from an action popup closed the popup and crashed Chrome. The toolbar icon opens the library in a normal tab.
9. **`requestPermission()` on the folder handle needs a user gesture.** Call it directly from click/keydown handlers (the code does this before every write).
10. **Never touch the user's PDFs** except to create/delete files the user asked for through the UI. Renaming (import) needs the user's approval per file or "Yes to all"; the content is never changed, an existing file is never overwritten, a failed copy leaves no half-written file. Saving never writes over a file that is already there (`existingPdf` in open.js: a PDF of that name is taken as it is; anything else stops the save), and a rename that only changes upper/lower case goes through a temporary name (on Macs and Windows both names are one file;).
11. **Notes belong to the user.** Papurr writes only its own marked blocks and, on the note page, the user's section when the user saves; it re-reads the file right before every write; it never deletes a note except by moving it to the arXiv name after writing the new file. No autosave.
12. **All requests to arXiv's API go through `arxivApiFetch`** (one at a time, 3 s apart, for all pages and tabs together; arXiv's terms). Do not call `fetch` on export.arxiv.org directly.
13. After extension updates, already-open tabs keep a dead copy of the content script; it is harmless (it checks `chrome.runtime.id`) but the user must reload tabs.

---

## 6. The index mechanisms (in `common.js`)

- `readIndex`, `updateIndex`, `withIndexLock`, `refreshBackup` (at most one `index.json.bak` per day, only from a readable index), `restoreIndexBackup`, `resetIndex`, `mergeConflictCopies`, `mergeEntries`.
- `rebuildIndex(dir, {report, confirmRemoval, isCancelled})` ("Update index"): merges conflict copies; lists the folder; drops entries whose files are gone (**the note counts as a file**: an entry with a note and no PDF stays; a vanished note clears `note`; asks first if more than 3 **and** more than 10 % are missing); adds arXiv-named PDFs not yet indexed and arXiv-named notes (`2301.12345.md`: sets `note`, or creates a note-only entry with metadata from arXiv; other `.md` files are ignored); fills empty titles (retry after failed lookups). arXiv metadata is requested in **batches of 50** with a 3 s pause (arXiv's request); Crossref one by one for journal-only entries. Network work happens outside the lock; the result is applied inside a final `updateIndex`.
- Import (see §4.1) is separate from `rebuildIndex`: Update index only adds arXiv files whose **name carries a version** (`2301.12345v2.pdf`). Names without a version (`2301.12345.pdf`) are left to the import, which reads the version from the PDF — otherwise they were recorded as "PDF" with no version (a bug the maintainer reported). Library entries already recorded without a version are offered for renaming too (`findUnversionedFiles`); those whose PDF does not say are remembered (`unversionedChecked`) so the banner does not nag.
- `parseFileName` recognises `2301.12345v2.pdf`, `arXiv-2301.12345_….pdf` (older naming) and `hep-th_9901001v1.pdf`.
- `arxivSortKey` orders IDs by submission month then serial (old-style IDs handled).
- Library rendering: first 100 papers, "Show more" adds 200; search is debounced (150 ms); the tag bar shows 12 tags by most use, "Show all" + a filter box. Notes: `readPapers` also lists the folder's `.md` files and stats each paper's note (`p.noteFile`, `p.noteInfo`; read again only if its modification time changed). The search text, its scope, the filter and the selected tags are remembered on this computer (`localStorage` key `libraryView`, with the sort order in `sort`); they never go into `index.json`.

---

## 7. Internationalisation

- `extension/i18n.js` holds `I18N.en`, `I18N.ja` and `I18N.zh` and `tr(key, {vars})`; `{name}` placeholders are replaced.
- Static texts in HTML use `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`. Texts built by scripts use `tr()`. **Never use a global named `t`** (many loops use `t` as a variable); the function is `tr`.
- **Elements whose text is set by a script must not carry `data-i18n`** — page translation can run after the script and overwrite its text (this really happened with the folder status).
- Pages call `await i18nReady` before building texts. The language setting is `chrome.storage.local.language` (`auto` | `en` | `ja` | `zh`, auto follows `navigator.language`), cached in `localStorage` so pages translate immediately. Changing the language in Settings reloads pages (library tabs reload through `storage.onChanged`).
- Adding a text: add the key to **all three** dictionaries (same `{placeholders}`), use it, run `dev-tests/test-i18n.js` (it checks key parity, placeholders, that every used key exists, that no key is unused, and that no stray `t(` exists).
- Not localised: the manifest `name`/`description` (would need `_locales`), and error text coming from the Python helper.

---

## 8. Testing

Everything runs from `dev-tests/run-all.sh` (needs `node`, `python3` and `google-chrome`; about 4 minutes; prints `passed: N failed: M`). At the time of writing: **about 1,400 checks, all passing** (the exact count is printed by the run; on Linux, and the suite also runs on a Mac).

| Suite | What it checks |
| --- | --- |
| `test-common.js` (node, sandboxed `vm`, fake folder) | index read/write/migration, damaged/newer index, schema 2 → 3 and an older Papurr (schema 2, simulated by loading `common.js` with the old constant) refusing a version-3 file, backup, restore/reset, 20 concurrent updates, conflict-copy merge, rebuild (batches, cancellation, confirmation, retry of empty titles; notes as files, note-only entries, arXiv-named notes picked up), file-name helpers, notes (parse/build round trip, unsure text stays the user's, headings, merge, `ensureNote`, `editNote`, `absorbDoiEntry` incl. merge with an existing note and a failed write). |
| `test-files.js` (node) | every file the pages, the manifest and the service worker refer to exists; KaTeX's fonts and licence; KaTeX loaded before `common.js` where formulas are shown. (The page tests load files from the repository directly, so a wrong path inside the extension would otherwise go unnoticed: Google Chrome 137+ ignores `--load-extension`, so the real extension cannot be loaded by a test.) |
| `test-i18n.js` | dictionaries (see §7). Keys chosen at run time are found as quoted strings. |
| Today / Settings / library (headless Chrome) | `ui-today-test.js` (list, abstract, days, In library, filter chips incl. cross-lists, Load more, the feed (ids, count, date, replacements left out, a held-back paper), empty feed with a day larger than one page (`bigday&nofeed`), cache, Refresh, errors, no categories, working indicator, Japanese), category buttons in `ui-options-test.js`, sorting by arXiv number without journal-only papers in `ui-lib-test.js`. |
| `test-profile.js` (node) | INSPIRE address and paging, errors (429), the prompt (markers, abstract cut, markup removed, update with previous profile and reactions), the checked answer, the checked file (tampered values), read/update, conflict-copy merge, what is new, the new profile after an answer. |
| `ui-profile-test.js` (headless Chrome; also `lang=ja`) | Settings → My research with a fake INSPIRE and a fake AI connection: nothing starts on page load, look-up, step 1 uses no quota (also with estimates off), Cancel, step 2 asks once, file written, Update with nothing new asks nothing, update reads only the new paper with the old profile, limit / unusable answer / cancel / failed save (+ Save again without quota), rebuild keeps reactions, another author. |
| `test-rank.js` (node) | Rank prompt (markers, levels, cut), answer checks, score cache (profile version, level, 14 days, clean-up), `papersToRank`, `orderByRelevance`, reactions in the file. |
| `ui-today-ai-test.js` (headless Chrome; also `lang=ja`, `off`, `noprofile`, `access`, `noest`) | Today with AI: nothing on page load, order choice, the button's estimate, limit / cancel / partial answer, hidden scores, cache reuse, only the latest announcement is offered (older papers from Load more are not), reactions; Why recommended (estimate on the button and in the tooltip, failure, cancel, one paper per request in the UI language, shown between abstract and buttons with the mark, hide/show free, kept and logged, written into an existing note only, empty answer). |
| `test-summary.js` (node) | prompt (markers, language, sections, relation only with a profile, no field words), checked answer, note block, kept text (3 days, 3 papers). |
| `test-translate.js` (node) | translation prompt (markers, language, formulas kept), checked answer, kept translations (14 days, per language), the `abstract` block in a note only if there is one. |
| `test-reason.js` (node) | "Why recommended": prompt (markers, language, abstract cut, no field words in the fixed text), checked answer, cache (14 days), writing into a note only if there is one. |
| `test-ai-rules.js` (node) | The AI rules on the source: `aiRun` only from listed places (`note.js` redoReason, `profile-ui.js` profRun, `today.js` rankClick and reasonClick, each only from its button's click), no timers/alarms/retries, no `--bare`, flags fixed in the helper, status only from the Check button, service worker and content script know nothing about AI. |
| `ui-ai-test.js` (headless Chrome; also `os=win`, `lang=ja`) | Settings → AI: the quota guide before the first checkbox, Windows note, agreement and switch, nothing starts on page load, Check with every answer (missing, not signed in, API key, ready, no model list, no helper), Copy, estimate switch, `aiRun` rules (no click, off, not agreed, old agreement, one at a time, cancel, usage log, clear). |
| `test-native.py` AI block | fake `claude`: status, model catalog, API-key refusal, safety flags, stdin, removed API variables, temporary directory, quota-limit and login errors, refusals, time limit, lock, cancel. |
| `test-import.js` (node) | `scanPdf`/`identify` on synthetic PDFs (stamp, old-style stamp, XMP/Info/ObjStm DOI, link DOIs, text DOIs, titles incl. UTF-16, damaged files), `planImport` (statuses, taken names, duplicates, title search, cancel), `applyImport` (move and copy paths, declined files untouched, no overwrite, no half-written file, cancel). |
| `test-background.js` | service worker with a fake `chrome`: messages, toolbar icon, publisher-site migration, content-script registration, menu/badge. |
| `test-native.py` | helper protocol, path-traversal refusal, folder search, `reveal` (refusals; Finder / file-manager commands), **macOS behavior simulated**, installer for macOS and Linux. |
| Library / settings / open pages (headless Chrome) | `build-pages.py` builds each test page **from the real HTML file**, adds a fake browser (`ui-harness.js`: in-memory folder, fake `chrome.*`) and a test script. Includes the import page (`ui-import-test.js`, English and Japanese: banner, review list, decline one, Yes to all, Show in folder, missing helper; the PDFs are built in the page, one compressed with the browser's own `CompressionStream`). Covers tags (add, rapid add, rename/merge, delete), versions, journal chips, search, sort, 100-item paging, repair UI, all open scenarios (new/saved/versions/offline/journal/merge/damaged/external app and its failure), site management, Japanese and Chinese UI. |
| `ui-note-test.js` (headless Chrome; `id=` a saved paper (also `lang=ja`), a note-only paper, a journal-only paper, a paper not in the library) | note created on first open (head, heading in the UI language, index flag, library tabs told), starts editing when new, unsaved-changes warning, no autosave, Ctrl+S / Cmd+S, safe Markdown (no HTML elements, only http(s) links, formulas as text), a summary added elsewhere shown on focus, change only in Papurr's block → saved without asking, conflict in the user's section → Save my version / Load that version, Cancel asks, delete a Papurr section, helper `edit`, file deleted while open. Library notes checks are in `ui-lib-test.js` (icon + tooltip, Add note, note-only paper, scopes, filters, note sort, live reload, delete keeps the note); the open-page merge scenario K also moves a note. |
| Summary on the note page (`ui-note-test.js`, `id=2301.00011&ai&summarize=1` (also `lang=ja`, `pdfonly`, `long`), `id=2301.00012&ai&summarize=1`) | arXiv's HTML version of the newest saved version fetched (formulas, captions, no bibliography or menus checked in the request) and estimate shown before anything is sent, Run button with the estimate, seconds and Cancel, Try again without download or AI, request with the assembled text / language / schema, block with version and language, logged as `summary`, Redo reuses the kept text, no-HTML-version error, long-paper question, a paper not in the library becomes note-only only when the summary is made. |
| Link clicks (headless Chrome) | `content.js` against many URLs, modified clicks (Ctrl, Shift, Alt, Cmd: snatched), the switch, dead-script cases. |
| `ui-lib-odd-test.js` (headless Chrome) | the library with an index full of odd values (wrong types, a 400-character word as title, 300 authors, 40 tags, HTML in titles, untitled DOI/ADS papers): every paper shown, no script error, markup shown as text, all search scopes / sort orders / filters; then every theme at 1000px and 520px: no sideways scrolling, nothing outside a card, contrast (main text 4.5:1, secondary 3:1). |
| `ui-help-test.js` (headless Chrome; also `lang=ja`) | the Help page: every section, the contents list, the interface language, no raw markers or keys, only safe elements, the header's current-page mark, the cloud-sync note. |
| `ui-layout-test.js` (headless Chrome; Today with AI, the note page with AI sections and of a journal paper, Settings with AI and in Japanese) | every theme at 1000px and 520px: no sideways scrolling, nothing sticking out to the right, every visible text at least 3:1 contrast (faded/disabled elements excepted), no script error. Transitions are switched off while measuring (buttons fade their colours for 0.12 s; measured mid-fade they looked unreadable). |

How to work with it:
- To add a UI test, add checks to the relevant `ui-*-test.js`; to add an open scenario, add a case in `ui-open-setup.js` (state + stubbed network), `ui-open-test.js` (checks) and the list in `run-all.sh`.
- Run long suites in the background and poll the output file; the whole run exceeds typical tool timeouts.
- **Headless-Chrome quirks** (learned the hard way):
  - the real `navigator.locks` does not fit the virtual clock, so the harness replaces it with an in-page lock;
  - `open.js` ends with `location.replace(blobUrl)`; the harness overrides `showInChrome` (and delays `loadDir`) so the page stays alive;
  - a test must not trigger a page reload (the language selector reloads the page → endless loop);
  - use a fresh `--user-data-dir` per run (localStorage persists between runs otherwise);
  - confirm/prompt are stubbed per test.
  - a page whose test script never finishes (output still "running", e.g. a syntax error in the test) counts as a failure (`run_page`).
  - the fake `navigator.locks` (harness and node tests) keeps **one queue per lock name**: with a single shared queue, taking the notes lock inside the index lock waited for itself forever;
  - headless Chrome runs with a **light** system colour scheme; to see the page as on a computer in dark mode, add `--force-dark-mode --blink-settings=preferredColorScheme=0`;
  - `BroadcastChannel` messages travel through the browser process and arrived only sometimes under the virtual clock, so the harness replaces it with an in-page channel;
  - a page's top-level `let`/`const` shadows a harness global of the same name for every script of the page (`let entry` in `note.js` hid the harness's `entry()` helper): use distinctive names in pages.
  - **On a Mac:** headless Chrome prints the page but then does not exit, and there is no `google-chrome` or `timeout` command. `run-all.sh` handles this itself (uses the app in `/Applications`, waits for `</html>`, then stops that Chrome). `test-native.py` must never write the real launcher (it uses a temporary one).
- **Screenshots for visual work**: `python3 dev-tests/build-pages.py demo out.html` builds the library with sample papers; open it with `?lang=ja&theme=dark` in headless Chrome (`--screenshot`) and look at the PNG. Use this when changing layout or colors.
- When bulk-editing files with scripts, **assert that each replacement matched** — a silent no-op once left a bug in place (journal-only papers shown as `arXiv:doi:…`).

What the automatic tests **cannot** verify (ask the maintainer, who has the real environment): real publisher sites (login, bot blocking, redirects), the Mac helper on a real Mac, real cloud-sync services, behavior inside a real installed extension (permission prompts, toolbar), and Chrome's own permission re-prompt after restarts.

---

## 9. Architecture decisions and the AI rules

- **File System Access API instead of `chrome.downloads`.** Considered first (saving into a subfolder of Downloads and searching the download history); rejected because users clean Downloads and Chrome cannot save outside it.
- **No server, no database; index in the folder.** Makes cloud sharing and backup trivial.
- **Opening in an external app needs a native helper** — Chrome extensions cannot start programs. The helper finds the real folder by searching for the marker file `.paper-folder-id` (so the user never types a path) and caches it. It only opens PDFs whose names contain no path separators and that sit directly in the found folder.
- **Internal names are kept on purpose** (changing them would orphan existing data/registrations): marker file `.paper-folder-id`, native host name `com.paper_folder_manager.opener`, cache dir `paper-folder-manager`, lock name `paper-folder-index`, IndexedDB name `papers`. They predate the rename to Papurr.
- **Unpacked-extension ID** is derived from the folder path; `native/install.py` computes it and also reads the real ID from the browser profiles; with several IDs allowed. A Web-Store version will have a fixed ID.
- **Journal downloads use the user's own browser session** (`fetch(..., {credentials: "include"})` from the extension page, with host permission). Access rights are the user's concern, not the extension's.
- **AI integration (built:) — the maintainer's top-level rules.** Papurr has no AI of its own and no API keys; it may only hand work to the AI command the user already has (Claude Code `claude`, later Codex `codex` and Kimi Code `kimi`) under the user's own subscription, through the native helper (Mac/Linux only; Windows shows a note that the feature is unavailable). Three rules outrank every other consideration:
  1. **Never spend the user's quota in a way the user cannot see.** An AI call may start only from an explicit click on a button that says it uses subscription quota and shows an estimate (items, rough tokens). No timers, no start-up or background work (service worker included), no prefetching, no auto-run (rejected by the maintainer). One single function is the only call site of the helper's `ai` action; tests assert that opening every page makes zero AI calls. First-use consent lists exactly what is sent to which command; changing what is sent (e.g. enabling full text) asks again. Every run is logged (kind, items, tokens, time, model) and shown in Settings.
  2. **Never waste quota.** Results are cached and reused (same input + settings = no new call); the profile is built once and updated incrementally; no automatic retries (a failure shows the reason and a Retry button); one run at a time; time limit and kill on cancel; candidate limit; the estimate is shown before the click.
  3. **Never touch the user's normal environment.** Run `claude` with `--safe-mode` (ignores CLAUDE.md, hooks, MCP, skills, plugins, memory; login still works), `--no-session-persistence`, `--tools ""`, `--strict-mcp-config`, `--disable-slash-commands`, in an empty temporary directory that is removed afterwards. **Not `--bare`**: it never reads the OAuth/keychain login, so the subscription could not be used. Papurr never installs, logs in, or edits any user configuration; it only shows install/login commands to copy. **Verified on 2026-10-08** (one real call, maintainer's OK; `claude -p "Reply with the single word OK." --safe-mode --no-session-persistence --tools "" --strict-mcp-config --disable-slash-commands --output-format json --effort low` in an empty temp directory): answer "OK", 6-8 s, about 2,050 input tokens even for a trivial prompt (the CLI's own system prompt: a fixed cost per call) and 4 output tokens; no session transcript, no project entry, no files left in the temp directory, no process left; `--output-format json` returns `usage`, `total_cost_usd`, `duration_ms`. What changed on disk: only the CLI's own housekeeping — `~/.claude.json` was rewritten (feature-flag caches `cachedGrowthBook*`, `clientDataCacheSlots`, a timestamp) with a rotated backup in `~/.claude/backups/`, and `~/.claude/cache/model-catalog/*.json` was refreshed; no setting, permission, history, memory or project entry changed. This cache refresh happens whenever `claude` starts (also when the user runs it) and cannot be switched off without losing the login; it is reported to the maintainer as the one unavoidable trace. `claude auth status` (no quota) reports `loggedIn` and `authMethod`. The CLI's cache `~/.claude/cache/model-catalog/*.json` holds the current model list (ids, names, effort vocabulary `low…max`); it is an internal, undocumented file.
  - Decided spec so far: Papurr fetches INSPIRE/arXiv data itself and puts it into a fixed (user-uneditable) prompt; the AI gets no tools. Settings: INSPIRE author URL; for "my papers" and "papers to rank" separately a level of detail (title only / abstract = recommended / full text, with notes: titles are less accurate, full text is most accurate but slow and uses much more quota); period; excluded and added keywords; candidate range; model and effort (read from the CLI at run time, not hard-coded: effort levels come from `claude --help`, models only as aliases + free text); consent checkbox; `claude auth status` (no quota) detects missing login; OS-specific install commands to copy. Run points: Settings (create / update profile) and the Today page ("Rank with AI"); feedback "interested / not interested" is adopted.
  - **Decided (maintainer, 2026-10-08; superseded in part: reasons on request since, levels of relevance shown as dots since):** the AI returns **scores only** (no reason text, so no output-language setting); the scores are **never shown** — the user only sees the Today list sorted by relevance. The user is assumed to be one person using several of their own computers: the **profile and the interested / not interested feedback live in a separate file in the papers folder** (planned as `papurr-profile-<INSPIRE id>.json`, built as one `papurr-profile.json` per folder, see below; not in `index.json`; synced, so every computer shares it; newer profile wins, feedback is merged per paper id; read defensively because a synced file is untrusted input), while **per-paper scores and the usage log stay in the browser** (scores expire after ~14 days). The CLI's own housekeeping writes (feature-flag cache in `~/.claude.json`, model catalog) are accepted as the one unavoidable trace. Creating a profile costs about 15k tokens and one ranking run (40 candidates) about 13k, plus ~2k fixed per call; show such estimates before each click. Scores come back through `--json-schema` as `[{id, score}]`.
  - **Also decided:** the **full-text level is dropped for good** (an inattentive click could burn a large amount of quota): only *title* and *abstract* levels exist, for "my papers" and for "papers to rank" separately, with notes (titles alone are less accurate; abstract is recommended). The **token estimate display is a setting (default on)**; the button click is the consent, the button label says it uses quota. Scores are kept per paper; feedback is adopted. **Superseded 2026-10-08 (maintainer):** the rank button covers **all new papers of the latest announcement** of the followed categories (no "papers to rank at a time" setting any more; older papers from Load more are never ranked); more than 300 (`RANK_MAX_PER_RUN`, context safety) are ranked in parts, one click each. Legal questions (provider terms for running the official CLI, publisher terms, privacy policy, trademarks) are to be considered later, but anything risky is to be designed out during implementation; an `ANTHROPIC_API_KEY` in the environment is always removed from the child process and a run is refused unless `claude auth status` reports the subscription login (`authMethod: claude.ai`), so API billing can never happen by accident.
  - **Stage 2 (profile) as built:** one file `papurr-profile.json` per folder (single user assumed, so no author id in the name), per-computer form settings in `chrome.storage.local.profileSettings`. Step 1 *prepare* reads INSPIRE and shows the estimate; step 2 *run* is a separate click on a button that says it uses quota. If there is nothing new (no new papers, no pending reactions) step 2 does not appear and nothing is sent. Update reads only papers not in `covered` plus reactions not in `feedbackUsed`; "from scratch" forgets `covered` but keeps the reactions; another INSPIRE author forces a rebuild. A failed or unusable answer saves nothing; if only the folder write fails the answer is kept in memory and can be saved again without quota. Reactions carry the paper title (`t`) so that updates can name them. The answer schema's root is an **object** (`{summary, keywords}`; later `{scores: [...]}`): measured with the real command, `--json-schema` returns the parsed answer in `structured_output` (and the same text in `result`); a 2-paper scoring request used about 2,650 tokens (2,560 of them fixed).
  - Install commands to offer for copying (checked against the official setup page, 2026-10-08): macOS/Linux `curl -fsSL https://claude.ai/install.sh | bash`; macOS Homebrew `brew install --cask claude-code`; npm `npm install -g @anthropic-ai/claude-code` (Node 22+); log in by running `claude` and following the browser prompts; Claude Code needs a Pro, Max, Team or Enterprise plan (the free plan does not include it). Codex (`codex`) and Kimi Code (`kimi`) are supported as well; their install and sign-in help is in `AI_COMMANDS` (`ai.js`).

## 10. Adding things — recipes

- **A new default publisher/journal site:** add the host to `PUBLISHER_SITES` (common.js), add `https://<host>/*` to `host_permissions` in the manifest, extend the content-script test (`dev-tests/content-test.template.html`) if the PDF-link shape is new, mention it in the README. Existing users who customised their site list receive only *new* publisher sites through `addPublisherSites` (`publisherSitesSeen`); `FIRST_PUBLISHER_SITES` is the original five and must not change. If the PDF is served from another host (CDN), add that host to `host_permissions` too (Elsevier does: `*.sciencedirectassets.com`).
- **A new setting:** store it in `chrome.storage.local`, read it with a small getter in `common.js`, add UI + i18n keys, add a settings-page test.
- **A new index field:** optional field + default handling in the UI; if it changes the meaning of existing data, bump `SCHEMA_VERSION`. Remember it is shared between computers.
- **A new language:** add a dictionary object, extend `resolveLanguage`, the language `<select>` in `options.html`, and `test-i18n.js` parity checks.
- **Windows helper (built 2026-10-09, simulated only):** registry registration, `.bat` launcher, binary stdio (`msvcrt.setmode`), default app with `os.startfile`, a named app found on PATH or in `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%LOCALAPPDATA%` (and `\Programs`), Show in folder with `explorer /select,"…"`, the default PDF app's name from `AssocQueryStringW` (shlwapi), programs started detached (`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`), marker search also in `OneDrive - *`, `iCloudDrive`, Google Drive's `X:\My Drive`, skipping `AppData`; cache in `%LOCALAPPDATA%\paper-folder-manager`. `test-native.py` simulates all of it on a Mac/Linux (fake registry, fake association query). **Not yet run on a real Windows computer**: check registration, the unpacked extension ID (computed from the UTF-16 path; the real ID is also read from the profiles' Preferences, so load the extension before registering), a Japanese user name in the path, and Store-Python.

---
