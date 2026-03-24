import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "../utils/database.js";

const server = new Server({ name: "cnpj-searcher", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search_cnpj",
                description: "Busca informações de uma empresa no Brasil EXCLUSIVAMENTE pelo CNPJ. Se não encontrar localmente, busca na BrasilAPI e salva.",
                inputSchema: {
                    type: "object",
                    properties: {
                        cnpj: { type: "string", description: "O CNPJ da empresa (ex: 51510300000151)" },
                        userPhoneNumber: { type: "string", description: "O número de telefone do utilizador" }
                    },
                    required: ["cnpj", "userPhoneNumber"]
                }
            },
            // 👇 NOVA FERRAMENTA DE BUSCA LOCAL LIVRE 👇
            {
                name: "search_saved_companies",
                description: "Pesquisa empresas JÁ SALVAS no banco de dados local do usuário usando qualquer termo (Razão Social, Nome Fantasia, ou Endereço). Use esta ferramenta PRIMEIRO quando o usuário perguntar sobre uma empresa pelo NOME.",
                inputSchema: {
                    type: "object",
                    properties: {
                        searchTerm: { type: "string", description: "O termo de busca (ex: OXIPRO, ou nome da rua)" },
                        userPhoneNumber: { type: "string", description: "O número de telefone do utilizador" }
                    },
                    required: ["searchTerm", "userPhoneNumber"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const db = await getDb();

    // --- FERRAMENTA 1: BUSCA POR CNPJ (A que você já tinha) ---
    if (request.params.name === "search_cnpj") {
        const { cnpj, userPhoneNumber } = request.params.arguments as any;
        const cleanCnpj = cnpj.replace(/\D/g, '');
        
        try {
            const existingCompany = await db.get(`SELECT * FROM cnpj_searches WHERE cnpj = ? AND userPhoneNumber = ?`, [cleanCnpj, userPhoneNumber]);

            if (existingCompany) {
                return { content: [{ type: "text", text: `[BANCO LOCAL] CNPJ: ${cleanCnpj}\nRazão Social: ${existingCompany.razao_social}\nNome Fantasia: ${existingCompany.nome_fantasia}\nCNAE: ${existingCompany.cnae_descricao} (${existingCompany.cnae_codigo})\nEndereço: ${existingCompany.endereco}` }] };
            }

            const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`, {
                headers: { "User-Agent": "WGPT-Assistente/1.0", "Accept": "application/json" }
            });
            
            if (!response.ok) throw new Error(`Erro na API. CNPJ não encontrado.`);

            const data = await response.json();
            const enderecoFormatado = `${data.logradouro}, ${data.numero} - ${data.municipio}/${data.uf}`;

            await db.run(`
                INSERT INTO cnpj_searches (userPhoneNumber, cnpj, razao_social, nome_fantasia, cnae_descricao, cnae_codigo, situacao_cadastral, endereco)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [userPhoneNumber, cleanCnpj, data.razao_social, data.nome_fantasia || 'N/A', data.cnae_fiscal_descricao, data.cnae_fiscal, data.descricao_situacao_cadastral, enderecoFormatado]);

            return { content: [{ type: "text", text: `[BRASIL API] Dados salvos:\nCNPJ: ${cleanCnpj}\nRazão Social: ${data.razao_social}\nCNAE: ${data.cnae_fiscal_descricao}\nEndereço: ${enderecoFormatado}` }] };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
        }
    }

    // --- FERRAMENTA 2: BUSCA LIVRE (NOVIDADE) ---
    if (request.params.name === "search_saved_companies") {
        const { searchTerm, userPhoneNumber } = request.params.arguments as any;
        
        // Adiciona os '%' para o comando LIKE do SQL (busca em qualquer parte do texto)
        const likeTerm = `%${searchTerm}%`;

        try {
            // Busca na tabela comparando com vários campos
            const results = await db.all(
                `SELECT * FROM cnpj_searches 
                 WHERE userPhoneNumber = ? 
                 AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR endereco LIKE ?)
                 LIMIT 5`,
                [userPhoneNumber, likeTerm, likeTerm, likeTerm]
            );

            if (results.length === 0) {
                return { content: [{ type: "text", text: `Nenhuma empresa encontrada no seu banco de dados com o termo: "${searchTerm}".` }] };
            }

            // Monta o texto de resposta com todas as empresas encontradas
            let resultText = `Encontrei ${results.length} empresa(s) salva(s) no seu banco de dados:\n\n`;
            results.forEach((emp, index) => {
                resultText += `${index + 1}. CNPJ: ${emp.cnpj}\n`;
                resultText += `   Razão Social: ${emp.razao_social}\n`;
                resultText += `   Nome Fantasia: ${emp.nome_fantasia}\n`;
                resultText += `   CNAE: ${emp.cnae_descricao} (${emp.cnae_codigo})\n`;
                resultText += `   Endereço: ${emp.endereco}\n\n`;
            });

            return { content: [{ type: "text", text: resultText }] };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Erro ao buscar no banco: ${error.message}` }], isError: true };
        }
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);