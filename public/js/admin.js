// Admin CRM Dashboard Logic
let socket = null;
let rooms = [];
let selectedRoomId = null;
let selectedRoomData = null;
let filterStatus = 'active'; // 'all', 'active', 'closed'
let searchQuery = '';
let soundEnabled = true;
let desktopNotiEnabled = false;
let adminToken = localStorage.getItem('admin_token') || '';

// DOM Elements
const loginModal = document.getElementById('loginModal');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const loginErrorMsg = document.getElementById('loginErrorMsg');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const logoutBtn = document.getElementById('logoutBtn');

const roomListContainer = document.getElementById('roomListContainer');
const roomSearchInput = document.getElementById('roomSearchInput');
const filterTabs = document.querySelectorAll('.filter-tab');
const countAll = document.getElementById('countAll');
const countActive = document.getElementById('countActive');
const countClosed = document.getElementById('countClosed');

const noRoomSelected = document.getElementById('noRoomSelected');
const activeChatContainer = document.getElementById('activeChatContainer');

const headerCustomerAvatar = document.getElementById('headerCustomerAvatar');
const headerCustomerName = document.getElementById('headerCustomerName');
const headerCustomerPhone = document.getElementById('headerCustomerPhone');
const headerStatusBadge = document.getElementById('headerStatusBadge');
const headerCreatedAt = document.getElementById('headerCreatedAt');
const toggleStatusBtn = document.getElementById('toggleStatusBtn');
const toggleStatusText = document.getElementById('toggleStatusText');
const adminCopyCustomerLink = document.getElementById('adminCopyCustomerLink');

const adminMessagesContainer = document.getElementById('adminMessagesContainer');
const adminCustomerTyping = document.getElementById('adminCustomerTyping');
const adminMessageForm = document.getElementById('adminMessageForm');
const adminMessageInput = document.getElementById('adminMessageInput');

const metaCustomerName = document.getElementById('metaCustomerName');
const metaCustomerPhone = document.getElementById('metaCustomerPhone');
const metaInitialInquiry = document.getElementById('metaInitialInquiry');
const adminNotesTextarea = document.getElementById('adminNotesTextarea');
const saveNotesBtn = document.getElementById('saveNotesBtn');
const notesPanel = document.getElementById('notesPanel');
const toggleNotesPanelBtn = document.getElementById('toggleNotesPanelBtn');

const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundIcon = document.getElementById('soundIcon');
const soundText = document.getElementById('soundText');
const notiToggleBtn = document.getElementById('notiToggleBtn');
const adminToast = document.getElementById('adminToast');
const adminToastMsg = document.getElementById('adminToastMsg');

// --- Crisp Web Audio Chime ---
function playChime(isNewRoom = false) {
  if (!soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    if (isNewRoom) {
      // High-pitched double chime for new room arrival
      playTone(ctx, 659.25, 0, 0.15); // E5
      playTone(ctx, 880.00, 0.12, 0.25); // A5
    } else {
      // Subtle single ping for incoming message
      playTone(ctx, 523.25, 0, 0.1); // C5
      playTone(ctx, 659.25, 0.08, 0.2); // E5
    }
  } catch (e) {}
}

function playTone(ctx, freq, startTime, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
  gain.gain.setValueAtTime(0.12, ctx.currentTime + startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + startTime);
  osc.stop(ctx.currentTime + startTime + duration);
}

// --- Toast ---
function showToast(text) {
  adminToastMsg.textContent = text;
  adminToast.classList.remove('opacity-0', 'pointer-events-none');
  adminToast.classList.add('opacity-100');
  setTimeout(() => {
    adminToast.classList.remove('opacity-100');
    adminToast.classList.add('opacity-0', 'pointer-events-none');
  }, 2200);
}

// --- Browser Desktop Notification ---
function sendDesktopNotification(title, body) {
  if (!desktopNotiEnabled || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body: body,
      icon: '/favicon.ico'
    });
  } catch (err) {}
}

// --- Admin Authentication ---
async function verifyAuth() {
  if (!adminToken) {
    showLoginModal();
    return false;
  }
  try {
    const res = await fetch('/api/admin/verify', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      hideLoginModal();
      return true;
    }
  } catch (e) {}
  showLoginModal();
  return false;
}

