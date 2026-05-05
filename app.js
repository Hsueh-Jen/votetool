const ROOM_ID = 'votetool-room-888-999';

let questions = [];

let state = {
  currentQuestionId: null,
  votes: {}, // questionId -> { optionIdx: count }
  role: null,
  peerId: null,
  hostId: null,
  peer: null,
  connections: []
};

// --- Initialization ---

async function init() {
  try {
    const res = await fetch('questions.json');
    questions = await res.json();
  } catch (err) {
    console.error('無法載入 questions.json:', err);
  }

  const urlParams = new URLSearchParams(window.location.search);
  state.role = urlParams.get('role');
  state.hostId = urlParams.get('host');

  if (!state.role) {
    document.getElementById('setup-view').style.display = 'block';
    return;
  }

  hideAllViews();
  
  if (state.role === 'admin') {
    startAdmin();
  } else if (state.role === 'result') {
    startResult();
  } else if (state.role === 'vote') {
    startVote();
  }
}

function hideAllViews() {
  ['setup-view', 'result-view', 'admin-view', 'vote-view'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
}

function openRole(role, specificHost = null) {
  const host = specificHost || state.hostId;
  const url = `?role=${role}${host ? '&host=' + host : ''}`;
  window.open(url, '_blank');
}

function switchRole(role) {
  const url = `?role=${role}${state.hostId ? '&host=' + state.hostId : ''}`;
  window.location.href = url;
}

// --- Admin Logic ---

function startAdmin() {
  document.getElementById('admin-view').style.display = 'block';
  
  // Use a fixed ID for simplicity
  state.peer = new Peer(ROOM_ID);
  
  state.peer.on('open', (id) => {
    state.peerId = id;
    document.getElementById('admin-id-badge').innerText = `ID: ${id}`;
    updateQR(id);
  });

  state.peer.on('error', (err) => {
    console.error('Peer error:', err);
    if (err.type === 'unavailable-id') {
      showToast('ID 已被佔用，房間正在重試連線...');
      setTimeout(() => {
        if (!state.peer.destroyed) state.peer.reconnect();
      }, 3000);
    } else if (err.type === 'network' || err.type === 'server-error') {
      setTimeout(() => {
        if (!state.peer.destroyed) state.peer.reconnect();
      }, 3000);
    }
  });

  state.peer.on('disconnected', () => {
    console.warn('Peer disconnected from signaling server. Reconnecting...');
    setTimeout(() => {
      if (!state.peer.destroyed) state.peer.reconnect();
    }, 1000);
  });

  state.peer.on('connection', (conn) => {
    state.connections.push(conn);
    setupConnection(conn);
  });

  // Load saved state if exists
  const savedVotes = localStorage.getItem('admin_votes');
  if (savedVotes) state.votes = JSON.parse(savedVotes);
  
  const savedCurrentQ = localStorage.getItem('admin_current_q');
  if (savedCurrentQ) state.currentQuestionId = parseInt(savedCurrentQ);

  renderAdminQuestions();
}

function setupConnection(conn) {
  conn.on('open', () => {
    // Send current state to new connection
    if (state.currentQuestionId !== null) {
      sendStateTo(conn);
    }
  });

  conn.on('data', (data) => {
    if (data.type === 'vote') {
      handleVote(data.questionId, data.optionIdx, data.isUndo);
    }
  });
}

function handleVote(qId, optIdx, isUndo = false) {
  if (!state.votes[qId]) state.votes[qId] = {};
  
  if (isUndo) {
    if (state.votes[qId][optIdx] > 0) state.votes[qId][optIdx]--;
  } else {
    state.votes[qId][optIdx] = (state.votes[qId][optIdx] || 0) + 1;
  }
  
  // Persist admin votes
  localStorage.setItem('admin_votes', JSON.stringify(state.votes));
  
  broadcastState();
}

function broadcastState() {
  // Clean up closed connections
  state.connections = state.connections.filter(c => c.open);
  
  state.connections.forEach(conn => {
    sendStateTo(conn);
  });
}

function sendStateTo(conn) {
  const q = questions.find(q => q.id === state.currentQuestionId);
  conn.send({
    type: 'sync',
    currentQuestion: q,
    votes: state.votes[state.currentQuestionId] || {}
  });
}

function renderAdminQuestions() {
  const container = document.getElementById('admin-questions');
  container.innerHTML = '';
  questions.forEach(q => {
    const div = document.createElement('div');
    div.className = `question-item glass-card ${state.currentQuestionId === q.id ? 'active' : ''}`;
    div.innerHTML = `
      <span>${q.title}</span>
      <button class="btn-primary" onclick="setQuestion(${q.id})">
        ${state.currentQuestionId === q.id ? '進行中' : '開始此題'}
      </button>
    `;
    container.appendChild(div);
  });
}

function setQuestion(id) {
  state.currentQuestionId = id;
  if (!state.votes[id]) state.votes[id] = {};
  
  // Persist current question
  localStorage.setItem('admin_current_q', id);
  
  renderAdminQuestions();
  broadcastState();
}

function resetSystem() {
  if (confirm('確定要重設所有投票數據嗎？這將清除所有人的投票記錄。')) {
    localStorage.clear();
    location.reload();
  }
}

let toastTimer = null;
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  
  toast.innerHTML = `<span>${msg}</span>`;
  toast.classList.add('show');
  
  if (toastTimer) clearTimeout(toastTimer);
  
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, 3000);
}

