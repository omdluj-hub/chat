// Customer Client Logic
let socket = null;
let currentRoom = null;
let typingTimeout = null;

// DOM Elements
const entrySection = document.getElementById('entrySection');
const chatSection = document.getElementById('chatSection');
const entryForm = document.getElementById('entryForm');
const customerNameInput = document.getElementById('customerNameInput');
const customerPhoneInput = document.getElementById('customerPhoneInput');
const messagesContainer = document.getElementById('messagesContainer');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const typingIndicator = document.getElementById('typingIndicator');
const chatRoomStatusBadge = document.getElementById('chatRoomStatusBadge');
const closedBanner = document.getElementById('closedBanner');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const restartChatBtn = document.getElementById('restartChatBtn');
const closedRestartBtn = document.getElementById('closedRestartBtn');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');

// --- Subtle Web Audio Chime ---
function playChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Audio autoplay restrictions or not supported
  }
}

// --- Toast Notification ---
function showToast(text) {
  toastMsg.textContent = text;
  toast.classList.remove('opacity-0', 'pointer-events-none');
  toast.classList.add('opacity-100');
  setTimeout(() => {
    toast.classList.remove('opacity-100');
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, 2400);
}

// --- Auto format Korean phone numbers ---
customerPhoneInput.addEventListener('input', (e) => {
  let val = e.target.value.replace(/[^0-9]/g, '');
  if (val.length < 4) {
    e.target.value = val;
  } else if (val.length < 7) {
    e.target.value = val.slice(0, 3) + '-' + val.slice(3);
  } else if (val.length < 11) {
    e.target.value = val.slice(0, 3) + '-' + val.slice(3, 7) + '-' + val.slice(7);
  } else {
    e.target.value = val.slice(0, 3) + '-' + val.slice(3, 7) + '-' + val.slice(7, 11);
  }
});

// --- Check existing room on page load ---
window.addEventListener('DOMContentLoaded', async () => {
  // Check URL query ?room=... or path /c/:id
  const urlParams = new URLSearchParams(window.location.search);
  let roomId = urlParams.get('room');

  if (!roomId && window.location.pathname.startsWith('/c/')) {
    roomId = window.location.pathname.split('/c/')[1];
  }

  // Fallback to localStorage
  if (!roomId) {
    const saved = localStorage.getItem('chat_room_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        roomId = parsed.id;
      } catch (err) {}
    }
  }

  if (roomId) {
    await loadExistingRoom(roomId);
  }
});

async function loadExistingRoom(roomId) {
  try {
    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) {
      localStorage.removeItem('chat_room_session');
      return;
    }
    const room = await res.json();
    enterChatRoom(room);
  } catch (err) {
    console.error('Failed to load room:', err);
  }
}

// --- Handle Entry Form Submit ---
entryForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = customerNameInput.value.trim();
  const phone = customerPhoneInput.value.trim();

  if (!name) {
    alert('성함을 입력해주세요.');
    return;
  }
  if (!phone || phone.length < 9) {
    alert('올바른 휴대폰 번호를 입력해주세요.');
    return;
  }

  const startBtn = document.getElementById('startChatBtn');
  startBtn.disabled = true;
  startBtn.innerHTML = '<span>상담 연결 중...</span>';

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: name,
        customerPhone: phone
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '상담방 개설에 실패했습니다.');
    }

    const room = await res.json();
    localStorage.setItem('chat_room_session', JSON.stringify({
      id: room.id,
      name: room.customer_name,
      phone: room.customer_phone
    }));

    // Update URL query string
    const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${room.id}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    enterChatRoom(room);

    if (room.isResumed) {
      showToast('진행 중이던 상담으로 연결되었습니다.');
    }
  } catch (err) {
    alert(err.message);
  } finally {
    startBtn.disabled = false;
    startBtn.innerHTML = '<span>상담 시작하기</span><i data-lucide="arrow-right" class="w-4 h-4"></i>';
    if (window.lucide) lucide.createIcons();
  }
});

// --- Enter Chat Room View ---
function enterChatRoom(room) {
  currentRoom = room;

  // Switch UI views
  entrySection.classList.add('hidden');
  chatSection.classList.remove('hidden');
  chatSection.classList.add('flex');

  updateRoomStatusUI(room.status);

  // Initialize Socket.io
  initSocket();

  // Render previous messages
  messagesContainer.innerHTML = '';
  if (room.messages && room.messages.length > 0) {
    room.messages.forEach(msg => appendMessageUI(msg, false));
  }
  scrollToBottom();

  if (window.lucide) lucide.createIcons();
}

// --- Initialize Socket.IO connection ---
function initSocket() {
  if (socket) socket.disconnect();

  socket = io();

  socket.on('connect', () => {
    socket.emit('join_room', {
      roomId: currentRoom.id,
      role: 'customer',
      userName: currentRoom.customer_name
    });
  });

  socket.on('new_message', (message) => {
    appendMessageUI(message, true);
    if (message.sender === 'admin') {
      playChime();
      // Mark as read immediately since user is in the room
      socket.emit('mark_read', { roomId: currentRoom.id, role: 'customer' });
    }
  });

  socket.on('messages_read', ({ readerRole }) => {
    if (readerRole === 'admin') {
      // Admin has read customer messages -> remove '1' (unread indicator)
      document.querySelectorAll('.unread-badge').forEach(el => el.remove());
    }
  });

  socket.on('user_typing', ({ sender, isTyping }) => {
    if (sender === 'admin') {
      if (isTyping) {
        typingIndicator.classList.remove('hidden');
        scrollToBottom();
      } else {
        typingIndicator.classList.add('hidden');
      }
    }
  });

  socket.on('status_changed', ({ status, message }) => {
    currentRoom.status = status;
    updateRoomStatusUI(status);
    if (message) {
      appendMessageUI(message, false);
    }
  });
}

