#!/bin/bash
# Runs every automatic check of the extension (no Chrome extension install needed; needs node and google-chrome).
# Usage: dev-tests/run-all.sh        (prints FAIL lines and a summary; exit code 1 if anything failed)
cd "$(dirname "$0")" || exit 1
TESTS="$PWD"; EXT="$(cd ../extension && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/all.txt"; : > "$OUT"

build() { python3 build-pages.py "$1" "$2"; }
# Chrome: "google-chrome" on Linux; on a Mac the application inside /Applications is used.
CHROME="${CHROME:-google-chrome}"
MAC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if ! command -v "$CHROME" >/dev/null 2>&1 && [ -x "$MAC_CHROME" ]; then CHROME="$MAC_CHROME"; fi
run_page() { # page query virtual-time-budget
  rm -rf "$WORK/prof"
  # Headless Chrome on a Mac prints the page but then does not exit: wait for the end of the page, then stop it.
  "$CHROME" --headless=new --disable-gpu --user-data-dir="$WORK/prof" --virtual-time-budget="${3:-60000}" --window-size=1000,800 \
    --dump-dom "file://$1${2:+?$2}" > "$WORK/dom.html" 2>/dev/null &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null && ! grep -q '</html>' "$WORK/dom.html" 2>/dev/null && [ "$waited" -lt 600 ]; do sleep 0.5; waited=$((waited + 1)); done
  pkill -f -- "--user-data-dir=$WORK/prof" 2>/dev/null; wait "$pid" 2>/dev/null
  python3 -c "
import sys,re,html
d=open(sys.argv[1]).read(); m=re.search(r'<pre id=\"test-out\"[^>]*>(.*?)</pre>',d,re.S)
out=html.unescape(m.group(1)) if m else ''
print(out if m and out.strip() != 'running' else 'FAIL page did not finish (navigated away, crashed, or the test script has an error)')" "$WORK/dom.html"
}
section() { echo "== $1" | tee -a "$OUT"; }

section "index, backup, sync merge, rebuild (node)";  node test-common.js     | tee -a "$OUT"
section "helper program and installer (python, macOS simulated)"; python3 test-native.py | tee -a "$OUT"
section "importing PDFs (node)";                  node test-import.js     | tee -a "$OUT"
section "research profile (node)";                node test-profile.js    | tee -a "$OUT"
section "Today's arXiv and the clock (node)";   node test-today-clock.js | tee -a "$OUT"
section "searching INSPIRE (node)";                 node test-inspire.js    | tee -a "$OUT"
section "ranking (node)";                          node test-rank.js       | tee -a "$OUT"
section "full-text summary (node)";               node test-summary.js    | tee -a "$OUT"
section "translation (node)";                      node test-translate.js  | tee -a "$OUT"
section "why recommended (node)";                  node test-reason.js     | tee -a "$OUT"
section "AI rules (node)";                            node test-ai-rules.js   | tee -a "$OUT"
section "files the extension refers to (node)";   node test-files.js      | tee -a "$OUT"
section "dictionaries (node)";                        node test-i18n.js       | tee -a "$OUT"
section "background service worker (node)";           node test-background.js | tee -a "$OUT"