function copyVoterLink() {
  const url = document.getElementById('share-url').innerText;
  copyToClipboard(url, '已複製投票連結！');
}

function copyResultLink() {
  const baseUrl = window.location.origin + window.location.pathname;
  // Use ROOM_ID if peerId is not yet available, to be safe
  const id = state.peerId || ROOM_ID;
  const resultUrl = `${baseUrl}?role=result&host=${id}`;
  copyToClipboard(resultUrl, '已複製投影頁連結！');
}

function copyToClipboard(text, successMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg);
    }).catch(err => {
      console.error('Clipboard API failed, using fallback.', err);
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    showToast(successMsg);
  } catch (err) {
    console.error('Fallback copy failed.', err);
  }
  document.body.removeChild(textArea);
}

function updateQR(id) {
  const baseUrl = window.location.origin + window.location.pathname;
  const voterUrl = `${baseUrl}?role=vote&host=${id}`;
  const resultUrl = `${baseUrl}?role=result&host=${id}`;
  
  document.getElementById('share-url').innerText = voterUrl;
  
  // Admin QR is for voters
  new QRCode(document.getElementById("qrcode"), {
    text: voterUrl,
    width: 200,
    height: 200,
    colorDark : "#000000",
    colorLight : "#ffffff",
  });
}

// --- Result Logic ---

function startResult() {
  document.getElementById('result-view').style.display = 'block';
  
  // Default to fixed room ID if none provided
  if (!state.hostId) state.hostId = ROOM_ID;

  // Generate QR for audience if they look at the big screen
  const baseUrl = window.location.origin + window.location.pathname;
  new QRCode(document.getElementById("qrcode-audience"), {
    text: `${baseUrl}?role=vote&host=${state.hostId}`,
    width: 120,
    height: 120
  });

  connectToHost((data) => {
    updateResultUI(data);
  });
}

let lastResultQId = null;

function updateResultUI(data) {
  const q = data.currentQuestion;
  const votes = data.votes;
  const view = document.getElementById('result-view');
  
  if (lastResultQId !== q.id) {
    // New question transition
    const view = document.getElementById('result-content');
    view.classList.add('view-hidden');
    setTimeout(() => {
      lastResultQId = q.id;
      previousVotes = {}; // Reset counts for new question
      document.getElementById('bar-chart').innerHTML = ''; // Clear for new bars
      renderResultContent(q, votes);
      view.classList.remove('view-hidden');
    }, 400);
  } else {
    // Just vote updates
    renderResultContent(q, votes);
  }
}

let previousVotes = {};

function renderResultContent(q, votes) {
  document.getElementById('display-question').innerText = q.title;
  const chart = document.getElementById('bar-chart');
  const maxVotes = Math.max(...Object.values(votes), 1);

  q.options.forEach((opt, idx) => {
    const count = votes[idx] || 0;
    const prevCount = previousVotes[idx] || 0;
    const heightPercent = (count / maxVotes) * 100;
    
    let animClass = '';
    if (count > prevCount) animClass = 'pop-up';
    else if (count < prevCount) animClass = 'pop-down';

    // Try to find existing bar
    let barWrapper = chart.querySelector(`.bar-wrapper[data-idx="${idx}"]`);
    
    if (!barWrapper) {
      // Create new if not exists (happens on first render of a question)
      barWrapper = document.createElement('div');
      barWrapper.className = 'bar-wrapper';
      barWrapper.dataset.idx = idx;
      barWrapper.innerHTML = `
        <div class="bar">
          <div class="bar-count"></div>
        </div>
        <div class="bar-label"></div>
      `;
      chart.appendChild(barWrapper);
    }

    // Update in-place to avoid re-triggering entrance animations
    const bar = barWrapper.querySelector('.bar');
    const barCount = barWrapper.querySelector('.bar-count');
    const barLabel = barWrapper.querySelector('.bar-label');

    bar.style.height = `${heightPercent}%`;
    barCount.innerText = count;
    barLabel.innerText = opt;

    // Trigger pop animation
    if (animClass) {
      barCount.classList.remove('pop-up', 'pop-down');
      void barCount.offsetWidth; // Trigger reflow
      barCount.classList.add(animClass);
    }
  });
  
  // Save for next update
  previousVotes = { ...votes };
}

// --- Vote Logic ---

