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

// Espelha o computeNotifyTime do app: a notificação dispara X antes do horário
// da tarefa. Padrão "30 minutos antes" quando há horário.
const NOTIFY_OFFSET_MIN: Record<string, number | null> = {
    "30 minutos antes": 30,
    "1 hora antes": 60,
    "2 horas antes": 120,
    "Não exibir notificações": null,
};

const pad2 = (n: number) => n.toString().padStart(2, '0');

/** Vazia quando não há horário; senão um valor válido, caindo em "30 minutos antes". */
function resolveNotifyOption(hasTime: boolean, option: any): string {
    if (!hasTime) return "";
    return option in NOTIFY_OFFSET_MIN ? option : "30 minutos antes";
}

/** Instante da notificação a partir do horário da tarefa e da opção. */
function computeNotificationTime(taskTime: Date | null, option: string): Date | null {
    if (!taskTime) return null;
    const offset = NOTIFY_OFFSET_MIN[option];
    if (offset == null) return null;
    return new Date(taskTime.getTime() - offset * 60_000);
}

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
                        notifyOption: {
                            type: "string",
                            enum: ["30 minutos antes", "1 hora antes", "2 horas antes", "Não exibir notificações"],
                            description: "Quando notificar antes do horário da tarefa. Só faz sentido com timeISO. Se o usuário não pedir nada específico, OMITA este campo — o padrão é '30 minutos antes'. Use 'Não exibir notificações' se o usuário disser que não quer ser lembrado."
                        }
                    },
                    required: ["description", "dateISO"]
                }
            },
            {
                name: "update_task",
                description: "Edita uma tarefa existente: horário, data, descrição ou notificação. Use quando o usuário pedir para mudar, adiar, trocar ou corrigir algo de uma tarefa que já existe. Forneça SOMENTE os campos que mudam — os demais são mantidos. Requer o taskId (obtenha com list_tasks_by_date).",
                inputSchema: {
                    type: "object",
                    properties: {
                        taskId: { type: "string", description: "ID do documento da tarefa no Firestore (obtido via list_tasks_by_date)." },
                        description: { type: "string", description: "Nova descrição. Omita para manter a atual." },
                        dateISO: { type: "string", description: "Nova data no formato YYYY-MM-DD. Omita para manter a atual." },
                        timeISO: { type: "string", description: "Novo horário no formato HH:MM. Omita para manter o atual." },
                        notifyOption: {
                            type: "string",
                            enum: ["30 minutos antes", "1 hora antes", "2 horas antes", "Não exibir notificações"],
                            description: "Nova preferência de notificação. Omita para manter a atual."
                        }
                    },
                    required: ["taskId"]
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
            const { description, dateISO, timeISO, notifyOption } = args as any;

            const taskDate = new Date(`${dateISO}T12:00:00`);
            const taskTime = timeISO ? new Date(`${dateISO}T${timeISO}:00`) : null;
            const option = resolveNotifyOption(!!taskTime, notifyOption);
            const notificationTime = computeNotificationTime(taskTime, option);

            await db.collection('tasks').add({
                description,
                completed: false,
                date: Timestamp.fromDate(taskDate),
                day: taskDate.getDate(),
                month: taskDate.getMonth() + 1,
                year: taskDate.getFullYear(),
                notify: notificationTime != null,
                fullDay: !timeISO,
                taskTime: taskTime ? Timestamp.fromDate(taskTime) : null,
                notificationTime: notificationTime ? Timestamp.fromDate(notificationTime) : null,
                notifyOption: option,
                creationDate: Timestamp.fromDate(new Date()),
                alterationDate: Timestamp.fromDate(new Date()),
                userId: TASK_USER_ID,
            });

            const timeLabel = timeISO ? ` às ${timeISO}` : '';
            return {
                content: [{ type: "text", text: `Tarefa "${description}" criada com sucesso para ${dateISO}${timeLabel}.` }]
            };
        }

        if (name === "update_task") {
            const { taskId, description, dateISO, timeISO, notifyOption } = args as any;

            const docRef = db.collection('tasks').doc(taskId);
            const snap = await docRef.get();
            if (!snap.exists) {
                return { content: [{ type: "text", text: `Tarefa ${taskId} não encontrada.` }], isError: true };
            }
            const current = snap.data()!;

            // Data efetiva: a nova, ou a atual reconstruída de day/month/year.
            const effDate = dateISO ?? `${current.year}-${pad2(current.month)}-${pad2(current.day)}`;

            // Horário efetivo: o novo; senão o atual (do taskTime); senão dia inteiro.
            let effTime: string | null;
            if (timeISO !== undefined) {
                effTime = timeISO || null;
            } else if (current.taskTime) {
                const d = (current.taskTime as Timestamp).toDate();
                effTime = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
            } else {
                effTime = null;
            }

            const taskDate = new Date(`${effDate}T12:00:00`);
            const taskTime = effTime ? new Date(`${effDate}T${effTime}:00`) : null;

            // Opção de notificação: a nova, ou a atual (cai no padrão se inválida).
            const rawOption = notifyOption !== undefined ? notifyOption : current.notifyOption;
            const option = resolveNotifyOption(!!taskTime, rawOption);
            const notificationTime = computeNotificationTime(taskTime, option);

            await docRef.update({
                description: description ?? current.description,
                date: Timestamp.fromDate(taskDate),
                day: taskDate.getDate(),
                month: taskDate.getMonth() + 1,
                year: taskDate.getFullYear(),
                notify: notificationTime != null,
                fullDay: !effTime,
                taskTime: taskTime ? Timestamp.fromDate(taskTime) : null,
                notificationTime: notificationTime ? Timestamp.fromDate(notificationTime) : null,
                notifyOption: option,
                alterationDate: Timestamp.fromDate(new Date()),
            });

            const finalDesc = description ?? current.description;
            const timeLabel = effTime ? ` às ${effTime}` : ' (dia inteiro)';
            return {
                content: [{ type: "text", text: `Tarefa "${finalDesc}" atualizada para ${effDate}${timeLabel}.` }]
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
