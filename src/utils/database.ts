import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function getDb() {
    
    const db = await open({
        filename:"librarian.sqlite",
        driver:sqlite3.Database
    })

    await db.exec(`
        
        CREATE TABLE IF NOT EXISTS librarian (

            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userPhoneNumber TEXT,
            fileName TEXT,
            uploadDate TEXT,
            shortSummary TEXT,
            extension text
        )
        
    `)

    return db

}