function showLoginModal() {
  if (loginModal) loginModal.classList.remove('hidden');
  if (adminPasswordInput) {
    adminPasswordInput.value = '';
    setTimeout(() => adminPasswordInput.focus(), 150);
  }
  if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
}

function hideLoginModal() {
  if (loginModal) loginModal.classList.add('hidden');
  updateExportLink();
}

function updateExportLink() {
  const exportLink = document.querySelector('a[href^="/api/admin/export"]');
  if (exportLink && adminToken) {
    exportLink.href = `/api/admin/export?token=${encodeURIComponent(adminToken)}`;
  }
}

// Login form submit
if (adminLoginForm) {
  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = adminPasswordInput.value.trim();
    if (!password) return;

    loginSubmitBtn.disabled = true;
    loginSubmitBtn.innerHTML = '<span>인증 확인 중...</span>';
    loginErrorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '비밀번호가 올바르지 않습니다.');
      }

      adminToken = data.token;
      localStorage.setItem('admin_token', adminToken);
      hideLoginModal();

      initSocket();
      loadRooms();
      showToast('관리자 인증이 완료되었습니다.');
    } catch (err) {
      loginErrorMsg.textContent = err.message;
      loginErrorMsg.classList.remove('hidden');
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.innerHTML = '<span>관리자 로그인</span><i data-lucide="arrow-right" class="w-4 h-4"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });
}

// Logout button
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (confirm('관리자 콘솔에서 로그아웃하시겠습니까?')) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${adminToken}` }
        });
      } catch (e) {}
      localStorage.removeItem('admin_token');
      adminToken = '';
      if (socket) socket.disconnect();
      showLoginModal();
    }
  });
}

// --- Initialize Socket.IO for Admin ---
function initSocket() {
  if (socket) socket.disconnect();
  socket = io();

  socket.on('connect', () => {
    socket.emit('join_admin_channel', { token: adminToken });
    if (selectedRoomId) {
      socket.emit('join_room', {
        roomId: selectedRoomId,
        role: 'admin',
        userName: '관리자',
        token: adminToken
      });
    }
  });

  socket.on('auth_error', ({ message }) => {
    showToast(message || '인증이 만료되었습니다.');
    showLoginModal();
  });

  // New room created by customer
  socket.on('admin_new_room', ({ room }) => {
    playChime(true);
    sendDesktopNotification('신규 고객 상담 접수!', `${room.customer_name} (${room.customer_phone})`);
    loadRooms();
  });

  // Any new message in the currently selected room (from admin or customer)
  socket.on('new_message', (message) => {
    if (selectedRoomId === message.room_id) {
      appendAdminMessageUI(message);
      if (message.sender === 'customer') {
        socket.emit('mark_read', { roomId: selectedRoomId, role: 'admin' });
      }
    }
    // Update left sidebar room list preview
    updateRoomLastMessage(message.room_id, message.text, message.created_at);
  });

  // Background activity from admin
  socket.on('admin_room_activity', ({ roomId, lastMessage, lastMessageAt }) => {
    updateRoomLastMessage(roomId, lastMessage, lastMessageAt);
  });

  // Customer message notification (for chime & notifications when looking elsewhere)
  socket.on('admin_message_notification', ({ roomId, customerName, customerPhone, message }) => {
    if (selectedRoomId !== roomId) {
      // Different room -> sound chime & update list unread counter
      playChime(false);
      sendDesktopNotification(`새 메시지: ${customerName}`, message.text);
      loadRooms();
    }
  });

  // When customer is typing
  socket.on('user_typing', ({ sender, isTyping }) => {
    if (sender === 'customer') {
      if (isTyping) {
        adminCustomerTyping.classList.remove('hidden');
      } else {
        adminCustomerTyping.classList.add('hidden');
      }
    }
  });

  // Messages read by customer
  socket.on('messages_read', ({ readerRole }) => {
    if (readerRole === 'customer') {
      document.querySelectorAll('.admin-unread-badge').forEach(el => el.remove());
    }
  });

  // Room status change
  socket.on('admin_room_status_changed', ({ roomId, status }) => {
    if (selectedRoomId === roomId) {
      selectedRoomData.status = status;
      updateHeaderStatus(status);
    }
    loadRooms();
  });
}

// --- Fetch & Render Rooms ---
async function loadRooms() {
  if (!adminToken) return;
  try {
    const params = new URLSearchParams();
    if (filterStatus) params.append('status', filterStatus);
    if (searchQuery) params.append('search', searchQuery);

    const res = await fetch(`/api/admin/rooms?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.status === 401) {
      showLoginModal();
      return;
    }
    if (!res.ok) throw new Error('목록 조회 실패');
    rooms = await res.json();

    // Also fetch counts for all
    const allRes = await fetch(`/api/admin/rooms?status=all`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (allRes.ok) {
      const allRooms = await allRes.json();
      countAll.textContent = allRooms.length;
      countActive.textContent = allRooms.filter(r => r.status === 'active').length;
      countClosed.textContent = allRooms.filter(r => r.status === 'closed').length;
    }

    renderRoomList();
  } catch (err) {
    console.error('Failed to load rooms:', err);
  }
}

