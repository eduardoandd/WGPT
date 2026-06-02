import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, "assets");
const OUTPUT = path.join(ROOT, "AI-Business-Assistant.pdf");

/**
 * Lê uma imagem da pasta assets/ e devolve um data URI base64.
 * Se o arquivo não existir, devolve null (renderiza placeholder).
 */
function loadImage(...candidates: string[]): string | null {
    for (const name of candidates) {
        const p = path.join(ASSETS_DIR, name);
        if (fs.existsSync(p)) {
            const ext = path.extname(p).slice(1).toLowerCase();
            const mime = ext === "jpg" ? "jpeg" : ext;
            const b64 = fs.readFileSync(p).toString("base64");
            return `data:image/${mime};base64,${b64}`;
        }
    }
    return null;
}

function shot(label: string, ...candidates: string[]): string {
    const src = loadImage(...candidates);
    if (src) {
        return `<div class="shot"><img src="${src}" alt="${label}"/></div>`;
    }
    return `<div class="shot placeholder">
        <div class="ph-icon">🖼️</div>
        <div class="ph-text">Drop <b>${candidates[0]}</b><br/>into the <b>/assets</b> folder</div>
    </div>`;
}

const embedded = shot("Embedded assistant", "embedded.png", "credify.png", "credify1.png");
const embedded2 = shot("Embedded assistant detail", "embedded2.png", "credify2.png");
const whatsapp = shot("WhatsApp", "whatsapp.png", "whatsapp1.png");
const whatsapp2 = shot("WhatsApp report", "whatsapp2.png", "whatsapp-pdf.png");
const slack = shot("Slack", "slack.png");
const email = shot("Email delivery", "email.png", "report.png");

