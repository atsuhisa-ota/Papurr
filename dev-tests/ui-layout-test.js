// Layout of a page as it first appears (Today's arXiv, a note, Settings): in every colour theme, in a wide and a narrow
// window, nothing makes the page scroll sideways, nothing sticks out to the right, and every visible text is readable.
(async () => {
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  try {
    await sleep(2500); // (the page has loaded what it shows)
    { const st = document.createElement("style"); st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }"; document.head.append(st); } // (colours are measured right after a theme change, not in the middle of a fade)
    const rgba = (c) => { const v = (c.match(/[\d.]+/g) || [0, 0, 0, 0]).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
    const lum = (c) => 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
    const ch = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    const bgOf = (el) => {
      const layers = [];
      for (; el; el = el.parentElement) { const c = rgba(getComputedStyle(el).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
      let out = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : rgba(getComputedStyle(document.documentElement).backgroundColor);
      if (out[3] < 1) out = [255, 255, 255, 1];
      while (layers.length) { const [r, g, b, a] = layers.pop(); out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a), 1]; }
      return out;
    };
    const contrast = (el) => {
      const fg = rgba(getComputedStyle(el).color), bg = bgOf(el);
      const f = [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])];
      const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    };
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden], .katex-mathml"); };
    const faded = (el) => { for (let e = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 1 || e.disabled) return true; return false; };
    const texts = () => [...document.body.querySelectorAll("*")].filter((el) => !["SCRIPT", "STYLE", "PRE", "svg"].includes(el.tagName) && el.id !== "test-out" && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && visible(el) && !faded(el));
    const overflow = [], low = new Set();
    for (const theme of THEMES) {
      if (theme === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", theme);
      for (const width of [1000, 520]) {
        document.body.style.maxWidth = width - 40 + "px";
        await sleep(30);
        const page = document.documentElement;
        if (page.scrollWidth > page.clientWidth + 1) overflow.push(theme + "@" + width + ": the page is " + page.scrollWidth + "px wide");
        const right = document.body.getBoundingClientRect().right;
        for (const el of document.body.querySelectorAll("*")) {
          if (el.id === "test-out" || el.closest("#test-out, [hidden]")) continue;
          const r = el.getBoundingClientRect();
          if (r.width && r.right > right + 2 && getComputedStyle(el).position !== "fixed") { overflow.push(theme + "@" + width + ": " + el.tagName + (el.id ? "#" + el.id : "") + "." + String(el.className).split(" ")[0] + " +" + Math.round(r.right - right) + "px"); break; }
        }
      }
      document.body.style.maxWidth = "";
      for (const el of texts()) {
        const ratio = contrast(el);
        if (ratio < 3) low.add(theme + " " + el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "") + " \"" + el.textContent.trim().slice(0, 20) + "\" " + ratio.toFixed(2));
      }
    }
    document.documentElement.removeAttribute("data-theme");
    // A text inside a button (or a small label that looks like one) stays on one line and inside its box, at both widths.
    const cramped = [];
    for (const width of [1000, 520]) {
      document.body.style.maxWidth = width - 40 + "px";
      await sleep(30);
      for (const el of document.body.querySelectorAll("button, .tag, a.mini, span.mini")) {
        if (!visible(el) || el.closest("#test-out")) continue;
        const range = document.createRange(); range.selectNodeContents(el);
        const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top / 4))).size;
        const box = el.getBoundingClientRect(), text = range.getBoundingClientRect();
        if (lines > 1 || el.scrollWidth > el.clientWidth + 1 || text.right > box.right + 1 || text.left < box.left - 1) cramped.push(width + ": \"" + el.textContent.trim().slice(0, 40) + "\" (" + lines + " lines)");
      }
    }
    document.body.style.maxWidth = "";
    check("layout: the text of every button stays on one line and inside the button (1000px and 520px)", cramped.length === 0, [...new Set(cramped)].slice(0, 8).join(" | "));
    // The header's link to INSPIRE: the page of its own (same tab), between Today's arXiv and Settings, level with the others.
    { const links = [...document.querySelectorAll(".header-actions a")], il = links.find((a) => a.getAttribute("href") === "inspire.html");
      const other = links.find((a) => a.getAttribute("href") === "help.html" || a.getAttribute("href") === "options.html");
      const mid = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
      check("layout: the header has the INSPIRE link to the INSPIRE page: same tab, between Today's arXiv and Settings, level with the others", !!il && !il.target && il.textContent === "INSPIRE" && links.map((a) => a.getAttribute("href")).join("|").includes("today.html|inspire.html|options.html") && !!other && Math.abs(mid(il) - mid(other)) < 3, il ? links.map((a) => a.getAttribute("href")).join("|") + " " + mid(il) + " vs " + mid(other) : "no link"); }
    // The header's switch: its checkbox is level with its text (the Settings page once drew it 2 px too high).
    { const box = document.querySelector(".switch input"), label = document.querySelector(".switch span");
      if (box && label) { const r = document.createRange(); r.selectNodeContents(label); const t = r.getBoundingClientRect(), b = box.getBoundingClientRect();
        check("layout: the checkbox of the header switch is level with its text", Math.abs((b.top + b.height / 2) - (t.top + t.height / 2)) <= 1.6, "box centre " + (b.top + b.height / 2) + ", text centre " + (t.top + t.height / 2)); } }
    check("layout: no sideways scrolling, nothing sticks out to the right (7 themes, 1000px and 520px)", overflow.length === 0, overflow.slice(0, 6).join(" | "));
    check("layout: every visible text is readable in every theme (contrast 3:1 or better)", low.size === 0, [...low].slice(0, 10).join(" | "));
    check("layout: no script error", errors.length === 0, errors.join(" | "));
  } catch (e) { results.push("EXCEPTION " + e.stack); }
  document.getElementById("test-out").textContent = results.join("\n");
})();