function renderRoomList() {
  roomListContainer.innerHTML = '';

  if (rooms.length === 0) {
    roomListContainer.innerHTML = `
      <div class="p-8 text-center text-slate-400 text-xs">
        <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
        상담 내역이 없습니다.
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  rooms.forEach(room => {
    const isSelected = selectedRoomId === room.id;
    const item = document.createElement('div');
    item.className = `p-3.5 cursor-pointer transition hover:bg-slate-50 flex items-start justify-between gap-2.5 ${
      isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : ''
    }`;

    const statusBadge = room.status === 'active'
      ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">진행중</span>`
      : `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">완료</span>`;

    const unreadPill = room.unread_count > 0
      ? `<span class="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 animate-pulse">${room.unread_count}</span>`
      : '';

    const lastMsg = room.last_message ? escapeHtml(room.last_message) : '대화 내용 없음';
    const timeFormatted = formatTimeAgo(room.updated_at || room.created_at);

    item.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="font-bold text-xs text-slate-900 truncate">${escapeHtml(room.customer_name)}</span>
            ${statusBadge}
          </div>
          <span class="text-[10px] text-slate-400 shrink-0">${timeFormatted}</span>
        </div>
        <p class="text-[11px] text-slate-500 font-mono mb-1">${escapeHtml(room.customer_phone)}</p>
        <p class="text-xs text-slate-600 truncate">${lastMsg}</p>
      </div>
      ${unreadPill}
    `;

    item.addEventListener('click', () => selectRoom(room.id));
    roomListContainer.appendChild(item);
  });

  if (window.lucide) lucide.createIcons();
}

// --- Select a Room ---
async function selectRoom(roomId) {
  selectedRoomId = roomId;

  try {
    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) throw new Error('상담방 상세 조회 실패');
    selectedRoomData = await res.json();

    noRoomSelected.classList.add('hidden');
    activeChatContainer.classList.remove('hidden');

    // Join room on socket
    socket.emit('join_room', {
      roomId: selectedRoomData.id,
      role: 'admin',
      userName: '관리자',
      token: adminToken
    });

    // Populate header & metadata
    headerCustomerAvatar.textContent = selectedRoomData.customer_name.slice(0, 1);
    headerCustomerName.textContent = selectedRoomData.customer_name;
    headerCustomerPhone.textContent = selectedRoomData.customer_phone;
    headerCustomerPhone.href = `tel:${selectedRoomData.customer_phone}`;
    headerCreatedAt.textContent = `시작: ${formatDate(selectedRoomData.created_at)}`;

    metaCustomerName.textContent = selectedRoomData.customer_name;
    metaCustomerPhone.textContent = selectedRoomData.customer_phone;
    metaInitialInquiry.textContent = selectedRoomData.initial_inquiry || '최초 작성 문의사항 없음';
    adminNotesTextarea.value = selectedRoomData.notes || '';

    updateHeaderStatus(selectedRoomData.status);

    // Render messages
    adminMessagesContainer.innerHTML = '';
    if (selectedRoomData.messages && selectedRoomData.messages.length > 0) {
      selectedRoomData.messages.forEach(msg => appendAdminMessageUI(msg));
    }
    scrollAdminMessagesBottom();

    // Mark as read in UI list
    loadRooms();
  } catch (err) {
    alert(err.message);
  }
}

function updateHeaderStatus(status) {
  if (status === 'closed') {
    headerStatusBadge.textContent = '완료';
    headerStatusBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500';
    toggleStatusBtn.className = 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition flex items-center gap-1.5';
    toggleStatusText.textContent = '상담 재개';
  } else {
    headerStatusBadge.textContent = '진행중';
    headerStatusBadge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700';
    toggleStatusBtn.className = 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition flex items-center gap-1.5';
    toggleStatusText.textContent = '상담 완료 처리';
  }
}

// --- Render Admin Chat Message ---
function appendAdminMessageUI(msg) {
  const isMe = msg.sender === 'admin';
  const isSystem = msg.sender === 'system';

  const row = document.createElement('div');
  row.className = 'flex flex-col msg-animate';

  if (isSystem) {
    row.innerHTML = `
      <div class="my-2 flex justify-center">
        <span class="bg-slate-200 text-slate-600 text-[11px] font-medium px-3 py-1 rounded-full shadow-2xs">
          ${escapeHtml(msg.text)}
        </span>
      </div>
    `;
  } else if (isMe) {
    // Admin (Right side)
    const timeStr = formatTime(msg.created_at);
    const unread = msg.is_read === 0 ? `<span class="admin-unread-badge text-[10px] font-bold text-amber-500 mr-1 self-end">1</span>` : '';

    row.innerHTML = `
      <div class="flex items-end justify-end gap-1.5 ml-12">
        <div class="flex items-end text-slate-400 text-[10px]">
          ${unread}
          <span>${timeStr}</span>
        </div>
        <div class="bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-xs shadow-xs text-xs md:text-sm break-words max-w-[80%] leading-relaxed">
          ${escapeHtml(msg.text)}
        </div>
      </div>
    `;
  } else {
    // Customer (Left side)
    const timeStr = formatTime(msg.created_at);
    row.innerHTML = `
      <div class="flex items-start gap-2 mr-12">
        <div class="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-2xs">
          고객
        </div>
        <div class="flex flex-col">
          <span class="text-[11px] font-medium text-slate-500 mb-0.5">${escapeHtml(msg.sender_name || '고객')}</span>
          <div class="flex items-end gap-1.5">
            <div class="bg-white text-slate-800 border border-slate-200/90 px-4 py-2.5 rounded-2xl rounded-tl-xs shadow-2xs text-xs md:text-sm break-words max-w-[85%] leading-relaxed">
              ${escapeHtml(msg.text)}
            </div>
            <span class="text-slate-400 text-[10px] whitespace-nowrap self-end">${timeStr}</span>
          </div>
        </div>
      </div>
    `;
  }

  adminMessagesContainer.appendChild(row);
  scrollAdminMessagesBottom();
}

function scrollAdminMessagesBottom() {
  adminMessagesContainer.scrollTop = adminMessagesContainer.scrollHeight;
}

// --- Send Message as Admin ---
adminMessageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = adminMessageInput.value.trim();
  if (!text || !selectedRoomId) return;

  socket.emit('send_message', {
    roomId: selectedRoomId,
    sender: 'admin',
    senderName: '상담원',
    text: text
  });

  // Stop typing indicator
  socket.emit('typing', {
    roomId: selectedRoomId,
    sender: 'admin',
    isTyping: false
  });

  adminMessageInput.value = '';
  adminMessageInput.focus();
});

// Admin Typing event
let adminTypingTimeout = null;
adminMessageInput.addEventListener('input', () => {
  if (!socket || !selectedRoomId) return;

  socket.emit('typing', {
    roomId: selectedRoomId,
    sender: 'admin',
    isTyping: true
  });

  clearTimeout(adminTypingTimeout);
  adminTypingTimeout = setTimeout(() => {
    socket.emit('typing', {
      roomId: selectedRoomId,
      sender: 'admin',
      isTyping: false
    });
  }, 1200);
});

// Update single room's preview in sidebar without full re-fetch
function updateRoomLastMessage(roomId, lastMessage, lastMessageAt) {
  const room = rooms.find(r => r.id === roomId);
  if (room) {
    room.last_message = lastMessage;
    room.updated_at = lastMessageAt || new Date().toISOString();
    renderRoomList();
  } else {
    loadRooms();
  }
}

// Support Shift+Enter for newline, Enter to send
adminMessageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    adminMessageForm.dispatchEvent(new Event('submit'));
  }
});

// --- Canned Responses (빠른 답변 버튼) ---
document.querySelectorAll('.canned-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    let cleanText = btn.textContent.trim().replace(/^[\uD800-\uDBFF\uDC00-\uDFFF\u2600-\u27BF]+\s*/, '');
    adminMessageInput.value = cleanText;
    adminMessageInput.focus();
  });
});

// --- Toggle Room Status (진행중 <-> 완료) ---
toggleStatusBtn.addEventListener('click', async () => {
  if (!selectedRoomId || !selectedRoomData) return;

  const nextStatus = selectedRoomData.status === 'active' ? 'closed' : 'active';
  const confirmMsg = nextStatus === 'closed'
    ? '상담을 완료 처리하시겠습니까?'
    : '상담을 다시 진행 상태로 변경하시겠습니까?';

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/admin/rooms/${selectedRoomId}/status`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: nextStatus })
    });
    if (!res.ok) throw new Error('상태 변경 실패');

    selectedRoomData.status = nextStatus;
    updateHeaderStatus(nextStatus);
    showToast(nextStatus === 'closed' ? '상담이 완료 처리되었습니다.' : '상담이 재개되었습니다.');
    loadRooms();
  } catch (err) {
    alert(err.message);
  }
});

