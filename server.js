const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== REST API ====================

/**
 * Create or resume customer room
 */
app.post('/api/rooms', (req, res) => {
  try {
    const { customerName, customerPhone } = req.body;
    
    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ error: '고객 이름을 입력해주세요.' });
    }
    if (!customerPhone || !customerPhone.trim()) {
      return res.status(400).json({ error: '전화번호를 입력해주세요.' });
    }

    const cleanName = customerName.trim();
    const cleanPhone = customerPhone.trim();

    // 1. Check if there is an existing ACTIVE consultation for this phone number
    const existingActiveRoom = db.findActiveRoomByPhone(cleanPhone);

    if (existingActiveRoom) {
      // Update customer name if provided differently
      if (cleanName && cleanName !== existingActiveRoom.customer_name) {
        db.updateCustomerName(existingActiveRoom.id, cleanName);
      }

      // Add a system notice that customer re-entered
      const systemNotice = db.addMessage(
        existingActiveRoom.id, 
        'system', 
        '시스템', 
        `${cleanName} 고객님이 상담에 다시 연결되었습니다.`
      );

      // Notify the room and admin console
      io.to(existingActiveRoom.id).emit('new_message', systemNotice);
      io.to('admin_channel').emit('admin_room_activity', {
        roomId: existingActiveRoom.id,
        lastMessage: systemNotice.text,
        lastMessageAt: systemNotice.created_at
      });

      const fullRoom = db.getRoom(existingActiveRoom.id);
      return res.status(200).json({
        ...fullRoom,
        isResumed: true
      });
    }

    // 2. Otherwise create a brand new room
    const room = db.createRoom(cleanName, cleanPhone, '');

    // Notify all admin consoles about new customer room
    io.to('admin_channel').emit('admin_new_room', {
      room: {
        id: room.id,
        customer_name: room.customer_name,
        customer_phone: room.customer_phone,
        initial_inquiry: '',
        status: room.status,
        created_at: room.created_at,
        updated_at: room.updated_at,
        last_message: `${cleanName} 고객님이 상담을 시작했습니다.`,
        last_message_at: room.created_at,
        unread_count: 1
      }
    });

    res.status(201).json(room);
  } catch (err) {
    console.error('Error creating or resuming room:', err);
    res.status(500).json({ error: '상담방 연결 중 오류가 발생했습니다.' });
  }
});

/**
 * Get room info and message history
 */
app.get('/api/rooms/:id', (req, res) => {
  try {
    const room = db.getRoom(req.params.id);
    if (!room) {
      return res.status(404).json({ error: '상담방을 찾을 수 없습니다.' });
    }
    res.json(room);
  } catch (err) {
    console.error('Error fetching room:', err);
    res.status(500).json({ error: '상담방 정보를 불러오지 못했습니다.' });
  }
});

/**
 * Admin: Get all rooms list with unread counts
 */
app.get('/api/admin/rooms', (req, res) => {
  try {
    const { status, search } = req.query;
    const rooms = db.getAllRooms(status, search);
    res.json(rooms);
  } catch (err) {
    console.error('Error fetching admin rooms:', err);
    res.status(500).json({ error: '목록 조회 실패' });
  }
});

/**
 * Admin: Update room status (active / closed)
 */
app.patch('/api/admin/rooms/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'closed'].includes(status)) {
      return res.status(400).json({ error: '올바르지 않은 상태값입니다.' });
    }

    const success = db.updateRoomStatus(req.params.id, status);
    if (!success) {
      return res.status(404).json({ error: '해당 상담방을 찾을 수 없습니다.' });
    }

    // Add system notification message
    const systemNotice = status === 'closed' 
      ? '상담이 종료되었습니다. 추가 문의가 있으시면 새 상담을 시작해주세요.'
      : '상담이 다시 진행 상태로 변경되었습니다.';
    
    const message = db.addMessage(req.params.id, 'system', '시스템', systemNotice);

    // Notify room participants
    io.to(req.params.id).emit('status_changed', { status, message });
    io.to('admin_channel').emit('admin_room_status_changed', { roomId: req.params.id, status });

    res.json({ success: true, status });
  } catch (err) {
    console.error('Error updating status:', err);
    res.status(500).json({ error: '상태 변경 실패' });
  }
});

