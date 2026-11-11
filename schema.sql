-- Schema for War Tiket Konser Database (PostgreSQL)
-- Digunakan untuk Docker Swarm & Node.js Backend

-- 1. Table Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,
    phone VARCHAR(30) DEFAULT '081234567890',
    id_card VARCHAR(30) DEFAULT '3171012345670001',
    role VARCHAR(20) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. Table Concerts
CREATE TABLE IF NOT EXISTS concerts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    artist VARCHAR(100) NOT NULL,
    venue VARCHAR(150) NOT NULL,
    concert_date VARCHAR(60) NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    total_seats INT NOT NULL DEFAULT 500,
    available_seats INT NOT NULL DEFAULT 500,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Table Seats
CREATE TABLE IF NOT EXISTS seats (
    id SERIAL PRIMARY KEY,
    concert_id INT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
    seat_number VARCHAR(20) NOT NULL,
    category VARCHAR(30) DEFAULT 'CAT 1',
    status VARCHAR(20) NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Locked', 'Booked')),
    locked_by INT REFERENCES users(id) ON DELETE SET NULL,
    price NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_concert_seat UNIQUE(concert_id, seat_number)
);

CREATE INDEX IF NOT EXISTS idx_seats_concert_status ON seats(concert_id, status);

-- 4. Table Transactions
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(64) UNIQUE NOT NULL,
    user_id INT REFERENCES users(id),
    concert_id INT REFERENCES concerts(id),
    seat_id INT REFERENCES seats(id),
    seat_number VARCHAR(20),
    amount NUMERIC(12,2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
    server_instance_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

