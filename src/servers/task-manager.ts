import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import "dotenv/config";

// Inicializa Firebase Admin SDK com o arquivo de credenciais de serviço
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
    console.error("❌ FIREBASE_SERVICE_ACCOUNT_PATH não definido no .env");
    process.exit(1);
}

const TASK_USER_ID = process.env.TASK_USER_ID || "";

initializeApp({
    credential: cert(serviceAccountPath),
});

const db = getFirestore();

const server = new Server(
    { name: "task-manager", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "create_task",
                description: "Cria uma nova tarefa no aplicativo de tarefas do usuário. Use quando o usuário pedir para lembrar, criar ou agendar algo.",
                inputSchema: {
                    type: "object",
                    properties: {
                        description: { type: "string", description: "Descrição da tarefa" },
                        dateISO: { type: "string", description: "Data da tarefa no formato YYYY-MM-DD (ex: 2025-05-25)" },
                        timeISO: { type: "string", description: "Horário da tarefa no formato HH:MM (ex: 09:00). Opcional — omita se for tarefa de dia inteiro." },
                        notify: { type: "boolean", description: "Se true, o app vai notificar o usuário. Padrão: true quando houver horário." }
                    },
                    required: ["description", "dateISO"]
                }
            },
            {
                name: "list_tasks_by_date",
                description: "Lista as tarefas do usuário para uma data específica. Use quando o usuário perguntar sobre suas tarefas de um dia.",
                inputSchema: {
                    type: "object",
                    properties: {
                        dateISO: { type: "string", description: "Data para consultar no formato YYYY-MM-DD (ex: 2025-05-25)" }
                    },
                    required: ["dateISO"]
                }
            },
            {
                name: "complete_task",
                description: "Marca uma tarefa existente como concluída.",
                inputSchema: {
                    type: "object",
                    properties: {
                        taskId: { type: "string", description: "ID do documento da tarefa no Firestore" }
                    },
                    required: ["taskId"]
                }
            },
            {
                name: "delete_task",
                description: "Remove uma tarefa do aplicativo do usuário.",
                inputSchema: {
                    type: "object",
                    properties: {
                        taskId: { type: "string", description: "ID do documento da tarefa no Firestore" }
                    },
                    required: ["taskId"]
                }
            },
            {
                name: "debug_list_all_tasks",
                description: "Lista todas as tarefas do Firestore sem filtro de usuário. Use apenas para diagnóstico quando list_tasks_by_date não retornar resultados esperados.",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number", description: "Número máximo de tarefas a retornar (padrão: 5)" }
                    },
                    required: []
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        console.error(`[task-manager] Ferramenta chamada: ${name}`, JSON.stringify(args));

        if (name === "create_task") {
            const { description, dateISO, timeISO, notify } = args as any;

            const taskDate = new Date(`${dateISO}T12:00:00`);
            const taskTime = timeISO ? new Date(`${dateISO}T${timeISO}:00`) : null;
            const shouldNotify = notify ?? (timeISO ? true : false);

            await db.collection('tasks').add({
                description,
                completed: false,
                date: Timestamp.fromDate(taskDate),
                day: taskDate.getDate(),
                month: taskDate.getMonth() + 1,
                year: taskDate.getFullYear(),
                notify: shouldNotify,
                fullDay: !timeISO,
                taskTime: taskTime ? Timestamp.fromDate(taskTime) : null,
                notificationTime: taskTime ? Timestamp.fromDate(taskTime) : null,
                notifyOption: '',
                creationDate: Timestamp.fromDate(new Date()),
                alterationDate: Timestamp.fromDate(new Date()),
                userId: TASK_USER_ID,
            });

            const timeLabel = timeISO ? ` às ${timeISO}` : '';
            return {
                content: [{ type: "text", text: `Tarefa "${description}" criada com sucesso para ${dateISO}${timeLabel}.` }]
            };
        }

        if (name === "list_tasks_by_date") {
            const { dateISO } = args as any;
            const date = new Date(`${dateISO}T12:00:00`);
            const targetDay = date.getDate();
            const targetMonth = date.getMonth() + 1;
            const targetYear = date.getFullYear();

            // Query só por userId para evitar índice composto no Firestore
            const snap = await db.collection('tasks')
                .where('userId', '==', TASK_USER_ID)
                .get();

            const filtered = snap.docs.filter(doc => {
                const t = doc.data();
                return t.day === targetDay && t.month === targetMonth && t.year === targetYear;
            });

            if (filtered.length === 0) {
                return { content: [{ type: "text", text: `Nenhuma tarefa encontrada para ${dateISO}.` }] };
            }

            const tasks = filtered.map(doc => {
                const t = doc.data();
                const status = t.completed ? '✅' : '⏳';
                const time = t.taskTime
                    ? ` — ${(t.taskTime as Timestamp).toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                    : '';
                return `${status} [${doc.id}] ${t.description}${time}`;
            }).join('\n');

            return { content: [{ type: "text", text: tasks }] };
        }

        if (name === "complete_task") {
            const { taskId } = args as any;
            await db.collection('tasks').doc(taskId).update({
                completed: true,
                alterationDate: Timestamp.fromDate(new Date()),
            });
            return { content: [{ type: "text", text: `Tarefa ${taskId} marcada como concluída.` }] };
        }

        if (name === "delete_task") {
            const { taskId } = args as any;
            await db.collection('tasks').doc(taskId).delete();
            return { content: [{ type: "text", text: `Tarefa ${taskId} removida com sucesso.` }] };
        }

        if (name === "debug_list_all_tasks") {
            const limit = (args as any)?.limit ?? 5;
            const snap = await db.collection('tasks').limit(limit).get();
            if (snap.empty) {
                return { content: [{ type: "text", text: "Nenhuma tarefa encontrada no Firestore." }] };
            }
            const result = snap.docs.map(doc => {
                const t = doc.data();
                return `ID: ${doc.id} | userId: "${t.userId}" | desc: "${t.description}" | dia: ${t.day}/${t.month}/${t.year}`;
            }).join('\n');
            return { content: [{ type: "text", text: result }] };
        }

        return {
            content: [{ type: "text", text: `Ferramenta desconhecida: ${name}` }],
            isError: true
        };

    } catch (error: any) {
        console.error(`[task-manager] ERRO em ${name}:`, error);
        return {
            content: [{ type: "text", text: `Erro ao executar ${name}: ${error.message}` }],
            isError: true
        };
    }
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);