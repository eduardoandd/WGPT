import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import nodemailer from 'nodemailer';
import fs from 'fs';
import "dotenv/config";

const server = new Server({ name: "email-sender", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [{
            name: "send_email",
            description: "Envia um e-mail para um destinatário, opcionalmente com um ficheiro anexo. Use para enviar relatórios, receitas ou documentos a pedido do utilizador.",
            inputSchema: {
                type: "object",
                properties: {
                    to: { type: "string", description: "Endereço de e-mail do destinatário" },
                    subject: { type: "string", description: "Assunto do e-mail" },
                    body: { type: "string", description: "Corpo do e-mail em texto" },
                    attachmentPath: { type: "string", description: "Caminho local do ficheiro para anexar (opcional). Use o caminho que obteve da geração do PDF ou do ficheiro enviado." }
                },
                required: ["to", "subject", "body"]
            }
        }]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "send_email") {
        const { to, subject, body, attachmentPath } = request.params.arguments as any;

        try {
            // Configuração do Nodemailer (Exemplo para Gmail)
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER, 
                    pass: process.env.EMAIL_PASS  
                }
            });

            const mailOptions: any = {
                from: process.env.EMAIL_USER,
                to,
                subject,
                text: body,
            };

            // Se a IA enviar um caminho de anexo, verifica se existe e anexa
            if (attachmentPath) {
                if (fs.existsSync(attachmentPath)) {
                    mailOptions.attachments = [{ path: attachmentPath }];
                } else {
                    return { 
                        content: [{ type: "text", text: `Erro: O anexo não foi encontrado no caminho especificado: ${attachmentPath}` }], 
                        isError: true 
                    };
                }
            }

            await transporter.sendMail(mailOptions);

            return {
                content: [{ type: "text", text: `Sucesso! O e-mail foi enviado para ${to} com sucesso.` }]
            };

        } catch (error: any) {
            return { 
                content: [{ type: "text", text: `Erro ao enviar e-mail: ${error.message}` }], 
                isError: true 
            };
        }
    }

    return {
        content: [{ type: "text", text: `Ferramenta desconhecida: ${request.params.name}` }],
        isError: true
    };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);