build library "$WORK/ui-lib.html";         section "library page";  run_page "$WORK/ui-lib.html" "" 90000 | tee -a "$OUT"
build inspire "$WORK/ui-inspire.html";     section "INSPIRE page";  run_page "$WORK/ui-inspire.html" "" 60000 | tee -a "$OUT"
build layout-inspire "$WORK/ui-lay-inspire.html"; section "layout: INSPIRE page with results (themes, widths, buttons)"; run_page "$WORK/ui-lay-inspire.html" "results&lang=ja" 40000 | tee -a "$OUT"
build options-import "$WORK/ui-import.html"; section "importing PDFs added by hand (Settings)"; run_page "$WORK/ui-import.html" "" 60000 | tee -a "$OUT"
build options-import "$WORK/ui-import-ja.html"; section "importing PDFs added by hand, Japanese"; run_page "$WORK/ui-import-ja.html" "lang=ja" 60000 | tee -a "$OUT"
build today "$WORK/ui-today.html"; section "Today's arXiv";  run_page "$WORK/ui-today.html" "" 60000 | tee -a "$OUT"
section "Today's arXiv, no categories"; run_page "$WORK/ui-today.html" "nocats" 20000 | tee -a "$OUT"
section "Today's arXiv, earlier announcements"; run_page "$WORK/ui-today.html" "history" 20000 | tee -a "$OUT"
section "Today's arXiv, earlier announcements, Japanese"; run_page "$WORK/ui-today.html" "history&lang=ja" 20000 | tee -a "$OUT"
section "Today's arXiv, a feed without details"; run_page "$WORK/ui-today.html" "bare" 20000 | tee -a "$OUT"
section "Today's arXiv, arXiv asks to slow down"; run_page "$WORK/ui-today.html" "busy" 20000 | tee -a "$OUT"
section "Today's arXiv, arXiv fails";   run_page "$WORK/ui-today.html" "fail" 20000 | tee -a "$OUT"
section "Today's arXiv, empty feed and a day larger than one page"; run_page "$WORK/ui-today.html" "bigday&nofeed" 20000 | tee -a "$OUT"
section "Today's arXiv, a kept list is used"; run_page "$WORK/ui-today.html" "cached" 20000 | tee -a "$OUT"
section "Today's arXiv, the storage is full"; run_page "$WORK/ui-today.html" "quota" 20000 | tee -a "$OUT"
section "Today's arXiv, answers that are a web page instead of XML"; run_page "$WORK/ui-today.html" "garbage" 60000 | tee -a "$OUT"
section "Today's arXiv, answers with an empty body"; run_page "$WORK/ui-today.html" "emptybody" 60000 | tee -a "$OUT"
section "Today's arXiv, 400 announced papers"; run_page "$WORK/ui-today.html" "huge" 30000 | tee -a "$OUT"
section "Today's arXiv, working indicator"; run_page "$WORK/ui-today.html" "slow" 20000 | tee -a "$OUT"
section "Today's arXiv, Japanese";      run_page "$WORK/ui-today.html" "lang=ja" 60000 | tee -a "$OUT"
build options-ai "$WORK/ui-ai.html"; section "Settings: AI";  run_page "$WORK/ui-ai.html" "" 60000 | tee -a "$OUT"
section "Settings: AI, Windows"; run_page "$WORK/ui-ai.html" "os=win" 20000 | tee -a "$OUT"
section "Settings: AI, Japanese"; run_page "$WORK/ui-ai.html" "lang=ja" 60000 | tee -a "$OUT"
build options-profile "$WORK/ui-profile.html"; section "Settings: My research (profile)"; run_page "$WORK/ui-profile.html" "" 90000 | tee -a "$OUT"
section "Settings: My research, Japanese"; run_page "$WORK/ui-profile.html" "lang=ja" 90000 | tee -a "$OUT"
build today-ai "$WORK/ui-today-ai.html"; section "Today's arXiv by relevance (AI)"; run_page "$WORK/ui-today-ai.html" "" 60000 | tee -a "$OUT"
section "Today's arXiv by relevance, Japanese"; run_page "$WORK/ui-today-ai.html" "lang=ja" 60000 | tee -a "$OUT"
section "Today's arXiv, AI off";            run_page "$WORK/ui-today-ai.html" "off" 20000 | tee -a "$OUT"
section "Today's arXiv, no profile yet";    run_page "$WORK/ui-today-ai.html" "noprofile" 20000 | tee -a "$OUT"
section "Today's arXiv, re-rank with the current model"; run_page "$WORK/ui-today-ai.html" "rerank" 60000 | tee -a "$OUT"
section "Today's arXiv, re-rank with the current model, Japanese"; run_page "$WORK/ui-today-ai.html" "rerank&lang=ja" 60000 | tee -a "$OUT"
section "Today's arXiv, folder access later"; run_page "$WORK/ui-today-ai.html" "access" 20000 | tee -a "$OUT"
section "Today's arXiv, estimates off";     run_page "$WORK/ui-today-ai.html" "noest" 20000 | tee -a "$OUT"
build note "$WORK/ui-note.html"; section "note page"; run_page "$WORK/ui-note.html" "id=2301.00001" 40000 | tee -a "$OUT"
section "note page, Japanese"; run_page "$WORK/ui-note.html" "id=2301.00001&lang=ja" 40000 | tee -a "$OUT"
section "note page, a paper with only a note"; run_page "$WORK/ui-note.html" "id=2301.00007" 20000 | tee -a "$OUT"
section "note page, a journal-only paper"; run_page "$WORK/ui-note.html" "id=doi:10.1/zz" 20000 | tee -a "$OUT"
section "note page, redo the reason (AI)"; run_page "$WORK/ui-note.html" "id=2301.00009&ai" 20000 | tee -a "$OUT"
section "note page, redo the reason, Japanese"; run_page "$WORK/ui-note.html" "id=2301.00009&ai&lang=ja" 20000 | tee -a "$OUT"
section "note page, a kept reason goes into a new note"; run_page "$WORK/ui-note.html" "id=2301.00001&ai" 20000 | tee -a "$OUT"
section "note page, full-text summary"; run_page "$WORK/ui-note.html" "id=2301.00011&ai&summarize=1" 30000 | tee -a "$OUT"
section "note page, full-text summary at the technical level, with the user's own instructions"; run_page "$WORK/ui-note.html" "id=2301.00011&ai&summarize=1&level=technical" 30000 | tee -a "$OUT"
section "note page, full-text summary, Japanese"; run_page "$WORK/ui-note.html" "id=2301.00011&ai&summarize=1&lang=ja" 30000 | tee -a "$OUT"
section "note page, summary of a paper without an HTML version"; run_page "$WORK/ui-note.html" "id=2301.00011&ai&summarize=1&nohtml" 20000 | tee -a "$OUT"
section "note page, summary of a long paper"; run_page "$WORK/ui-note.html" "id=2301.00011&ai&summarize=1&long" 20000 | tee -a "$OUT"
section "note page, summary of a paper not in the library"; run_page "$WORK/ui-note.html" "id=2301.00012&ai&summarize=1" 20000 | tee -a "$OUT"
section "note page, a paper not in the library"; run_page "$WORK/ui-note.html" "id=9999.99999" 20000 | tee -a "$OUT"
build options "$WORK/ui-options.html"; section "settings page"; run_page "$WORK/ui-options.html" "" 40000 | tee -a "$OUT"
build library-ja "$WORK/ui-lib-ja.html"; section "library page, Japanese"; run_page "$WORK/ui-lib-ja.html" "lang=ja" 40000 | tee -a "$OUT"
build library-odd "$WORK/ui-lib-odd.html"; section "library page, odd index values and layout (themes, widths, contrast)"; run_page "$WORK/ui-lib-odd.html" "" 60000 | tee -a "$OUT"
build layout-today "$WORK/ui-lay-today.html"; section "layout: Today's arXiv (themes, widths, contrast)"; run_page "$WORK/ui-lay-today.html" "ai&lang=ja" 40000 | tee -a "$OUT"
build layout-today-ai "$WORK/ui-lay-today-ai.html"; section "layout: Today's arXiv by relevance, with the rank button (themes, widths, buttons)"; run_page "$WORK/ui-lay-today-ai.html" "relevance&lang=ja" 40000 | tee -a "$OUT"
section "layout: Today's arXiv by relevance, English"; run_page "$WORK/ui-lay-today-ai.html" "relevance" 40000 | tee -a "$OUT"
section "layout: Today's arXiv by relevance, Chinese"; run_page "$WORK/ui-lay-today-ai.html" "relevance&lang=zh" 40000 | tee -a "$OUT"
section "layout: Today's arXiv by relevance, estimates off"; run_page "$WORK/ui-lay-today-ai.html" "relevance&noest&lang=zh" 40000 | tee -a "$OUT"
build layout-note "$WORK/ui-lay-note.html"; section "layout: note page with AI sections (themes, widths, contrast)"; run_page "$WORK/ui-lay-note.html" "id=2301.00009&ai&lang=ja" 40000 | tee -a "$OUT"
section "layout: note page of a journal paper"; run_page "$WORK/ui-lay-note.html" "id=doi:10.1%2Fzz" 40000 | tee -a "$OUT"
build help "$WORK/ui-help.html"; section "Help page"; run_page "$WORK/ui-help.html" "" 30000 | tee -a "$OUT"
section "Help page, Japanese"; run_page "$WORK/ui-help.html" "lang=ja" 30000 | tee -a "$OUT"
build layout-help "$WORK/ui-lay-help.html"; section "layout: Help (themes, widths, contrast)"; run_page "$WORK/ui-lay-help.html" "lang=ja" 40000 | tee -a "$OUT"
build layout-options "$WORK/ui-lay-opt.html"; section "layout: Settings with AI (themes, widths, contrast)"; run_page "$WORK/ui-lay-opt.html" "ai" 40000 | tee -a "$OUT"
section "layout: Settings, Japanese"; run_page "$WORK/ui-lay-opt.html" "lang=ja" 40000 | tee -a "$OUT"
build options-ja "$WORK/ui-options-ja.html"; section "settings page, Japanese"; run_page "$WORK/ui-options-ja.html" "lang=ja" 40000 | tee -a "$OUT"
build options-zh "$WORK/ui-options-zh.html"; section "settings page, Chinese"; run_page "$WORK/ui-options-zh.html" "lang=zh" 40000 | tee -a "$OUT"
section "layout: Today's arXiv, Chinese"; run_page "$WORK/ui-lay-today.html" "ai&lang=zh" 40000 | tee -a "$OUT"
section "layout: note page with AI sections, Chinese"; run_page "$WORK/ui-lay-note.html" "id=2301.00009&ai&lang=zh" 40000 | tee -a "$OUT"
section "layout: Help, Chinese"; run_page "$WORK/ui-lay-help.html" "lang=zh" 40000 | tee -a "$OUT"
section "layout: Settings, Chinese"; run_page "$WORK/ui-lay-opt.html" "lang=zh" 40000 | tee -a "$OUT"
sed "s#@EXT@#$EXT#g" content-test.template.html > "$WORK/content-test.html"; section "link clicks (content script)"; run_page "$WORK/content-test.html" "" 10000 | tee -a "$OUT"

