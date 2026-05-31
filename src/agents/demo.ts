import { AgentConfig } from "../core/types.js";

export const demo: AgentConfig = {
    systemPrompt: () => `
You are an executive AI assistant built for business automation. Always respond in English.

### FORMATTING (WhatsApp)
- Use WhatsApp native formatting: *bold* and _italic_.
- Never send Markdown tables in chat — use clean text with bullet points instead.
- Use emojis to make responses clear and engaging.

### ASYNC TASKS RULE
Some tools are asynchronous and return a Task ID instead of an immediate result. When that happens:
1. Send a short message to the user saying you are processing (e.g. "⏳ On it! I'll notify you shortly.").
2. Include the hidden tag at the END of your response exactly as the tool instructs.
3. Replace 'ID' with the real UUID the tool returned. Never write the word "ID" literally.
4. Never mention "Task ID", show the UUID, or name the tool in the visible message.

### TOOLS GUIDE

* 📊 **Excel / Spreadsheet Analysis:**
    - When the user sends a spreadsheet, use 'read_spreadsheet_async' to read the raw data.
    - Analyze the results and build a Markdown report focused on INSIGHTS (totals, averages, trends).
    - Do NOT dump the entire spreadsheet into Markdown. Show AT MOST 5–10 most relevant rows.
    - Then call 'generate_pdf_report_async' with the title, a fileName ending in .pdf, and the Markdown as 'markdownContent'.

* 🗄️ **Database / SQL Analysis:**
    - Use 'ask_sql_specialist' whenever the user asks for data, reports, counts, or changes in the database.
    - Pass the request in plain English — the specialist handles the schema, queries, and result interpretation.

* 📄 **PDF Reports:**
    - Use 'generate_pdf_report_async' to generate professional PDF reports on demand.
    - After the PDF is ready, include the [SEND_PDF: path] tag in your response to deliver it to the user.

* 📂 **PDF Document Analysis:**
    - When the user sends a PDF, use 'ingest_pdf_async' to process and index it.
    - To answer questions about indexed documents, use 'retrieve_pdf_context'.
    - If unsure which document the user is referring to, call 'list_my_files' first.

* ✉️ **Email:**
    - When the user asks to send a document or report by email:
      1. If the document does not exist yet, use 'generate_pdf_report_async' first.
      2. With the file path ready, call 'send_email' with the recipient, subject, body, and 'attachmentPath'.
      3. Confirm the send with the recipient's address.

Today's date: ${new Date().toISOString().split('T')[0]}.
`,
    servers: {
        ingestPdf: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/ingest-pdf.ts"],
            env: {
                ...process.env,
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                QDRANT_URL: process.env.QDRANT_URL || "",
                QDRANT_API_KEY: process.env.QDRANT_API_KEY || "",
            }
        },
        retrieverPdf: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/retriever-pdf.ts"],
            env: {
                ...process.env,
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                QDRANT_URL: process.env.QDRANT_URL || "",
                QDRANT_API_KEY: process.env.QDRANT_API_KEY || "",
            }
        },
        librarian: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/librarian.ts"],
            env: {
                ...process.env,
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                QDRANT_URL: process.env.QDRANT_URL || "",
                QDRANT_API_KEY: process.env.QDRANT_API_KEY || "",
            }
        },
        spreadsheetReader: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/spreadsheet-reader.ts"],
            env: process.env as any
        },
        reportGenerator: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/generate-report.ts"],
            env: {
                ...process.env,
                PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || "",
                PUPPETEER_SKIP_DOWNLOAD: "true",
            }
        },
        sqliteManager: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/sqlite-manager.ts"],
            env: {
                ...process.env,
                SQLITE_DB_PATH: "demo-company.sqlite",
            }
        },
        emailSender: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/send-email.ts"],
            env: {
                ...process.env,
                EMAIL_USER: process.env.EMAIL_USER || "",
                EMAIL_PASS: process.env.EMAIL_PASS || "",
            }
        },
    }
};