function updateRoomStatusUI(status) {
  if (status === 'closed') {
    chatRoomStatusBadge.textContent = '상담종료';
    chatRoomStatusBadge.className = 'text-[10px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded';
    closedBanner.classList.remove('hidden');
    messageInput.placeholder = '상담이 종료되었습니다.';
    messageInput.disabled = true;
    document.getElementById('sendMessageBtn').disabled = true;
  } else {
    chatRoomStatusBadge.textContent = '상담중';
    chatRoomStatusBadge.className = 'text-[10px] font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded';
    closedBanner.classList.add('hidden');
    messageInput.placeholder = '메시지를 입력하세요...';
    messageInput.disabled = false;
    document.getElementById('sendMessageBtn').disabled = false;
  }
}

// --- Render Message in UI ---
function appendMessageUI(msg, animate = true) {
  const isMe = msg.sender === 'customer';
  const isSystem = msg.sender === 'system';

  const row = document.createElement('div');
  row.className = `flex flex-col ${animate ? 'msg-animate' : ''}`;

  if (isSystem) {
    row.innerHTML = `
      <div class="my-2 flex justify-center">
        <span class="bg-slate-200/70 text-slate-600 text-[11px] font-medium px-3 py-1 rounded-full shadow-2xs">
          ${escapeHtml(msg.text)}
        </span>
      </div>
    `;
  } else if (isMe) {
    // Customer message (Right side)
    const timeStr = formatTime(msg.created_at);
    const unreadIndicator = msg.is_read === 0 ? `<span class="unread-badge text-[10px] font-bold text-amber-500 mr-1 self-end leading-none">1</span>` : '';

    row.innerHTML = `
      <div class="flex items-end justify-end gap-1.5 ml-8">
        <div class="flex items-end text-slate-400 text-[10px]">
          ${unreadIndicator}
          <span class="text-slate-400">${timeStr}</span>
        </div>
        <div class="bg-blue-600 text-white px-3.5 py-2.5 rounded-2xl rounded-tr-xs shadow-sm text-sm break-words max-w-[80%] leading-relaxed">
          ${escapeHtml(msg.text)}
        </div>
      </div>
    `;
  } else {
    // Admin message (Left side)
    const timeStr = formatTime(msg.created_at);
    row.innerHTML = `
      <div class="flex items-start gap-2 mr-8">
        <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
          상담
        </div>
        <div class="flex flex-col">
          <span class="text-[11px] font-medium text-slate-500 mb-1">상담원</span>
          <div class="flex items-end gap-1.5">
            <div class="bg-white text-slate-800 border border-slate-200/80 px-3.5 py-2.5 rounded-2xl rounded-tl-xs shadow-xs text-sm break-words max-w-[85%] leading-relaxed">
              ${escapeHtml(msg.text)}
            </div>
            <span class="text-slate-400 text-[10px] whitespace-nowrap self-end">${timeStr}</span>
          </div>
        </div>
      </div>
    `;
  }

  messagesContainer.appendChild(row);
  scrollToBottom();
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// --- Send Message ---
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !currentRoom) return;

  socket.emit('send_message', {
    roomId: currentRoom.id,
    sender: 'customer',
    senderName: currentRoom.customer_name,
    text: text
  });

  messageInput.value = '';

  // Cancel typing event
  socket.emit('typing', {
    roomId: currentRoom.id,
    sender: 'customer',
    isTyping: false
  });
});

// --- Typing indicator logic ---
messageInput.addEventListener('input', () => {
  if (!socket || !currentRoom) return;

  socket.emit('typing', {
    roomId: currentRoom.id,
    sender: 'customer',
    isTyping: true
  });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', {
      roomId: currentRoom.id,
      sender: 'customer',
      isTyping: false
    });
  }, 1200);
});

// --- Quick Inquiry Chips ---
document.querySelectorAll('.quick-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentRoom || currentRoom.status === 'closed') return;
    const chipText = btn.textContent.trim();
    messageInput.value = chipText;
    messageForm.dispatchEvent(new Event('submit'));
  });
});

// --- Copy Consultation Link ---
copyLinkBtn.addEventListener('click', async () => {
  if (!currentRoom) return;
  const shareUrl = `${window.location.origin}/?room=${currentRoom.id}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('상담 링크가 복사되었습니다!');
  } catch (err) {
    prompt('상담 링크를 복사해주세요:', shareUrl);
  }
});

// --- Restart Chat ---
function resetChat() {
  if (confirm('새 상담을 시작하시겠습니까? 현재 상담창에서 나가게 됩니다.')) {
    localStorage.removeItem('chat_room_session');
    window.location.href = window.location.pathname;
  }
}
restartChatBtn.addEventListener('click', resetChat);
closedRestartBtn.addEventListener('click', resetChat);

// --- Utilities ---
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

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