// --- Save Admin Notes ---
saveNotesBtn.addEventListener('click', async () => {
  if (!selectedRoomId) return;
  const notes = adminNotesTextarea.value.trim();

  try {
    saveNotesBtn.disabled = true;
    saveNotesBtn.textContent = '저장 중...';

    const res = await fetch(`/api/admin/rooms/${selectedRoomId}/notes`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ notes })
    });
    if (!res.ok) throw new Error('메모 저장 실패');

    showToast('상담 메모가 저장되었습니다.');
  } catch (err) {
    alert(err.message);
  } finally {
    saveNotesBtn.disabled = false;
    saveNotesBtn.innerHTML = '<i data-lucide="save" class="w-3.5 h-3.5"></i><span>메모 저장</span>';
    if (window.lucide) lucide.createIcons();
  }
});

// --- Copy Customer Dedicated Link ---
adminCopyCustomerLink.addEventListener('click', async () => {
  if (!selectedRoomId) return;
  const link = `${window.location.origin}/?room=${selectedRoomId}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast('고객 접속 전용 링크가 복사되었습니다!');
  } catch (e) {
    prompt('고객 링크:', link);
  }
});

// --- Toggle Notes Panel on/off ---
toggleNotesPanelBtn.addEventListener('click', () => {
  notesPanel.classList.toggle('hidden');
});

// --- Search Filter ---
let searchDebounce = null;
roomSearchInput.addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = e.target.value;
    loadRooms();
  }, 250);
});

// --- Status Filter Tabs ---
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => {
      t.className = 'filter-tab flex-1 py-1.5 rounded-md font-medium text-slate-500 hover:bg-white border border-transparent text-center transition';
    });
    tab.className = 'filter-tab flex-1 py-1.5 rounded-md font-medium text-blue-600 bg-blue-50/80 border border-blue-200 text-center transition';
    filterStatus = tab.dataset.status;
    loadRooms();
  });
});

// --- Sound Toggle ---
soundToggleBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  if (soundEnabled) {
    soundIcon.className = 'w-4 h-4 text-emerald-400';
    soundText.textContent = '알림음 ON';
    playChime(false);
  } else {
    soundIcon.className = 'w-4 h-4 text-slate-400';
    soundText.textContent = '알림음 OFF';
  }
});

// --- Desktop Notifications Toggle ---
notiToggleBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    alert('이 브라우저는 데스크톱 알림을 지원하지 않습니다.');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    desktopNotiEnabled = true;
    notiToggleBtn.classList.add('bg-blue-900', 'text-blue-300');
    showToast('데스크톱 알림이 활성화되었습니다.');
  } else {
    alert('알림 권한이 차단되었습니다. 브라우저 설정에서 허용해주세요.');
  }
});

// --- Formatters & Helpers ---
function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? '오후' : '오전';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${ampm} ${hours}:${minutes}`;
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const diffMs = new Date() - new Date(isoString);
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  return `${Math.floor(diffHours / 24)}일 전`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Initial Page Load ---
window.addEventListener('DOMContentLoaded', async () => {
  const isAuthed = await verifyAuth();
  if (isAuthed) {
    initSocket();
    loadRooms();
  }
});
