const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, 'chat.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency performance
db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    initial_inquiry TEXT,
    status TEXT DEFAULT 'active',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    sender TEXT NOT NULL, -- 'customer' | 'admin' | 'system'
    sender_name TEXT,
    text TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
`);

/**
 * Create a new chat room for a customer
 */
function createRoom(customerName, customerPhone, initialInquiry = '') {
  const id = uuidv4();
  const insertRoom = db.prepare(`
    INSERT INTO rooms (id, customer_name, customer_phone, initial_inquiry, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', datetime('now', 'localtime'), datetime('now', 'localtime'))
  `);
  insertRoom.run(id, customerName, customerPhone, initialInquiry);

  // If there's an initial inquiry, save it as the first message
  if (initialInquiry && initialInquiry.trim()) {
    addMessage(id, 'customer', customerName, initialInquiry.trim());
  } else {
    // Add an automated system welcome message
    addMessage(id, 'system', '시스템', `${customerName} 고객님, 환영합니다! 잠시만 기다려주시면 상담원(관리자)이 연결됩니다.`);
  }

  return getRoom(id);
}

/**
 * Get room by ID along with messages
 */
function getRoom(id) {
  const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id);
  if (!room) return null;

  const messages = db.prepare(`
    SELECT * FROM messages WHERE room_id = ? ORDER BY id ASC
  `).all(id);

  return {
    ...room,
    messages
  };
}

/**
 * Find recent active room by phone number (matches either formatted or raw digits)
 */
function findActiveRoomByPhone(phone) {
  const digits = String(phone).replace(/[^0-9]/g, '');
  return db.prepare(`
    SELECT * FROM rooms 
    WHERE (customer_phone = ? OR REPLACE(customer_phone, '-', '') = ?)
      AND status = 'active'
    ORDER BY updated_at DESC 
    LIMIT 1
  `).get(phone, digits);
}

/**
 * Update customer name if provided differently upon reconnection
 */
function updateCustomerName(id, name) {
  return db.prepare(`
    UPDATE rooms 
    SET customer_name = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(name, id);
}

/**
 * Add a message to a room
 */
function addMessage(roomId, sender, senderName, text) {
  const insert = db.prepare(`
    INSERT INTO messages (room_id, sender, sender_name, text, is_read, created_at)
    VALUES (?, ?, ?, ?, 0, datetime('now', 'localtime'))
  `);
  const result = insert.run(roomId, sender, senderName, text);

  // Update room updated_at
  db.prepare(`
    UPDATE rooms 
    SET updated_at = datetime('now', 'localtime') 
    WHERE id = ?
  `).run(roomId);

  return db.prepare(`SELECT * FROM messages WHERE id = ?`).get(result.lastInsertRowid);
}

/**
 * Mark messages in a room as read
 * If admin reads, mark messages sent by 'customer' as read (1)
 * If customer reads, mark messages sent by 'admin' as read (1)
 */
function markAsRead(roomId, readerRole) {
  const senderTarget = readerRole === 'admin' ? 'customer' : 'admin';
  const update = db.prepare(`
    UPDATE messages 
    SET is_read = 1 
    WHERE room_id = ? AND sender = ? AND is_read = 0
  `);
  return update.run(roomId, senderTarget);
}

/**
 * Get all rooms with metadata for Admin Dashboard
 */
function getAllRooms(filterStatus = null, search = null) {
  let query = `
    SELECT 
      r.id,
      r.customer_name,
      r.customer_phone,
      r.initial_inquiry,
      r.status,
      r.notes,
      r.created_at,
      r.updated_at,
      (SELECT text FROM messages WHERE room_id = r.id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages WHERE room_id = r.id ORDER BY id DESC LIMIT 1) AS last_message_at,
      (SELECT sender FROM messages WHERE room_id = r.id ORDER BY id DESC LIMIT 1) AS last_message_sender,
      (SELECT COUNT(*) FROM messages WHERE room_id = r.id AND sender = 'customer' AND is_read = 0) AS unread_count
    FROM rooms r
    WHERE 1=1
  `;
  const params = [];

  if (filterStatus && filterStatus !== 'all') {
    query += ` AND r.status = ?`;
    params.push(filterStatus);
  }

  if (search && search.trim()) {
    query += ` AND (r.customer_name LIKE ? OR r.customer_phone LIKE ?)`;
    const searchParam = `%${search.trim()}%`;
    params.push(searchParam, searchParam);
  }

  query += ` ORDER BY r.updated_at DESC`;

  return db.prepare(query).all(...params);
}

/**
 * Update room status (active / closed)
 */
function updateRoomStatus(id, status) {
  const result = db.prepare(`
    UPDATE rooms 
    SET status = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(status, id);
  return result.changes > 0;
}

/**
 * Update room admin notes
 */
function updateRoomNotes(id, notes) {
  const result = db.prepare(`
    UPDATE rooms 
    SET notes = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(notes, id);
  return result.changes > 0;
}

/**
 * Export customer data as CSV
 */
function getExportData() {
  return db.prepare(`
    SELECT 
      r.id AS '상담ID',
      r.customer_name AS '고객명',
      r.customer_phone AS '전화번호',
      r.status AS '상태',
      r.initial_inquiry AS '최초문의',
      r.notes AS '상담메모',
      r.created_at AS '시작일시',
      r.updated_at AS '최근활동',
      (SELECT COUNT(*) FROM messages WHERE room_id = r.id) AS '메시지수'
    FROM rooms r
    ORDER BY r.created_at DESC
  `).all();
}

module.exports = {
  db,
  createRoom,
  getRoom,
  findActiveRoomByPhone,
  updateCustomerName,
  addMessage,
  markAsRead,
  getAllRooms,
  updateRoomStatus,
  updateRoomNotes,
  getExportData
};
