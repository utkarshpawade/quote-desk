/**
 * Renders docs/TDD.md to a PDF in the app's typeface, through Chromium (Playwright):
 *   npx tsx scripts/build-tdd.ts [out.pdf]       default: docs/Quote-Desk-TDD.pdf
 * Fonts and images are inlined, so the page needs no file or network access.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { marked } from "marked";

const root = process.cwd();
const out = path.resolve(process.argv[2] ?? "docs/Quote-Desk-TDD.pdf");

const dataUrl = (file: string, type: string) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
const font = (name: string) => dataUrl(path.join(root, "src/server/pdf/fonts", name), "font/woff");

const css = `
@font-face { font-family: Plex; src: url(${font("IBMPlexSans-Regular.woff")}); font-weight: 400; }
@font-face { font-family: Plex; src: url(${font("IBMPlexSans-Medium.woff")}); font-weight: 500; }
@font-face { font-family: Plex; src: url(${font("IBMPlexSans-SemiBold.woff")}); font-weight: 600 700; }
@font-face { font-family: PlexMono; src: url(${font("IBMPlexMono-Regular.woff")}); font-weight: 400; }
@font-face { font-family: PlexMono; src: url(${font("IBMPlexMono-Medium.woff")}); font-weight: 500 700; }
@page { size: A4; margin: 16mm 15mm 18mm; }
html { font-family: Plex, Arial, sans-serif; font-size: 9.6pt; line-height: 1.5; color: #15191f; }
body { margin: 0; }
h1 { font-size: 21pt; line-height: 1.2; margin: 0 0 4pt; font-weight: 600; letter-spacing: -0.01em; }
h2 { font-size: 14pt; margin: 22pt 0 6pt; padding-top: 8pt; border-top: 1px solid #e3e6ea; font-weight: 600; break-after: avoid; }
h3 { font-size: 11pt; margin: 14pt 0 4pt; font-weight: 600; break-after: avoid; }
h4 { font-size: 9.6pt; margin: 10pt 0 2pt; font-weight: 600; break-after: avoid; }
h2.newpage { break-before: page; border-top: 0; padding-top: 0; margin-top: 0; }
p, ul, ol { margin: 0 0 6pt; }
ul, ol { padding-left: 15pt; }
li { margin: 1.5pt 0; }
li > p { margin: 0; }
strong { font-weight: 600; }
a { color: #2b5b8a; text-decoration: none; }
code { font-family: PlexMono, Consolas, monospace; font-size: 8.4pt; background: #f6f7f9; padding: 0.5pt 2.5pt; border-radius: 2pt; }
pre { background: #f6f7f9; border: 1px solid #e3e6ea; border-radius: 4pt; padding: 6pt 8pt; font-size: 8pt; line-height: 1.45; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 9pt; font-size: 8.4pt; line-height: 1.4; break-inside: auto; }
tr { break-inside: avoid; }
th { text-align: left; font-weight: 600; color: #4a5260; background: #f6f7f9; border-bottom: 1px solid #cfd4da; padding: 3pt 5pt; vertical-align: bottom; }
td { border-bottom: 1px solid #e3e6ea; padding: 3pt 5pt; vertical-align: top; }
td[align="right"], th[align="right"] { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
blockquote { margin: 6pt 0 8pt; padding: 4pt 0 4pt 10pt; border-left: 3px solid #2b5b8a; color: #4a5260; }
blockquote p { margin: 0 0 3pt; }
img { display: block; max-width: 100%; margin: 6pt auto 3pt; border: 1px solid #e3e6ea; border-radius: 4pt; }
img[alt^="Architecture"] { border: 0; }
p:has(> img) { break-inside: avoid; text-align: center; font-size: 8.2pt; color: #646c7a; margin-bottom: 10pt; }
.meta table { font-size: 9pt; }
hr { border: 0; border-top: 1px solid #e3e6ea; margin: 12pt 0; }
`;

const md = readFileSync(path.join(root, "docs/TDD.md"), "utf8");
let body = await marked.parse(md);
// Inline images (screens/*.png, architecture.svg) as data URLs.
body = body.replace(/src="([^"]+\.(png|svg))"/g, (_m, src: string, ext: string) => `src="${dataUrl(path.join(root, "docs", src), ext === "svg" ? "image/svg+xml" : "image/png")}"`);
// Sections marked <!-- newpage --> start on a new page.
body = body.replace(/<!-- newpage -->\s*<h2/g, '<h2 class="newpage"');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quote Desk — Technical Design Document</title><style>${css}</style></head><body>${body}</body></html>`;

// TDD_HTML=<file> also writes the HTML, to check the layout in a browser.
if (process.env.TDD_HTML) writeFileSync(process.env.TDD_HTML, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;margin:0 15mm;font-family:Arial,sans-serif;font-size:7.5px;color:#646c7a;display:flex;justify-content:space-between"><span>Quote Desk — Technical Design Document</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" },
});
await browser.close();
console.log(out);
