import { Pool } from "pg";
import { ClientAdapter } from "../core/types.js";

/**
 * Esvazia a tabela notification_outbox enviando as mensagens pendentes pelo
 * adapter (WhatsApp). O job de assinaturas escreve na outbox; este poller, que
 * roda dentro do bot (dono da conexão), entrega. Se o envio falhar, a linha
 * continua pendente e é tentada de novo no próximo ciclo.
 */
export function startOutboxPoller(pool: Pool, adapter: ClientAdapter, intervalMs = 30000): void {
    const tick = async () => {
        try {
            const r = await pool.query(
                `SELECT id, chat_id, message FROM notification_outbox
                 WHERE enviado = FALSE ORDER BY id LIMIT 10`
            );
            for (const row of r.rows) {
                try {
                    await adapter.sendText(row.chat_id, row.message);
                    await pool.query(
                        `UPDATE notification_outbox SET enviado = TRUE, sent_at = now() WHERE id = $1`,
                        [row.id]
                    );
                    console.log(`📤 Outbox: aviso ${row.id} enviado para ${row.chat_id}`);
                } catch (err) {
                    console.error(`❌ Outbox: falha ao enviar ${row.id} (tenta de novo):`, err);
                }
            }
        } catch (err) {
            console.error("❌ Outbox poller: erro ao consultar a fila:", err);
        }
    };

    setInterval(tick, intervalMs);
    console.log(`📬 Outbox poller ativo (a cada ${intervalMs / 1000}s).`);
}