function startVote() {
  document.getElementById('vote-view').style.display = 'block';
  
  // Default to fixed room ID if none provided
  if (!state.hostId) state.hostId = ROOM_ID;

  connectToHost((data) => {
    updateVoteUI(data);
  });
}

let lastQuestionId = null;

function updateVoteUI(data) {
  const q = data.currentQuestion;
  if (!q) return;

  const view = document.getElementById('voter-active-ui');
  const container = document.getElementById('vote-options');
  
  // Re-generate buttons only if it's a new question
  if (lastQuestionId !== q.id) {
    view.classList.add('view-hidden');
    
    setTimeout(() => {
      lastQuestionId = q.id;
      document.getElementById('voter-active-ui').style.display = 'block';
      document.getElementById('voter-wait-ui').style.display = 'none';
      document.getElementById('vote-question').innerText = q.title;
      container.innerHTML = '';
      
      q.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'vote-btn glass-card';
        btn.innerText = opt;
        btn.dataset.idx = idx;
        btn.onclick = () => sendVote(q.id, idx);
        container.appendChild(btn);
      });
      
      updateSelectionUI(q.id, container);
      view.classList.remove('view-hidden');
    }, 400);
  } else {
    updateSelectionUI(q.id, container);
  }
}

function updateSelectionUI(qId, container) {
  const savedVote = localStorage.getItem(`vote_${qId}`);
  const buttons = container.querySelectorAll('.vote-btn');
  buttons.forEach((btn, idx) => {
    btn.classList.remove('selected');
    btn.disabled = false;
    btn.style.opacity = '1';

    if (savedVote !== null) {
      if (parseInt(savedVote) === idx) {
        btn.classList.add('selected');
      } else {
        btn.disabled = true;
        btn.style.opacity = '0.5';
      }
    }
  });
}

function sendVote(qId, optIdx) {
  if (state.conn) {
    const savedVote = localStorage.getItem(`vote_${qId}`);
    const isUndo = savedVote !== null && parseInt(savedVote) === optIdx;
    
    // If they already voted for something ELSE, do nothing (prevent double voting)
    if (savedVote !== null && !isUndo) return;

    state.conn.send({
      type: 'vote',
      questionId: qId,
      optionIdx: optIdx,
      isUndo: isUndo
    });
    
    if (isUndo) {
      localStorage.removeItem(`vote_${qId}`);
    } else {
      localStorage.setItem(`vote_${qId}`, optIdx);
    }
    
    // Feedback: we don't need to manually update local UI because PeerJS doesn't 
    // broadcast back to the voter immediately unless we want to, 
    // but for instant feedback we can re-render or toggle.
    // Actually, let's just re-render locally for instant feedback.
    updateVoteUI({ currentQuestion: questions.find(q => q.id === qId) });
  }
}

// --- Shared Connection Logic ---

function connectToHost(onData) {
  state.peer = new Peer();
  
  state.peer.on('open', () => {
    attemptConnection(onData);
  });

  state.peer.on('error', (err) => {
    console.error('Client peer error:', err);
    if (err.type === 'network' || err.type === 'server-error' || err.type === 'peer-unavailable') {
      setTimeout(() => {
        if (!state.peer.destroyed) state.peer.reconnect();
      }, 3000);
    } else {
      setTimeout(() => connectToHost(onData), 3000);
    }
  });

  state.peer.on('disconnected', () => {
    console.warn('Client peer disconnected. Reconnecting...');
    setTimeout(() => {
      if (!state.peer.destroyed) state.peer.reconnect();
    }, 1000);
  });
}

function attemptConnection(onData) {
  const conn = state.peer.connect(state.hostId);
  state.conn = conn;

  conn.on('open', () => {
    console.log('Connected to host:', state.hostId);
    const statusIdx = state.role === 'result' ? 'result-status' : 'vote-status';
    const statusEl = document.getElementById(statusIdx);
    if (statusEl) {
      statusEl.innerText = state.role === 'result' ? '連線成功' : '已連線';
      statusEl.className = 'status-badge status-online';
      
      // Auto fade-out after 3 seconds
      setTimeout(() => {
        statusEl.classList.add('fade-out');
      }, 3000);
    }
  });

  conn.on('data', onData);

  conn.on('close', () => {
    console.warn('Connection closed. Retrying...');
    handleDisconnect();
    setTimeout(() => attemptConnection(onData), 3000);
  });

  conn.on('error', (err) => {
    console.error('Connection error:', err);
    handleDisconnect();
    setTimeout(() => attemptConnection(onData), 3000);
  });
}

function handleDisconnect() {
  const statusIdx = state.role === 'result' ? 'result-status' : 'vote-status';
  const statusEl = document.getElementById(statusIdx);
  if (statusEl) {
    statusEl.innerText = '連線中斷，正在重新連線...';
    statusEl.className = 'status-badge status-offline';
    statusEl.classList.remove('fade-out'); // Make visible again
  }
}

init();
