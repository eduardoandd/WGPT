// src/utils/async-task.ts
import crypto from 'crypto';

export class AsyncTaskManager {
    private tasks = new Map<string, { status: string, result?: any, error?: string }>();

    /**
     * Inicia a execução de uma promessa em background e devolve um Task ID.
     */
    public execute(taskPromise: Promise<any>): string {
        const taskId = crypto.randomUUID();
        this.tasks.set(taskId, { status: "pending" });

        taskPromise
            .then(result => {
                this.tasks.set(taskId, { status: "completed", result });
                console.log(`✅ Task Assíncrona [${taskId}] concluída com sucesso!`);
            })
            .catch(err => {
                console.error(`❌ Erro na Task Assíncrona [${taskId}]: ${err.message}`);
                this.tasks.set(taskId, { status: "error", error: err.message });
            });

        return taskId;
    }

    /**
     * Verifica o estado da tarefa. Formata automaticamente a resposta para a IA.
     */
    public check(taskId: string): any {
        const task = this.tasks.get(taskId);

        if (!task) {
            return { content: [{ type: "text", text: `Task ID não encontrado: ${taskId}` }], isError: true };
        }

        if (task.status === "pending") {
            return { content: [{ type: "text", text: `A tarefa ${taskId} ainda está em processamento (pending). Por favor, aguarde mais um pouco e consulte novamente.` }] };
        }

        if (task.status === "error") {
            this.tasks.delete(taskId); // Limpa da memória
            return { content: [{ type: "text", text: `A tarefa falhou com o erro: ${task.error}` }], isError: true };
        }

        // Se estiver "completed"
        let jsonResult = typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2);
        
        // Trunca se for muito grande para não rebentar os tokens da IA
        if (jsonResult.length > 8000) {
            jsonResult = jsonResult.substring(0, 8000) + "\n... [RESULTADO TRUNCADO DEVIDO AO TAMANHO]";
        }

        this.tasks.delete(taskId); // Limpa da memória após sucesso
        return { content: [{ type: "text", text: `Tarefa concluída com sucesso! Resultado:\n${jsonResult}` }] };
    }
}