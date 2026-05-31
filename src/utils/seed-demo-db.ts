import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

async function seed() {
    const db = await open({
        filename: path.resolve(process.cwd(), 'demo-company.sqlite'),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            city TEXT NOT NULL,
            country TEXT NOT NULL,
            segment TEXT NOT NULL,
            joined_date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            unit_price REAL NOT NULL,
            stock_quantity INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            department TEXT NOT NULL,
            position TEXT NOT NULL,
            salary REAL NOT NULL,
            hire_date TEXT NOT NULL,
            manager_id INTEGER
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            employee_id INTEGER NOT NULL,
            order_date TEXT NOT NULL,
            status TEXT NOT NULL,
            total_amount REAL NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        );
    `);

    // Customers
    await db.exec(`DELETE FROM customers; DELETE FROM products; DELETE FROM employees; DELETE FROM orders; DELETE FROM order_items;`);

    const customers = [
        ['Alice Johnson', 'alice@email.com', 'New York', 'USA', 'Enterprise', '2022-03-15'],
        ['Bob Martinez', 'bob@email.com', 'Los Angeles', 'USA', 'SMB', '2022-06-20'],
        ['Carol White', 'carol@email.com', 'Chicago', 'USA', 'Enterprise', '2021-11-10'],
        ['David Lee', 'david@email.com', 'Toronto', 'Canada', 'SMB', '2023-01-05'],
        ['Emma Brown', 'emma@email.com', 'London', 'UK', 'Enterprise', '2021-08-22'],
        ['Frank Wilson', 'frank@email.com', 'San Francisco', 'USA', 'Startup', '2023-04-18'],
        ['Grace Kim', 'grace@email.com', 'Seoul', 'South Korea', 'Enterprise', '2022-09-30'],
        ['Henry Clark', 'henry@email.com', 'Sydney', 'Australia', 'SMB', '2023-02-14'],
        ['Isabella Scott', 'isabella@email.com', 'Berlin', 'Germany', 'Startup', '2022-12-01'],
        ['James Turner', 'james@email.com', 'Miami', 'USA', 'SMB', '2021-07-19'],
        ['Karen Hall', 'karen@email.com', 'Houston', 'USA', 'Enterprise', '2022-05-08'],
        ['Liam Adams', 'liam@email.com', 'Vancouver', 'Canada', 'Startup', '2023-06-11'],
    ];

    for (const c of customers) {
        await db.run(`INSERT INTO customers (name, email, city, country, segment, joined_date) VALUES (?, ?, ?, ?, ?, ?)`, c);
    }

    // Products
    const products = [
        ['NexaCloud Pro', 'Software', 299.99, 150],
        ['NexaCloud Basic', 'Software', 99.99, 500],
        ['DataSync Enterprise', 'Software', 799.99, 80],
        ['SecureVault License', 'Security', 199.99, 200],
        ['Analytics Dashboard', 'Software', 149.99, 300],
        ['API Gateway Pack', 'Infrastructure', 499.99, 60],
        ['Support Package Gold', 'Service', 999.99, 100],
        ['Support Package Silver', 'Service', 399.99, 200],
        ['Training Bundle', 'Education', 249.99, 400],
        ['Custom Integration', 'Service', 1499.99, 30],
    ];

    for (const p of products) {
        await db.run(`INSERT INTO products (name, category, unit_price, stock_quantity) VALUES (?, ?, ?, ?)`, p);
    }

    // Employees
    const employees = [
        ['Sarah Connor', 'Sales', 'Sales Manager', 85000, '2019-03-01', null],
        ['Tom Bradley', 'Sales', 'Account Executive', 62000, '2020-06-15', 1],
        ['Nina Patel', 'Sales', 'Account Executive', 60000, '2021-02-10', 1],
        ['Mike Johnson', 'Engineering', 'CTO', 150000, '2018-01-10', null],
        ['Anna Lee', 'Engineering', 'Senior Developer', 110000, '2019-08-20', 4],
        ['Chris Evans', 'Engineering', 'Developer', 88000, '2021-05-12', 4],
        ['Rachel Green', 'Marketing', 'Marketing Manager', 78000, '2020-03-25', null],
        ['Paul Davis', 'Finance', 'CFO', 140000, '2018-04-01', null],
        ['Laura Wilson', 'Finance', 'Analyst', 72000, '2022-01-18', 8],
        ['Kevin Moore', 'Support', 'Support Lead', 65000, '2020-09-30', null],
    ];

    for (const e of employees) {
        await db.run(`INSERT INTO employees (name, department, position, salary, hire_date, manager_id) VALUES (?, ?, ?, ?, ?, ?)`, e);
    }

    // Orders & items
    const orders = [
        [1, 2, '2024-01-10', 'completed', 1299.97],
        [2, 3, '2024-01-15', 'completed', 499.98],
        [3, 2, '2024-02-03', 'completed', 1799.98],
        [4, 3, '2024-02-20', 'pending', 299.99],
        [5, 2, '2024-03-05', 'completed', 2499.97],
        [6, 3, '2024-03-18', 'completed', 649.98],
        [7, 2, '2024-04-02', 'cancelled', 999.99],
        [8, 3, '2024-04-25', 'completed', 3499.96],
        [9, 2, '2024-05-10', 'completed', 1149.98],
        [10, 3, '2024-05-28', 'pending', 799.99],
        [11, 2, '2024-06-07', 'completed', 2999.97],
        [12, 3, '2024-06-22', 'completed', 449.98],
        [1, 2, '2024-07-14', 'completed', 1599.98],
        [5, 3, '2024-07-30', 'completed', 1999.98],
        [3, 2, '2024-08-08', 'completed', 5499.95],
    ];

    for (const o of orders) {
        await db.run(`INSERT INTO orders (customer_id, employee_id, order_date, status, total_amount) VALUES (?, ?, ?, ?, ?)`, o);
    }

    const orderItems = [
        [1, 1, 2, 299.99], [1, 7, 1, 999.99],
        [2, 2, 3, 99.99], [2, 9, 1, 249.99],
        [3, 3, 1, 799.99], [3, 4, 5, 199.99],
        [4, 1, 1, 299.99],
        [5, 6, 1, 499.99], [5, 7, 1, 999.99], [5, 10, 1, 1499.99],
        [6, 2, 2, 99.99], [6, 5, 3, 149.99],
        [7, 7, 1, 999.99],
        [8, 10, 1, 1499.99], [8, 3, 1, 799.99], [8, 6, 1, 499.99], [8, 8, 1, 399.99],
        [9, 1, 2, 299.99], [9, 9, 1, 249.99],
        [10, 3, 1, 799.99],
        [11, 10, 1, 1499.99], [11, 7, 1, 999.99], [11, 6, 1, 499.99],
        [12, 2, 3, 99.99], [12, 9, 1, 249.99],
        [13, 3, 1, 799.99], [13, 4, 4, 199.99],
        [14, 5, 1, 149.99], [14, 6, 1, 499.99], [14, 3, 1, 799.99],
        [15, 10, 2, 1499.99], [15, 7, 1, 999.99], [15, 3, 1, 799.99],
    ];

    for (const i of orderItems) {
        await db.run(`INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)`, i);
    }

    await db.close();
    console.log('✅ Demo database seeded successfully: demo-company.sqlite');
}

seed().catch(console.error);