/**
 * Admin: Update room notes
 */
app.patch('/api/admin/rooms/:id/notes', (req, res) => {
  try {
    const { notes } = req.body;
    const success = db.updateRoomNotes(req.params.id, notes || '');
    if (!success) {
      return res.status(404).json({ error: '해당 상담방을 찾을 수 없습니다.' });
    }
    res.json({ success: true, notes });
  } catch (err) {
    console.error('Error updating notes:', err);
    res.status(500).json({ error: '메모 저장 실패' });
  }
});

/**
 * Admin: Export customer list as CSV (UTF-8 with BOM for Excel)
 */
app.get('/api/admin/export', (req, res) => {
  try {
    const data = db.getExportData();
    if (!data || data.length === 0) {
      return res.send('\uFEFF고객명,전화번호,상태,시작일시,상담메모\n');
    }

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];

    for (const row of data) {
      const values = headers.map(header => {
        let val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
        val = val.replace(/"/g, '""');
        if (val.includes(',') || val.includes('\n') || val.includes('"')) {
          val = `"${val}"`;
        }
        return val;
      });
      csvRows.push(values.join(','));
    }

    // Prepend UTF-8 BOM so Microsoft Excel opens it cleanly without character corruption
    const csvContent = '\uFEFF' + csvRows.join('\r\n');
    const filename = `customer_consultations_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).send('CSV 내보내기 실패');
  }
});

// Routing shortcuts
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/c/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  // Join a specific chat room
  socket.on('join_room', ({ roomId, role, userName }) => {
    if (socket.currentChatRoomId && socket.currentChatRoomId !== roomId) {
      socket.leave(socket.currentChatRoomId);
    }
    socket.join(roomId);
    socket.currentChatRoomId = roomId;
    socket.roomId = roomId;
    socket.role = role;
    socket.userName = userName;

    if (role === 'admin') {
      socket.join('admin_channel');
    }

    // Mark unread messages as read
    db.markAsRead(roomId, role);

    // Notify room that messages were read
    io.to(roomId).emit('messages_read', { roomId, readerRole: role });

    // Inform admin channel of updated unread status
    io.to('admin_channel').emit('admin_room_read', { roomId });
  });

  // Admin subscribes to global admin channel
  socket.on('join_admin_channel', () => {
    socket.join('admin_channel');
  });

  // Send message
  socket.on('send_message', ({ roomId, sender, senderName, text }) => {
    if (!text || !text.trim()) return;

    const savedMessage = db.addMessage(roomId, sender, senderName, text.trim());

    // Broadcast to everyone in this room
    io.to(roomId).emit('new_message', savedMessage);

    // If sender is customer, send real-time notification to all connected admins
    if (sender === 'customer') {
      const room = db.getRoom(roomId);
      io.to('admin_channel').emit('admin_message_notification', {
        roomId,
        customerName: room ? room.customer_name : senderName,
        customerPhone: room ? room.customer_phone : '',
        message: savedMessage
      });
    } else if (sender === 'admin') {
      // Also notify admin channel so room list updates last_message
      io.to('admin_channel').emit('admin_room_activity', {
        roomId,
        lastMessage: text.trim(),
        lastMessageAt: savedMessage.created_at
      });
    }
  });

  // Read message receipt
  socket.on('mark_read', ({ roomId, role }) => {
    db.markAsRead(roomId, role);
    io.to(roomId).emit('messages_read', { roomId, readerRole: role });
    if (role === 'admin') {
      io.to('admin_channel').emit('admin_room_read', { roomId });
    }
  });

  // Typing indicator
  socket.on('typing', ({ roomId, sender, isTyping }) => {
    socket.to(roomId).emit('user_typing', { sender, isTyping });
  });

  socket.on('disconnect', () => {
    // handled automatically by socket.io
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 고객 상담 실시간 채팅 서버가 실행되었습니다!`);
  console.log(`- 고객 접속 페이지: http://localhost:${PORT}`);
  console.log(`- 관리자 대시보드: http://localhost:${PORT}/admin`);
  console.log(`===============================================`);
});
