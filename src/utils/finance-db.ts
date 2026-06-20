import { Pool } from "pg";

// Único usuário por enquanto; mantém a coluna para multiusuário no futuro.
export const FINANCE_USER_ID = process.env.FINANCE_USER_ID || process.env.TASK_USER_ID || "eduardo";

const DEFAULT_CATEGORIES: Array<[string, string]> = [
    ["Alimentação", "🍽️"],
    ["Transporte", "🚗"],
    ["Moradia", "🏠"],
    ["Lazer", "🎉"],
    ["Saúde", "🩺"],
    ["Assinaturas", "📺"],
    ["Compras", "🛍️"],
    ["Outros", "📦"],
];

/** Cria um Pool do Postgres (SSL relaxado em conexões remotas tipo Supabase). */
export function createFinancePool(): Pool {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL não definida no .env (necessária para o financeiro)");
    }
    const useSSL = !/localhost|127\.0\.0\.1/.test(connectionString);
    return new Pool({ connectionString, ssl: useSSL ? { rejectUnauthorized: false } : undefined });
}

// ── Helpers de data/dinheiro (fuso de Brasília) ─────────────────────────────
export const pad2 = (n: number) => n.toString().padStart(2, "0");
export const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const monthStartISO = () => `${hojeISO().slice(0, 7)}-01`;
export const formatBRL = (centavos: number) =>
    (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Cria as tabelas (idempotente) e semeia as categorias padrão. */
export async function ensureFinanceSchema(pool: Pool): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            nome TEXT NOT NULL,
            emoji TEXT DEFAULT '',
            ativo BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT now()
        );
    `);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS categories_user_nome_unique
        ON categories (user_id, lower(nome));
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS expenses (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            valor_centavos INTEGER NOT NULL,
            descricao TEXT NOT NULL,
            categoria_id INTEGER REFERENCES categories(id),
            data DATE NOT NULL,
            metodo TEXT,
            origem TEXT NOT NULL DEFAULT 'manual',
            subscription_id INTEGER,
            created_at TIMESTAMPTZ DEFAULT now()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            descricao TEXT NOT NULL,
            valor_centavos INTEGER NOT NULL,
            categoria_id INTEGER REFERENCES categories(id),
            dia_cobranca INTEGER NOT NULL,
            metodo TEXT,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            ultima_cobranca DATE,
            created_at TIMESTAMPTZ DEFAULT now()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notification_outbox (
            id SERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
            message TEXT NOT NULL,
            enviado BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT now(),
            sent_at TIMESTAMPTZ
        );
    `);

    for (const [nome, emoji] of DEFAULT_CATEGORIES) {
        await pool.query(
            `INSERT INTO categories (user_id, nome, emoji)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, lower(nome)) DO NOTHING`,
            [FINANCE_USER_ID, nome, emoji]
        );
    }
}
