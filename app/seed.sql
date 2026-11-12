-- Seed Data for War Tiket Konser (PostgreSQL)

-- ============================================================================
-- 1. SEED USERS (5 Demo Accounts + 1,000 k6 Dummy Accounts)
-- ============================================================================

-- 5 Akun Demo Siap Login untuk Pengujian Dosen & Presentasi
INSERT INTO users (id, name, email, password, phone, id_card, role)
VALUES 
    (1, 'Dr. Ir. Budi Santoso, M.Kom', 'dosen@wartiket.id', 'password123', '081122334455', '3171010101750001', 'lecturer'),
    (2, 'Kelompok 1 Cloud Lead', 'mahasiswa1@wartiket.id', 'password123', '081234567890', '3171020202990002', 'student'),
    (3, 'Kelompok 1 DevOps Engineer', 'mahasiswa2@wartiket.id', 'password123', '081298765432', '3171030303980003', 'student'),
    (4, 'Siti Rahmawati (VIP Buyer)', 'vip.buyer@gmail.com', 'password123', '081345678901', '3171040404950004', 'vip'),
    (5, 'Andi Pratama (Festival Goer)', 'festival.fan@gmail.com', 'password123', '081456789012', '3171050505970005', 'user')
ON CONFLICT (email) DO UPDATE SET 
    name = EXCLUDED.name,
    password = EXCLUDED.password;

-- 1.000 Akun Dummy untuk Pengujian Beban k6 Load Testing (user1@test.com s.d. user1000@test.com)
INSERT INTO users (id, name, email, password, phone, id_card, role)
SELECT 
    i + 5,
    'k6 Test User ' || i,
    'user' || i || '@test.com',
    'password123',
    '081' || LPAD(i::text, 8, '0'),
    '3171' || LPAD(i::text, 12, '0'),
    'tester'
FROM generate_series(1, 1000) AS s(i)
ON CONFLICT (email) DO NOTHING;

-- Reset sequence users_id_seq agar auto-increment ID aman
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

INSERT INTO users (name, email, password, phone, id_card, role)
VALUES
    ('Admin WarTiket', 'admin@wartiket.id', 'password123', '081100000001', '3171000000000001', 'admin'),
    ('User Penonton', 'user@wartiket.id', 'password123', '081100000002', '3171000000000002', 'user')
ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role;

-- ============================================================================
-- 2. SEED CONCERTS (Minimal 3 Jadwal Konser)
-- ============================================================================
INSERT INTO concerts (id, title, artist, venue, concert_date, price, total_seats, available_seats, image_url)
VALUES 
    (
        1, 
        'Coldplay - Music of the Spheres World Tour', 
        'Coldplay', 
        'Stadion Utama Gelora Bung Karno (GBK), Jakarta', 
        '15 Desember 2026, 19:30 WIB', 
        1500000, 
        500, 
        495, 
        'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80'
    ),
    (
        2, 
        'Sheila on 7 - Tunggu Aku Di Jakarta', 
        'Sheila on 7', 
        'JIExpo Kemayoran Open Space, Jakarta', 
        '20 Januari 2027, 20:00 WIB', 
        750000, 
        500, 
        497, 
        'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80'
    ),
    (
        3, 
        'Taylor Swift - The Eras Tour Jakarta', 
        'Taylor Swift', 
        'Jakarta International Stadium (JIS), Jakarta', 
        '28 Februari 2027, 19:00 WIB', 
        2250000, 
        500, 
        496, 
        'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80'
    )
ON CONFLICT (id) DO UPDATE SET 
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    venue = EXCLUDED.venue,
    concert_date = EXCLUDED.concert_date,
    price = EXCLUDED.price,
    total_seats = EXCLUDED.total_seats;

SELECT setval('concerts_id_seq', (SELECT MAX(id) FROM concerts));

-- ============================================================================
-- 3. SEED SEATS (Grid Visual A-E x 12 = 60 Kursi Denah + Festival Seats)
-- ============================================================================

-- Konser 1: Coldplay
-- Grid 60 Kursi visual (Baris A s/d E, Kolom 01 s/d 12)
INSERT INTO seats (concert_id, seat_number, category, status, price)
SELECT 
    1,
    row_char || '-' || LPAD(col::text, 2, '0'),
    CASE WHEN row_char IN ('A', 'B') THEN 'VIP CAT 1' ELSE 'REGULAR CAT 2' END,
    'Available',
    1500000
