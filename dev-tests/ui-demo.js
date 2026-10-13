// Fills the library with a few realistic papers for a screenshot (not a test).
(async () => {
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  await sleep(300);
  const e = (title, authors, extra) => ({ title, authors, authorCount: authors.length, added: "2026-09-10T00:00:00Z", versions: {}, ...extra });
  seed({
    "2402.01234": e("Symmetry TFTs and anomalies of non-invertible symmetries", ["Ann Smith", "Bo Chen", "Carla Diaz"], { added: "2026-10-01T00:00:00Z", versions: { v1: "a1.pdf", v2: "a2.pdf" }, tags: ["symmetry", "TFT"], journal: { file: "j.pdf", name: "JHEP", year: 2024 }, doi: "10.1007/jhep01(2024)001" }),
    "2311.05521": e("Gravitational waves from first-order phase transitions: a review", ["Dai Evans", "Eli Fox"], { added: "2026-09-20T00:00:00Z", versions: { v3: "b3.pdf" }, tags: ["GW", "cosmology", "review"] }),
    "hep-th/9711200": e("The Large N Limit of Superconformal Field Theories and Supergravity", ["Juan Maldacena"], { added: "2026-08-01T00:00:00Z", versions: { v3: "c3.pdf" }, tags: ["AdS/CFT"] }),
    "2409.11111": e("Celestial holography and soft theorems", ["Kim Lee"], { added: "2026-09-25T00:00:00Z", note: "2409.11111.md", tags: ["holography"] }),
    "doi:10.1103/physrevd.108.045001": e("Casimir interaction of finite-width strings", ["Gus Hall", "Ida Jones"], { added: "2026-07-01T00:00:00Z", doi: "10.1103/physrevd.108.045001", journal: { file: "d.pdf", name: "Physical Review D", year: 2023 } }),
  });
  fakeDir.put("2402.01234.md", "<!-- papurr:summary date=2026-10-01 -->\nS\n<!-- /papurr:summary -->\n\n## Notes\n\nidea\n");
  fakeDir.put("2409.11111.md", "## Notes\n\nread later\n");
  for (const f of ["a1.pdf", "a2.pdf", "j.pdf", "b3.pdf", "c3.pdf", "d.pdf"]) fakeDir.put(f, "%PDF-");
  document.getElementById("rebuild").click();
  await sleep(400);
  document.getElementById("test-out").textContent = "demo ready";
})();
