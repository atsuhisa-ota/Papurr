# Papurr

*日本語版は [README.ja.md](README.ja.md) をご覧ください。*

A Chrome extension that keeps your papers in **one folder you choose** and manages them with an **index it builds**.
Click a PDF link in the web databases you already use: if you have the paper, your own copy opens; if not, it is saved
into the folder first and then opened. The extension itself also works offline.

## The idea

You download the same paper again. And again.\
Filing is a chore, so it sits on your desktop or in Downloads.\
Then you clean up and delete it.\
And download the same paper once more.\
You sort papers into a folder per project, so the same paper gets copied all over the place.\
Your notes are in this copy, but not in that one.

You try a reference manager, but it does so much that you never learn half of it.\
Something quietly disappears somewhere in a sync.\
Every now and then, it freezes.\
In the end, INSPIRE or ADS is simply better for finding papers,\
so you download a paper that is already in your reference manager, again.

Papurr ends the cycle.
One copy of each paper, in one folder. Click a PDF link: if you have the paper, your copy opens; if not, it is saved
first and then opened. Projects become tags, not copies.


## Features

- **arXiv and journal versions side by side** (also papers that exist only as journal articles, and old NASA ADS scans)
- **Library page**: search, sorting, filters, tags, links to arXiv / INSPIRE / NASA ADS
- **A note for each paper** (a Markdown file in the folder; formulas are shown typeset)
- **Bring in the PDFs you already have**: Papurr reads them, and renames and adds only those you approve
- **Today's arXiv**: the latest papers of the categories you follow, with abstracts
- **INSPIRE search**: search INSPIRE's database through its API; save a result with one click
- **AI features (optional)**: with your own Claude, ChatGPT or Kimi Code plan, rank Today's arXiv by relevance to your
  research, explain why a paper is recommended, translate and summarize
- **Works with cloud-synced folders**; English, Japanese and Simplified Chinese interface; colour themes

## Install

For now, Papurr is not on the Chrome Web Store: it is loaded as an "unpacked extension". There are two ways.

### A. Let an AI assistant do it (recommended)

If you use an AI command-line assistant such as Claude Code (`claude`), the Codex CLI (`codex`) or the Kimi Code CLI (`kimi`):

1. In the directory where Papurr should live, get the repository: `git clone https://github.com/atsuhisa-ota/papurr.git`
2. Open Papurr in your AI assistant and simply ask: "**Please install Papurr following docs/INSTALL-AGENT.md.**"
3. These steps are yours to do, though:
   - load the folder the assistant names as an extension in `chrome://extensions`,
   - restart Chrome, if the helper was registered,
   - choose your papers folder in Papurr's Settings,
   - for the AI features: sign in to your AI plan and accept the notice in Settings.
4. Click Papurr's toolbar icon: the library opens.

The assistant never installs anything without asking, never signs in or handles passwords, and never changes the
repository's files. To update later, ask in a chat opened in the same folder: "Please update Papurr."

### B. Install by hand

1. Get the repository (as in A, step 1).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder of this repository.
4. Click Papurr's toolbar icon: the library opens. Open **Settings** (top right) and **choose your papers folder**.
5. For an external PDF app, "Show in folder" or the AI features, register the helper once on each computer (Python 3
   is needed), then restart Chrome:
   - Mac: double-click `native/Install helper (Mac).command`
   - Windows: double-click `native\Install helper (Windows).bat`
   - Linux: run `python3 native/install.py` in this folder (use Chrome from Google's .deb / .rpm package; a snap or
     Flatpak Chrome cannot start the helper)
6. To update: `git pull`, then press Papurr's update button on `chrome://extensions` and reload any open tabs. To hear about new versions, use **Watch → Custom → Releases** on the GitHub page. Settings and Help show the installed version.

## Notes
- **If your papers folder is synced by a cloud service, check yourself that syncing has finished.** Papurr does not check
  the sync state. If you press "Update index" while files are still syncing, entries of files not synced yet may be removed.
- If Chrome asks for permission to use the folder after a restart, choose **Allow on every visit** to avoid being asked again.
- Journal PDFs are fetched with your own browser session, so you need access to them (e.g. through your institution).
  If a PDF cannot be fetched, open it the normal way, save it into your papers folder, and use Settings →
  "Identify and rename...".

## How to use

Open **Help** in the top right corner of the screen. The **?** next to each section of Settings opens the matching
part of Help.

## Your data

Papurr contacts only arXiv, INSPIRE, OpenAlex, Crossref, NASA ADS (to look up papers) and the publisher site of the
PDF you clicked. PDF files are never uploaded, and nothing is sent to the author. Only with the AI features is
information about papers sent to the AI provider, through your own AI command (details in Help and in the notice in
Settings).

## Repository layout

| Folder | Contents |
| --- | --- |
| `extension/` | The extension itself (this is what you load in Chrome). |
| `native/` | The optional helper for the external PDF app and the AI commands. |
| `dev-tests/` | Automatic checks. Run `dev-tests/run-all.sh` (needs `node`, `python3` and Google Chrome). |
| `docs/`, `CLAUDE.md`, `AGENTS.md` | Development guide for contributors and AI assistants: concept, architecture, data format, rules. `docs/DATA-SOURCES.md` lists what Papurr contacts and why. |

## Status and limits

- Developed and tested with Google Chrome on macOS and Linux. The Windows helper has not yet been tried on a real
  Windows computer. Not yet on the Chrome Web Store.
- The official source is <https://github.com/atsuhisa-ota/papurr>. If the author ever publishes Papurr on the Chrome Web
  Store, the link will be here; any other extension called Papurr is not from the author.

## License

[MIT](LICENSE) © 2026 Atsuhisa Ota. Includes [KaTeX](https://katex.org) (MIT, © Khan Academy and other contributors; `extension/vendor/katex/LICENSE`).

The MIT licence covers the code. The name “Papurr” and the icon (`extension/icons/`, `mark.svg`) are not licensed as the
name or logo of another project: please give a copy or a fork its own name and icon.

## About this project

Designed by Atsuhisa Ota. Implemented by AI (Claude, by Anthropic, via Claude Code), under the author's direction and testing.