build open "$WORK/ui-open.html"; section "opening papers"
for case in "A_new_arxiv|id=2301.12345" "B_saved_latest|id=2301.12345" "C_v1_saved_latest_v2|id=2301.12345" "D_explicit_v1|id=2301.12345&v=v1" \
  "E_local|id=2301.12345&local=1" "E2_local_journal_only|id=doi:10.1/x&local=1" "F_journal_chip|id=2301.12345&journal=1" \
  "G_journal_new_with_arxiv|doi=10.1103/physrevd.108.045001&pdf=https://publisher.example/x.pdf" \
  "H_journal_only|doi=10.1103/physrevd.108.045001&pdf=https://publisher.example/x.pdf" \
  "I_journal_saved|doi=10.1103/PhysRevD.108.045001&pdf=https://publisher.example/x.pdf" \
  "J_journal_html|doi=10.1/zzz&pdf=https://publisher.example/x.pdf" "K_merge_doi_entry|id=2301.12345" "L_damaged|id=2301.12345" \
  "M_external|id=2301.12345" "N_external_fails|id=2301.12345" "O_sanitize|id=hep-th/9901001" \
  "A_new_arxiv_ja|id=2301.12345&lang=ja" "J_journal_html_ja|doi=10.1/zzz&pdf=https://publisher.example/x.pdf&lang=ja" \
  "L_damaged_ja|id=2301.12345&lang=ja" \
  "P_page_retry|doi=10.1103/physrevd.108.045001&pdf=https://publisher.example/x.pdf&src=7" \
  "Q_page_fails|doi=10.1103/physrevd.108.045001&pdf=https://publisher.example/x.pdf&src=7" \
  "Q_page_fails_ja|doi=10.1103/physrevd.108.045001&pdf=https://publisher.example/x.pdf&src=7&lang=ja" \
  "R_other_site|doi=10.1103/physrevd.108.045001&pdf=https://publisher.example/x.pdf&src=7" \
  "S_no_tab|doi=10.1103/physrevd.108.045001&pdf=https://publisher.example/x.pdf" "N_external_fails_ja|id=2301.12345&lang=ja" \
  "W_ads|ads=1970A%26A.....5...84Z&pdf=https%3A%2F%2Farticles.adsabs.harvard.edu%2Fpdf%2F1970A%2526A.....5...84Z&title=Black%20holes%20in%201970&authors=%5B%22Ann%20Zel%22%2C%22Bo%20Novikov%22%5D" \
  "X_ads_saved|ads=1970A%26A.....5...84Z&pdf=https%3A%2F%2Farticles.adsabs.harvard.edu%2Fpdf%2F1970A%2526A.....5...84Z" \
  "T_save_new|id=2301.12345&v=v2&save=1" "AG_save_quiet|id=2301.12345&v=v2&save=1&quiet=1" "U_save_nolib|id=2301.12345&save=1" "V_save_saved|id=2301.12345&v=v2&save=1" \
  "Z_bad_request|id=..%2F..%2Fsecret" "Z_bad_request|id=2301.12345&v=..%2Fx" "Z_bad_request|ads=nonsense&pdf=https%3A%2F%2Farticles.adsabs.harvard.edu%2Fpdf%2Fx" \
  "AA_existing_arxiv|id=2301.12345&v=v2" "AB_existing_journal|doi=10.1103/physrevd.108.045001&pdf=https://publisher.example/x.pdf" \
  "AC_existing_ads|ads=1970A%26A.....5...84Z&pdf=https%3A%2F%2Farticles.adsabs.harvard.edu%2Fpdf%2F1970A%2526A.....5...84Z" "AD_existing_notpdf|id=2301.12345&v=v2" \
  "Y_save_busy|id=2301.12345&v=v2&save=1&title=Waves%20in%20plasma&authors=%5B%22Ann%20Lee%22%2C%22Bo%20Kim%22%5D&n=5"; do
  run_page "$WORK/ui-open.html" "s=${case%%|*}&${case#*|}" 20000 | tee -a "$OUT"
done

echo; echo "passed: $(grep -c '^ok' "$OUT")   failed: $(grep -c '^FAIL\|^EXCEPTION\|^Traceback' "$OUT")"
! grep -q '^FAIL\|^EXCEPTION\|^Traceback' "$OUT"  # (a test program that crashes prints a Traceback and counts as a failure)
