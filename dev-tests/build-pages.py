#!/usr/bin/env python3
"""Builds the test pages from the REAL html files of the extension, so a change to a page is also tested.

usage: build-pages.py <kind> <output.html>      kind: library | options | open | note | demo | ... (see PAGES)
The real page is used as it is, except that: the folder/browser APIs are faked (ui-harness.js), the page's
scripts are loaded from their real location, and a test script is added at the end.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(os.path.dirname(HERE), "extension")
kind, out = sys.argv[1], sys.argv[2]

PAGES = {  # kind: (html, scripts to put before the page script, page script, scripts after it)
    "library": ("library.html", ["ui-harness.js", "@i18n", "@common", "@inspire-style", "@import", "@ai", "@profile", "ui-library-setup.js"], "library.js", ["ui-lib-test.js"]),
    "inspire": ("inspire.html", ["ui-harness.js", "@i18n", "@common", "@inspire", "ui-inspire-setup.js"], "inspire-page.js", ["ui-inspire-test.js"]),
    "layout-inspire": ("inspire.html", ["ui-harness.js", "@i18n", "@common", "@inspire", "ui-inspire-setup.js"], "inspire-page.js", ["ui-layout-test.js"]),
    "demo": ("library.html", ["ui-harness.js", "@i18n", "@common", "@inspire-style", "@import", "@ai", "@profile", "ui-library-setup.js"], "library.js", ["ui-demo.js"]),
    "library-odd": ("library.html", ["ui-harness.js", "@i18n", "@common", "@inspire-style", "@import", "@ai", "@profile", "ui-library-setup.js"], "library.js", ["ui-lib-odd-test.js"]),
    "layout-today": ("today.html", ["ui-harness.js", "@i18n", "@common", "@ai", "@profile", "@rank", "@reason", "@translate", "ui-today-setup.js"], "today.js", ["ui-layout-test.js"]),
    "layout-note": ("note.html", ["ui-harness.js", "@i18n", "@common", "@ai", "@profile", "@reason", "@summary", "@translate", "ui-note-setup.js"], "note.js", ["ui-layout-test.js"]),
    "layout-options": ("options.html", ["ui-harness.js", "@i18n", "@common", "@import", "@import-ui", "@ai", "@ai-ui", "@profile", "@profile-ui", "ui-options-setup.js"], "options.js", ["ui-layout-test.js"]),
    "help": ("help.html", ["ui-harness.js", "@i18n"], "help.js", ["ui-help-test.js"]),
    "layout-help": ("help.html", ["ui-harness.js", "@i18n"], "help.js", ["ui-layout-test.js"]),
    "library-ja": ("library.html", ["ui-harness.js", "@i18n", "@common", "@inspire-style", "@import", "@ai", "@profile", "ui-library-setup.js"], "library.js", ["ui-lib-ja-test.js"]),
    "options-import": ("options.html", ["ui-harness.js", "@i18n", "@common", "@import", "@import-ui", "@ai", "@ai-ui", "@profile", "@profile-ui", "ui-options-setup.js"], "options.js", ["ui-import-test.js"]),
    "today": ("today.html", ["ui-harness.js", "@i18n", "@common", "@ai", "@profile", "@rank", "@reason", "@translate", "ui-today-setup.js"], "today.js", ["ui-today-test.js"]),
    "options-ai": ("options.html", ["ui-harness.js", "@i18n", "@common", "@import", "@import-ui", "@ai", "@ai-ui", "@profile", "@profile-ui", "ui-options-setup.js"], "options.js", ["ui-ai-test.js"]),
    "options-profile": ("options.html", ["ui-harness.js", "@i18n", "@common", "@import", "@import-ui", "@ai", "@ai-ui", "@profile", "@profile-ui", "ui-options-setup.js", "ui-profile-setup.js"], "options.js", ["ui-profile-test.js"]),
    "today-ai": ("today.html", ["ui-harness.js", "@i18n", "@common", "@ai", "@profile", "@rank", "@reason", "@translate", "ui-today-setup.js", "ui-today-ai-setup.js"], "today.js", ["ui-today-ai-test.js"]),
    "layout-today-ai": ("today.html", ["ui-harness.js", "@i18n", "@common", "@ai", "@profile", "@rank", "@reason", "@translate", "ui-today-setup.js", "ui-today-ai-setup.js"], "today.js", ["ui-layout-test.js"]),
    "options-ja": ("options.html", ["ui-harness.js", "@i18n", "@common", "@import", "@import-ui", "@ai", "@ai-ui", "@profile", "@profile-ui", "ui-options-setup.js"], "options.js", ["ui-options-ja-test.js"]),
    "options-zh": ("options.html", ["ui-harness.js", "@i18n", "@common", "@import", "@import-ui", "@ai", "@ai-ui", "@profile", "@profile-ui", "ui-options-setup.js"], "options.js", ["ui-options-zh-test.js"]),
    "options": ("options.html", ["ui-harness.js", "@i18n", "@common", "@import", "@import-ui", "@ai", "@ai-ui", "@profile", "@profile-ui", "ui-options-setup.js"], "options.js", ["ui-options-test.js"]),
    "note": ("note.html", ["ui-harness.js", "@i18n", "@common", "@ai", "@profile", "@reason", "@summary", "@translate", "ui-note-setup.js"], "note.js", ["ui-note-test.js"]),
    "open": ("open.html", ["ui-harness.js", "@i18n", "@common", "ui-open-setup.js"], "open.js", ["ui-open-hook.js", "ui-open-test.js"]),
}
html_name, before, page_js, after = PAGES[kind]
html = open(os.path.join(EXT, html_name), encoding="utf-8").read()

def src(name):
    if name in ("@common", "@i18n", "@import", "@import-ui", "@ai", "@ai-ui", "@profile", "@profile-ui", "@inspire", "@inspire-style", "@rank", "@reason", "@summary", "@translate"):
        return "file://" + os.path.join(EXT, name[1:] + ".js")
    return "file://" + os.path.join(HERE, name)

html = re.sub(r'(href|src)="(style\.css|theme\.js|icons/[^"]+|vendor/[^"]+)"', lambda m: '%s="file://%s"' % (m.group(1), os.path.join(EXT, m.group(2))), html)
html = html.replace('<script src="i18n.js"></script>', "")  # loaded after the fake browser instead (see PAGES)
for line in ('  <script src="import.js"></script>\n', '  <script src="inspire.js"></script>\n', '  <script src="inspire-style.js"></script>\n', '  <script src="import-ui.js"></script>\n', '  <script src="ai.js"></script>\n', '  <script src="ai-ui.js"></script>\n', '  <script src="profile.js"></script>\n', '  <script src="profile-ui.js"></script>\n', '  <script src="rank.js"></script>\n', '  <script src="reason.js"></script>\n', '  <script src="summary.js"></script>\n', '  <script src="translate.js"></script>\n'):
    html = html.replace(line, "")  # (loaded through PAGES where a page needs it)
if '<script src="common.js"></script>' in html:
    html = html.replace('<script src="common.js"></script>', "".join('<script src="%s"></script>' % src(n) for n in before))
else:  # (a page without common.js, e.g. Help: the fake browser and the dictionaries go right before the page script)
    html = html.replace('<script src="%s"></script>' % page_js, "".join('<script src="%s"></script>' % src(n) for n in before) + '<script src="%s"></script>' % page_js)
html = html.replace('<script src="%s"></script>' % page_js, '<script src="file://%s"></script>' % os.path.join(EXT, page_js)
                    + "".join('<script src="%s"></script>' % src(n) for n in after))
html = html.replace("</body>", '<pre id="test-out" style="position:fixed;bottom:0;left:0;margin:0;font-size:11px;opacity:0.0">running</pre></body>')
open(out, "w", encoding="utf-8").write(html)
