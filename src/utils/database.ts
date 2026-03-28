// Exemplo de como deve ficar no seu src/utils/database.ts

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let dbInstance: any = null;

export async function getDb() {
    // Se a ligação já existir, devolve a mesma (padrão Singleton)
    if (dbInstance) {
        return dbInstance;
    }

    // Abre a ligação com o SQLite
    dbInstance = await open({
        filename: './librarian.sqlite', // ou o nome da sua base de dados
        driver: sqlite3.Database
    });

    // 🔥 ADICIONE ISTO: Cria a tabela de jobs se ela ainda não existir
    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chatId TEXT NOT NULL,
            status TEXT NOT NULL,
            resultado TEXT,
            notificado INTEGER DEFAULT 0,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    console.log("✅ Base de dados conectada e tabelas verificadas.");
    return dbInstance;
}