FROM (VALUES ('A'), ('B'), ('C'), ('D'), ('E')) AS rows(row_char)
CROSS JOIN generate_series(1, 12) AS col
ON CONFLICT (concert_id, seat_number) DO NOTHING;

-- Tambahan Festival / General Seats untuk Load Test 1.000 VU
INSERT INTO seats (concert_id, seat_number, category, status, price)
SELECT 
    1,
    'FEST-' || LPAD(i::text, 3, '0'),
    'FESTIVAL STANDING',
    'Available',
    1500000
FROM generate_series(1, 440) AS s(i)
ON CONFLICT (concert_id, seat_number) DO NOTHING;

-- Konser 2: Sheila on 7
INSERT INTO seats (concert_id, seat_number, category, status, price)
SELECT 
    2,
    row_char || '-' || LPAD(col::text, 2, '0'),
    CASE WHEN row_char IN ('A', 'B') THEN 'VIP FEST' ELSE 'REGULAR FEST' END,
    'Available',
    750000
FROM (VALUES ('A'), ('B'), ('C'), ('D'), ('E')) AS rows(row_char)
CROSS JOIN generate_series(1, 12) AS col
ON CONFLICT (concert_id, seat_number) DO NOTHING;

INSERT INTO seats (concert_id, seat_number, category, status, price)
SELECT 
    2,
    'FEST-' || LPAD(i::text, 3, '0'),
    'FESTIVAL STANDING',
    'Available',
    750000
FROM generate_series(1, 440) AS s(i)
ON CONFLICT (concert_id, seat_number) DO NOTHING;

-- Konser 3: Taylor Swift
INSERT INTO seats (concert_id, seat_number, category, status, price)
SELECT 
    3,
    row_char || '-' || LPAD(col::text, 2, '0'),
    CASE WHEN row_char IN ('A', 'B') THEN 'CAT 1 VIP' ELSE 'CAT 2 STADIUM' END,
    'Available',
    2250000
FROM (VALUES ('A'), ('B'), ('C'), ('D'), ('E')) AS rows(row_char)
CROSS JOIN generate_series(1, 12) AS col
ON CONFLICT (concert_id, seat_number) DO NOTHING;

INSERT INTO seats (concert_id, seat_number, category, status, price)
SELECT 
    3,
    'FEST-' || LPAD(i::text, 3, '0'),
    'CAT 3 FLOOR',
    'Available',
    2250000
FROM generate_series(1, 440) AS s(i)
ON CONFLICT (concert_id, seat_number) DO NOTHING;

-- Tandai beberapa kursi sample awal sebagai 'Booked' untuk demo visual warna merah
UPDATE seats SET status = 'Booked', locked_by = 4 WHERE concert_id = 1 AND seat_number IN ('A-03', 'A-04', 'B-07', 'C-05', 'D-10');
UPDATE seats SET status = 'Booked', locked_by = 5 WHERE concert_id = 2 AND seat_number IN ('A-01', 'B-05', 'C-08');
UPDATE seats SET status = 'Booked', locked_by = 4 WHERE concert_id = 3 AND seat_number IN ('A-02', 'A-05', 'B-09', 'E-12');

-- Update real sisa kuota kursi yang tersedia pada tabel concerts
UPDATE concerts c
SET available_seats = (
    SELECT COUNT(*) 
    FROM seats s 
    WHERE s.concert_id = c.id AND s.status = 'Available'
);

-- ============================================================================
-- 4. SEED INITIAL TRANSACTIONS (Sample Riwayat Demo)
-- ============================================================================
INSERT INTO transactions (order_id, user_id, concert_id, seat_id, seat_number, amount, status, server_instance_id)
SELECT 
    'TRX-INIT-001', 4, 1, id, seat_number, price, 'COMPLETED', 'swarm-worker-init'
FROM seats WHERE concert_id = 1 AND seat_number = 'A-03'
ON CONFLICT (order_id) DO NOTHING;

INSERT INTO transactions (order_id, user_id, concert_id, seat_id, seat_number, amount, status, server_instance_id)
SELECT 
    'TRX-INIT-002', 5, 2, id, seat_number, price, 'COMPLETED', 'swarm-worker-init'
FROM seats WHERE concert_id = 2 AND seat_number = 'A-01'
ON CONFLICT (order_id) DO NOTHING;
