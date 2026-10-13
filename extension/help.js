// The Help page: how to use Papurr, in the interface language. The texts are in i18n.js ("help.*"); this file only
// says how they are arranged. In a text, **bold** and `code` are shown as such (built as elements, never as HTML).
const HELP_SECTIONS = [
  ["start", "help.start.t", [["ol", ["help.start.1", "help.start.2", "help.start.3"]], ["p", "help.start.4"]]],
  ["folder", "help.folder.t", [["p", "help.folder.1"], ["p", "help.folder.2"], ["p", "help.folder.3"], ["p", "help.folder.4"]]],
  ["library", "help.library.t", [["ul", ["help.library.1", "help.library.2", "help.library.3", "help.library.4", "help.library.5"]]]],
  ["notes", "help.notes.t", [["p", "help.notes.1"], ["p", "help.notes.2"]]],
  ["import", "help.import.t", [["p", "help.import.1"], ["ol", ["help.import.2", "help.import.3"]], ["p", "help.import.4"]]],
  ["today", "help.today.t", [["p", "help.today.1"], ["p", "help.today.2"], ["p", "help.today.3"]]],
  ["sites", "help.sites.t", [["p", "help.sites.1"], ["p", "help.sites.2"], ["p", "help.sites.3"]]],
  ["openwith", "help.openwith.t", [["p", "help.openwith.1"], ["ul", ["help.openwith.6", ["help.openwith.7", ["help.openwith.2", "help.openwith.3", "help.openwith.4"]]]], ["p", "help.openwith.5"]]],
  ["ai", "help.ai.t", [["p", "help.ai.1"], ["ol", ["help.ai.2", "help.ai.3", "help.ai.4", "help.ai.5"]], ["p", "help.ai.6"], ["p", "help.ai.7"]]],
  ["privacy", "help.privacy.t", [["p", "help.privacy.1"], ["p", "help.privacy.2"]]],
  ["limits", "help.limits.t", [["p", "help.limits.1"]]],
];

// A text with **bold** and `code` as a list of nodes.
function richText(text) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map((part) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const b = document.createElement("strong");
      b.textContent = part.slice(2, -2);
      return b;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const c = document.createElement("code");
      c.textContent = part.slice(1, -1);
      return c;
    }
    return document.createTextNode(part);
  });
}

function block([kind, content]) {
  if (kind === "p") {
    const p = document.createElement("p");
    p.append(...richText(tr(content)));
    return p;
  }
  const list = document.createElement(kind); // "ul" or "ol"
  for (const item of content) {
    const li = document.createElement("li");
    const [key, sub] = Array.isArray(item) ? item : [item, null]; // an item can have a list of its own: [key, [keys]]
    li.append(...richText(tr(key)));
    if (sub) li.append(block(["ul", sub]));
    list.append(li);
  }
  return list;
}

async function showHelp() {
  await i18nReady;
  const main = document.getElementById("help");
  main.textContent = "";
  const intro = document.createElement("p");
  intro.className = "help-intro";
  intro.append(...richText(tr("help.intro")));
  const more = block(["p", "help.intro.more"]);
  const features = block(["ul", ["help.intro.f1", "help.intro.f2", "help.intro.f3", "help.intro.f4"]]);
  more.className = features.className = "help-intro";
  const toc = document.createElement("nav");
  toc.className = "help-toc";
  toc.setAttribute("aria-label", tr("help.toc"));
  main.append(intro, more, features, toc);
  for (const [id, title, blocks] of HELP_SECTIONS) {
    const link = document.createElement("a");
    link.href = "#" + id;
    link.textContent = tr(title);
    toc.append(link);
    const section = document.createElement("section");
    section.id = id;
    const h = document.createElement("h3");
    h.textContent = tr(title);
    section.append(h, ...blocks.map(block));
    main.append(section);
  }
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
  }
}

showHelp();