const html = /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
    @page { margin: 0; size: A4; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
        --navy: #0b1f3a;
        --navy-2: #12305c;
        --accent: #16c79a;
        --accent-2: #0fa37f;
        --ink: #1c2833;
        --muted: #5b6b7b;
        --line: #e4e9f0;
        --bg-soft: #f5f8fc;
    }
    body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: var(--ink); -webkit-print-color-adjust: exact; }
    .page { width: 210mm; min-height: 297mm; padding: 0; position: relative; page-break-after: always; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    .pad { padding: 22mm 18mm; }

    /* ---------- COVER ---------- */
    .cover {
        background: linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 55%, #1a4480 100%);
        color: #fff; height: 297mm; display: flex; flex-direction: column;
        justify-content: space-between; padding: 26mm 18mm;
    }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 600; letter-spacing: .5px; }
    .brand .dot { width: 16px; height: 16px; background: var(--accent); border-radius: 4px; transform: rotate(45deg); }
    .cover h1 { font-size: 46px; line-height: 1.08; font-weight: 700; margin-bottom: 18px; }
    .cover h1 .hl { color: var(--accent); }
    .cover .sub { font-size: 17px; line-height: 1.6; color: #c9d6e8; max-width: 150mm; }
    .cover .tags { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 26px; }
    .cover .tag { border: 1px solid rgba(255,255,255,.25); padding: 7px 14px; border-radius: 30px; font-size: 12.5px; color: #e8eef7; }
    .cover .foot { font-size: 12.5px; color: #9fb2cc; border-top: 1px solid rgba(255,255,255,.15); padding-top: 16px; }

    /* ---------- SECTION ---------- */
    .eyebrow { color: var(--accent-2); font-weight: 700; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
    h2 { font-size: 27px; color: var(--navy); margin-bottom: 14px; line-height: 1.2; }
    p.lead { font-size: 14.5px; line-height: 1.7; color: var(--muted); max-width: 165mm; }

    /* ---------- CAPABILITY CARDS ---------- */
    .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 22px; }
    .card { border: 1px solid var(--line); border-radius: 14px; padding: 20px; background: #fff; }
    .card .ic { width: 42px; height: 42px; border-radius: 11px; background: var(--bg-soft); display: flex; align-items: center; justify-content: center; font-size: 21px; margin-bottom: 12px; }
    .card h3 { font-size: 16px; color: var(--navy); margin-bottom: 6px; }
    .card p { font-size: 13px; line-height: 1.6; color: var(--muted); }

    /* ---------- HOW IT WORKS ---------- */
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 22px; }
    .step { background: var(--bg-soft); border-radius: 14px; padding: 20px; position: relative; }
    .step .n { font-size: 13px; font-weight: 700; color: var(--accent-2); margin-bottom: 8px; }
    .step h3 { font-size: 15px; color: var(--navy); margin-bottom: 6px; }
    .step p { font-size: 12.5px; line-height: 1.55; color: var(--muted); }

    /* ---------- SCREENSHOTS ---------- */
    .shot { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 8px 24px rgba(11,31,58,.07); }
    .shot img { width: 100%; display: block; }
    .shot.placeholder { aspect-ratio: 9 / 13; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; background: repeating-linear-gradient(45deg, #f7fafd, #f7fafd 12px, #f1f6fb 12px, #f1f6fb 24px); border-style: dashed; }
    .ph-icon { font-size: 40px; opacity: .5; }
    .ph-text { font-size: 12px; color: var(--muted); text-align: center; line-height: 1.6; }
    .shot-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 22px; }
    .shot-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 22px; }
    .shot-cap { font-size: 11.5px; color: var(--muted); margin-top: 8px; text-align: center; }
    .shot-block { }

    /* ---------- FEATURE STRIP (embedded) ---------- */
    .embed-row { display: grid; grid-template-columns: 1.15fr 1fr; gap: 22px; align-items: center; margin-top: 22px; }
    .embed-row .txt h3 { font-size: 18px; color: var(--navy); margin-bottom: 10px; }
    .embed-row .txt p { font-size: 13.5px; line-height: 1.7; color: var(--muted); margin-bottom: 12px; }
    .checklist { list-style: none; }
    .checklist li { font-size: 13px; color: var(--ink); padding-left: 26px; position: relative; margin-bottom: 9px; line-height: 1.5; }
    .checklist li::before { content: "✓"; position: absolute; left: 0; top: 0; color: var(--accent-2); font-weight: 700; background: var(--bg-soft); width: 18px; height: 18px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 11px; }

    /* ---------- USE CASES ---------- */
    .uc { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 22px; }
    .uc-item { border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
    .uc-item .h { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .uc-item .h .e { font-size: 18px; }
    .uc-item .h b { font-size: 14.5px; color: var(--navy); }
    .uc-item p { font-size: 12.5px; line-height: 1.55; color: var(--muted); }

    /* ---------- METRICS ---------- */
    .metrics { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-top: 24px; }
    .metric { background: linear-gradient(135deg, var(--navy), var(--navy-2)); color: #fff; border-radius: 14px; padding: 22px; text-align: center; }
    .metric .big { font-size: 32px; font-weight: 700; color: var(--accent); }
    .metric .lbl { font-size: 12px; color: #c9d6e8; margin-top: 6px; line-height: 1.4; }

    /* ---------- CTA ---------- */
    .cta { background: linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 100%); color: #fff; border-radius: 18px; padding: 36px; text-align: center; margin-top: 30px; }
    .cta h2 { color: #fff; font-size: 24px; margin-bottom: 12px; }
    .cta p { font-size: 14px; color: #c9d6e8; max-width: 130mm; margin: 0 auto 18px; line-height: 1.6; }
    .cta .pill { display: inline-block; background: var(--accent); color: var(--navy); font-weight: 700; padding: 12px 26px; border-radius: 30px; font-size: 14px; }

    .divider { height: 4px; width: 54px; background: var(--accent); border-radius: 4px; margin-bottom: 18px; }
    .footnote { position: absolute; bottom: 12mm; left: 18mm; right: 18mm; font-size: 10.5px; color: #9aa8b6; border-top: 1px solid var(--line); padding-top: 10px; display: flex; justify-content: space-between; }
</style>
</head>
<body>

<!-- ====================== PAGE 1 — COVER ====================== -->
<div class="page cover">
    <div class="brand"><span class="dot"></span> INTELLIGENT BUSINESS ASSISTANT</div>
    <div>
        <h1>Your team's new <span class="hl">AI assistant</span>,<br/>working where your business already runs.</h1>
        <p class="sub">A custom AI assistant that talks to your data, reads your documents, builds reports, and delivers them automatically — right inside WhatsApp, Slack, Telegram, or your own web platform.</p>
        <div class="tags">
            <span class="tag">Talk to your database</span>
            <span class="tag">Document intelligence</span>
            <span class="tag">Automated PDF reports</span>
            <span class="tag">Email delivery</span>
            <span class="tag">Embeds in your product</span>
        </div>
    </div>
    <div class="foot">Tailored, white-label AI automation for modern companies — built and deployed for your workflow.</div>
</div>

<!-- ====================== PAGE 2 — OVERVIEW + CAPABILITIES ====================== -->
<div class="page">
  <div class="pad">
    <div class="eyebrow">What it is</div>
    <h2>One assistant. Every routine task, handled.</h2>
    <p class="lead">It's not another chatbot that just answers questions. It's a working assistant that takes action on your behalf — querying business systems, analyzing files, generating polished documents, and sending them out. Your team simply asks in plain language, and the work gets done.</p>

    <div class="cards">
        <div class="card">
            <div class="ic">💬</div>
            <h3>Talk to your data</h3>
            <p>Ask questions about your business in plain English. The assistant queries your database, interprets the results, and replies with clear insights — no SQL, no dashboards.</p>
        </div>
        <div class="card">
            <div class="ic">📄</div>
            <h3>Document intelligence</h3>
            <p>Send a PDF or spreadsheet and get an instant summary, key figures, and answers to follow-up questions — ideal for contracts, reports, and statements.</p>
        </div>
        <div class="card">
            <div class="ic">📊</div>
            <h3>Automated reports</h3>
            <p>Turn raw data into professional, branded PDF reports on demand. Executive summaries, tables, and insights generated in seconds.</p>
        </div>
        <div class="card">
            <div class="ic">✉️</div>
            <h3>Delivery on autopilot</h3>
            <p>Once a report is ready, the assistant emails it to the right people automatically. Request to delivered inbox — all in one conversation.</p>
        </div>
    </div>

    <div style="margin-top: 26px;"></div>
    <div class="eyebrow">How it works</div>
    <h2>From request to result in three steps.</h2>
    <div class="steps">
        <div class="step"><div class="n">01</div><h3>Ask</h3><p>Your team writes a normal message in the channel they already use every day.</p></div>
        <div class="step"><div class="n">02</div><h3>Act</h3><p>The assistant connects to your systems, runs the task, and prepares the output.</p></div>
        <div class="step"><div class="n">03</div><h3>Deliver</h3><p>It replies with the answer, attaches the report, and sends it onward if needed.</p></div>
    </div>
  </div>
  <div class="footnote"><span>Intelligent Business Assistant</span><span>Capabilities Overview</span></div>
</div>

<!-- ====================== PAGE 3 — IN ACTION (channels) ====================== -->
<div class="page">
  <div class="pad">
    <div class="eyebrow">See it in action</div>
    <h2>Real conversations, real output.</h2>
    <p class="lead">The same assistant works across every channel your business uses. Here it answers a data question, builds a report, and emails it — entirely through chat.</p>

    <div class="shot-grid-3">
        <div class="shot-block">${whatsapp}<div class="shot-cap">WhatsApp — querying live business data</div></div>
        <div class="shot-block">${whatsapp2}<div class="shot-cap">Report generated & delivered as PDF</div></div>
        <div class="shot-block">${email}<div class="shot-cap">Final report emailed automatically</div></div>
    </div>

    <div class="shot-grid-2" style="margin-top: 26px;">
        <div class="shot-block">${slack}<div class="shot-cap">Slack — top-customer analysis on request</div></div>
        <div class="shot-block" style="display:flex; align-items:center;">
            <div>
                <h3 style="font-size:18px;color:var(--navy);margin-bottom:10px;">Lives inside the tools your team already opens</h3>
                <ul class="checklist">
                    <li>WhatsApp, Slack & Telegram — no new app to learn</li>
                    <li>Responds in seconds, around the clock</li>
                    <li>Understands plain language in any language</li>
                    <li>Keeps context across the whole conversation</li>
                </ul>
            </div>
        </div>
    </div>
  </div>
  <div class="footnote"><span>Intelligent Business Assistant</span><span>In Action — Messaging Channels</span></div>
</div>

<!-- ====================== PAGE 4 — EMBEDDED IN YOUR PRODUCT ====================== -->
<div class="page">
  <div class="pad">
    <div class="eyebrow">Embedded experience</div>
    <h2>Or build it right into your own platform.</h2>
    <p class="lead">Beyond messaging apps, the assistant can be embedded directly into your web product as a context-aware helper — reading the screen the user is on and acting on it instantly.</p>

    <div class="embed-row">
        <div>${embedded}</div>
        <div class="txt">
            <h3>A native assistant inside your app</h3>
            <p>It already understands the page in front of your user. They can ask for a quick summary, consolidate figures, or generate a downloadable PDF — without leaving the screen.</p>
            <ul class="checklist">
                <li>Reads on-screen context automatically</li>
                <li>One-click quick actions for common tasks</li>
                <li>Generates structured PDF reports to download</li>
                <li>Matches your brand and product look</li>
            </ul>
        </div>
    </div>

    <div style="margin-top: 26px;">${embedded2}</div>
    <div class="shot-cap">Example: an embedded assistant summarizing records and producing reports inside a live business platform.</div>
  </div>
  <div class="footnote"><span>Intelligent Business Assistant</span><span>In Action — Embedded in Product</span></div>
</div>

<!-- ====================== PAGE 5 — USE CASES + VALUE + CTA ====================== -->
<div class="page">
  <div class="pad">
    <div class="eyebrow">Where it fits</div>
    <h2>Built for the work that eats your team's day.</h2>
    <div class="uc">
        <div class="uc-item"><div class="h"><span class="e">⚖️</span><b>Legal & Compliance</b></div><p>Summarize cases, consolidate exposure across records, and generate risk reports on demand.</p></div>
        <div class="uc-item"><div class="h"><span class="e">💰</span><b>Finance</b></div><p>Query figures, build statements, and email period reports without touching a spreadsheet.</p></div>
        <div class="uc-item"><div class="h"><span class="e">📈</span><b>Sales & CRM</b></div><p>Surface top customers, revenue trends, and pipeline answers in seconds.</p></div>
        <div class="uc-item"><div class="h"><span class="e">🏬</span><b>Operations</b></div><p>Pull inventory, orders, and performance data straight from your systems.</p></div>
        <div class="uc-item"><div class="h"><span class="e">🤝</span><b>Customer Support</b></div><p>Answer account questions and deliver documents instantly, 24/7.</p></div>
        <div class="uc-item"><div class="h"><span class="e">📁</span><b>Back Office</b></div><p>Read incoming documents, extract data, and route polished reports to the right inbox.</p></div>
    </div>

    <div class="metrics">
        <div class="metric"><div class="big">24/7</div><div class="lbl">Always on — no breaks, no queues</div></div>
        <div class="metric"><div class="big">Seconds</div><div class="lbl">From request to finished report</div></div>
        <div class="metric"><div class="big">100%</div><div class="lbl">Tailored to your data & brand</div></div>
    </div>

    <div class="cta">
        <h2>Let's build yours.</h2>
        <p>Every business is different — so every assistant is. Tell us the tasks that slow your team down, and we'll deliver an assistant that handles them, on the channels you already use.</p>
        <span class="pill">Get started today</span>
    </div>
  </div>
  <div class="footnote"><span>Intelligent Business Assistant</span><span>Use Cases & Next Steps</span></div>
</div>

</body>
</html>
`;

async function run() {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    const useEnv = envPath && fs.existsSync(envPath);

    const browser = await puppeteer.launch({
        headless: true,
        ...(useEnv ? { executablePath: envPath } : { channel: "chrome" }),
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
        path: OUTPUT,
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
    });
    await browser.close();
    console.log(`✅ Brochure generated: ${OUTPUT}`);
}

run().catch((e) => {
    console.error("❌ Failed to generate brochure:", e);
    process.exit(1);
});
