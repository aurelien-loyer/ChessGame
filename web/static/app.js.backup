/**
 * app.js — Chess Arena
 */

// ---- State ----
let ws = null;
let engine = new ChessEngine();
let myColor = null;
let roomId = null;
let selectedSquare = null;
let legalMoves = [];
let boardFlipped = false;
let selectedTime = 300;
let timerEnabled = true;
let whiteTime = 300;
let blackTime = 300;
let timerInterval = null;
let lastTimerTick = null;

let gameMode = 'online';
let aiPlayer = null;
let aiDifficulty = AI_DIFFICULTY.MEDIUM;
let aiColor = 'black';
let playerColor = 'white';
let aiThinking = false;

let capturedByWhite = [];
let capturedByBlack = [];
const PV = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const PORDER = ['Q', 'R', 'B', 'N', 'P'];

// ---- DOM ----
const $ = id => document.getElementById(id);
const lobbyScreen = $('lobby');
const gameScreen = $('game');
const lobbyContent = $('lobby-content');
const btnCreate = $('btn-create');
const btnJoin = $('btn-join');
const inputRoom = $('input-room');
const lobbyStatus = $('lobby-status');
const waitingPanel = $('waiting-panel');
const displayRoomCode = $('display-room-code');
const btnCopyCode = $('btn-copy-code');
const btnCancel = $('btn-cancel');
const boardEl = $('board');
const gameStatus = $('game-status');
const movesList = $('moves-list');
const btnResign = $('btn-resign');
const btnBackMenu = $('btn-back-menu');
const btnNewGame = $('btn-new-game');
const promotionDialog = $('promotion-dialog');
const promotionChoices = $('promotion-choices');
const gameOverModal = $('game-over');
const gameOverTitle = $('game-over-title');
const gameOverMessage = $('game-over-message');
const gameOverIcon = $('game-over-icon');
const selfIndicator = $('self-indicator');
const opponentIndicator = $('opponent-indicator');
const selfLabel = $('self-label');
const opponentLabel = $('opponent-label');
const selfTimer = $('self-timer');
const opponentTimer = $('opponent-timer');

// ---- WebSocket ----
function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);
    ws.onopen = () => console.log('WS connected');
    ws.onmessage = e => handleServerMessage(JSON.parse(e.data));
    ws.onclose = () => { ws = null; };
    ws.onerror = () => showStatus('Erreur de connexion', 'error');
}

function send(msg) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

function handleServerMessage(msg) {
    switch (msg.type) {
        case 'room_created':
            roomId = msg.room_id;
            displayRoomCode.textContent = roomId;
            lobbyContent.classList.add('hidden');
            waitingPanel.classList.remove('hidden');
            lobbyStatus.classList.add('hidden');
            break;
        case 'game_start':
            myColor = msg.color;
            roomId = msg.room_id;
            boardFlipped = myColor === 'black';
            if (msg.time > 0) { timerEnabled = true; selectedTime = msg.time; whiteTime = blackTime = msg.time; }
            else timerEnabled = false;
            startGame();
            break;
        case 'move':
            engine.applyNetworkMove(msg.from, msg.to, msg.promotion || null);
            if (msg.white_time !== undefined) { whiteTime = msg.white_time; blackTime = msg.black_time; }
            syncUI();
            if (engine.gameOver) { stopTimer(); showGameOver(); }
            break;
        case 'opponent_resigned':
            engine.gameOver = true; engine.result = 'resign'; engine.winner = myColor;
            stopTimer(); showGameOver(); break;
        case 'opponent_disconnected':
            engine.gameOver = true; engine.result = 'disconnect'; engine.winner = myColor;
            stopTimer(); showGameOver(); break;
        case 'timeout':
            engine.gameOver = true; engine.result = 'timeout'; engine.winner = msg.winner;
            stopTimer(); showGameOver(); break;
        case 'error':
            showStatus(msg.message, 'error'); break;
    }
}

// ---- Lobby ----
function showStatus(text, type = 'info') {
    lobbyStatus.textContent = text;
    lobbyStatus.className = 'toast ' + type;
    lobbyStatus.classList.remove('hidden');
}

// Time chips
document.querySelectorAll('.time-btn[data-time]').forEach(b => {
    b.addEventListener('click', () => {
        document.querySelectorAll('.time-btn[data-time]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        selectedTime = parseInt(b.dataset.time);
    });
});

// Mode chips
document.querySelectorAll('.mode-btn[data-mode]').forEach(b => {
    b.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn[data-mode]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        gameMode = b.dataset.mode;
        $('online-actions').classList.toggle('hidden', gameMode !== 'online');
        $('ai-actions').classList.toggle('hidden', gameMode !== 'ai');
    });
});

// Difficulty chips
document.querySelectorAll('.diff-btn.diff').forEach(b => {
    b.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn.diff').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        aiDifficulty = parseInt(b.dataset.diff);
    });
});

// Color chips
document.querySelectorAll('.color-btn.color-pick').forEach(b => {
    b.addEventListener('click', () => {
        document.querySelectorAll('.color-btn.color-pick').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
    });
});

btnCreate.addEventListener('click', () => {
    connectWS();
    const iv = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) { clearInterval(iv); send({ type: 'create_room', time: selectedTime }); }
    }, 100);
});

btnJoin.addEventListener('click', () => {
    const code = inputRoom.value.trim().toUpperCase();
    if (!code || code.length < 3) { showStatus('Code invalide', 'error'); return; }
    connectWS();
    const iv = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) { clearInterval(iv); send({ type: 'join_room', room_id: code }); }
    }, 100);
});

inputRoom.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); });

btnCopyCode.addEventListener('click', () => {
    navigator.clipboard.writeText(roomId).then(() => {
        btnCopyCode.textContent = '✓ Copié';
        setTimeout(() => btnCopyCode.textContent = '📋 Copier le code', 2000);
    });
});

btnCancel.addEventListener('click', () => {
    if (ws) ws.close();
    waitingPanel.classList.add('hidden');
    lobbyContent.classList.remove('hidden');
    lobbyStatus.classList.add('hidden');
});

// Play AI
$('btn-play-ai').addEventListener('click', () => {
    const c = document.querySelector('.color-btn.color-pick.active').dataset.color;
    playerColor = c === 'random' ? (Math.random() < .5 ? 'white' : 'black') : c;
    aiColor = playerColor === 'white' ? 'black' : 'white';
    myColor = playerColor;
    boardFlipped = myColor === 'black';
    aiPlayer = new ChessAI(aiDifficulty);
    if (selectedTime > 0) { timerEnabled = true; whiteTime = blackTime = selectedTime; }
    else timerEnabled = false;
    startGame();
    if (aiColor === 'white') makeAIMove();
});

// ---- Game ----
function startGame() {
    engine.reset();
    selectedSquare = null; legalMoves = [];
    capturedByWhite = []; capturedByBlack = [];

    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameOverModal.classList.add('hidden');
    btnBackMenu.classList.add('hidden');
    btnResign.classList.remove('hidden');
    movesList.innerHTML = '';

    selfIndicator.className = 'indicator ' + myColor + '-piece';
    opponentIndicator.className = 'indicator ' + (myColor === 'white' ? 'black' : 'white') + '-piece';
    selfLabel.textContent = 'Vous (' + (myColor === 'white' ? 'Blancs' : 'Noirs') + ')';
    if (gameMode === 'ai') {
        const dn = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile', 4: 'Expert' };
        opponentLabel.textContent = 'IA ' + (dn[aiDifficulty] || '');
    } else {
        opponentLabel.textContent = 'Adversaire';
    }

    if (timerEnabled) {
        selfTimer.classList.remove('hidden'); opponentTimer.classList.remove('hidden');
        updateTimerDisplay(); startTimer();
    } else {
        selfTimer.classList.add('hidden'); opponentTimer.classList.add('hidden');
    }

    buildBoard(); renderBoard(); updateStatus(); updateCapturedDisplay();
}

function buildBoard() {
    boardEl.innerHTML = '';
    const files = 'abcdefgh';
    ['labels-top', 'labels-bottom'].forEach(id => {
        const el = $(id); el.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const s = document.createElement('span');
            s.textContent = files[boardFlipped ? 7 - i : i];
            el.appendChild(s);
        }
    });
    ['labels-left', 'labels-right'].forEach(id => {
        const el = $(id); el.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const s = document.createElement('span');
            s.textContent = 8 - (boardFlipped ? 7 - i : i);
            el.appendChild(s);
        }
    });
    for (let dr = 0; dr < 8; dr++) {
        for (let dc = 0; dc < 8; dc++) {
            const r = boardFlipped ? 7 - dr : dr;
            const c = boardFlipped ? 7 - dc : dc;
            const sq = document.createElement('div');
            sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
            sq.dataset.row = r; sq.dataset.col = c;
            sq.addEventListener('click', () => onSquareClick(r, c));
            boardEl.appendChild(sq);
        }
    }
}

function renderBoard() {
    const squares = boardEl.querySelectorAll('.square');
    const kingPos = engine.isInCheck(engine.turn) ? engine.getKingPosition(engine.turn) : null;
    squares.forEach(sq => {
        const r = +sq.dataset.row, c = +sq.dataset.col;
        const piece = engine.getPiece(r, c);
        sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        sq.innerHTML = '';
        if (piece) {
            sq.classList.add('has-piece');
            const s = document.createElement('span');
            s.className = 'piece ' + piece.color + '-piece';
            s.textContent = PIECE_SYMBOLS[piece.type][piece.color];
            sq.appendChild(s);
        }
        if (selectedSquare && r === selectedSquare.row && c === selectedSquare.col) sq.classList.add('selected');
        if (engine.lastMove) {
            if ((r === engine.lastMove.from.row && c === engine.lastMove.from.col) ||
                (r === engine.lastMove.to.row && c === engine.lastMove.to.col)) sq.classList.add('last-move');
        }
        const isLegal = legalMoves.some(m => m.to.row === r && m.to.col === c);
        if (isLegal) sq.classList.add(piece ? 'legal-capture' : 'legal-move');
        if (selectedSquare) {
            const sp = engine.getPiece(selectedSquare.row, selectedSquare.col);
            if (sp?.type === 'P' && legalMoves.find(m => m.to.row === r && m.to.col === c && m.isEnPassant)) {
                sq.classList.add('legal-capture'); sq.classList.remove('legal-move');
            }
        }
        if (kingPos && r === kingPos.row && c === kingPos.col) sq.classList.add('check-square');
    });
}

function onSquareClick(r, c) {
    if (engine.gameOver || engine.turn !== myColor || aiThinking) return;
    const piece = engine.getPiece(r, c);
    if (selectedSquare) {
        if (r === selectedSquare.row && c === selectedSquare.col) { deselect(); renderBoard(); return; }
        if (piece?.color === myColor) { select(r, c); renderBoard(); return; }
        const move = legalMoves.find(m => m.to.row === r && m.to.col === c);
        if (move) {
            if (move.promotion) { showPromotion(selectedSquare, { row: r, col: c }); return; }
            const from = { ...selectedSquare }, to = { row: r, col: c };
            if (engine.makeMove(from, to)) {
                if (gameMode === 'online') send({ type: 'move', from, to, white_time: whiteTime, black_time: blackTime });
                deselect(); syncUI();
                if (engine.gameOver) showGameOver();
                else if (gameMode === 'ai') makeAIMove();
            }
        } else { deselect(); renderBoard(); }
    } else if (piece?.color === myColor) { select(r, c); renderBoard(); }
}

function select(r, c) { selectedSquare = { row: r, col: c }; legalMoves = engine.getLegalMoves(r, c); }
function deselect() { selectedSquare = null; legalMoves = []; }

function syncUI() {
    updateCaptured(); renderBoard(); updateStatus(); updateMoveHistory(); updateTimerDisplay();
}

// ---- Captured ----
function updateCaptured() {
    capturedByWhite = []; capturedByBlack = [];
    for (const m of engine.moveHistory) {
        if (m.captured) (m.color === 'white' ? capturedByWhite : capturedByBlack).push(m.captured);
    }
    updateCapturedDisplay();
}

function updateCapturedDisplay() {
    const mine = myColor === 'white' ? capturedByWhite : capturedByBlack;
    const opp = myColor === 'white' ? capturedByBlack : capturedByWhite;
    const oppColor = myColor === 'white' ? 'black' : 'white';

    const render = (arr, color) => [...arr].sort((a, b) => PORDER.indexOf(a) - PORDER.indexOf(b))
        .map(t => `<span>${PIECE_SYMBOLS[t][color]}</span>`).join('');

    $('self-captured-list').innerHTML = render(mine, oppColor);
    $('opponent-captured-list').innerHTML = render(opp, myColor);

    const d = mine.reduce((s, t) => s + PV[t], 0) - opp.reduce((s, t) => s + PV[t], 0);
    $('self-advantage').textContent = d > 0 ? '+' + d : '';
    $('opponent-advantage').textContent = d < 0 ? '+' + Math.abs(d) : '';
}

// ---- Promotion ----
function showPromotion(from, to) {
    promotionDialog.classList.remove('hidden');
    promotionChoices.innerHTML = '';
    for (const type of ['Q', 'R', 'B', 'N']) {
        const b = document.createElement('div');
        b.className = 'promotion-choice';
        b.textContent = PIECE_SYMBOLS[type][myColor];
        b.addEventListener('click', () => {
            promotionDialog.classList.add('hidden');
            if (engine.makeMove(from, to, type)) {
                if (gameMode === 'online') send({ type: 'move', from, to, promotion: type, white_time: whiteTime, black_time: blackTime });
                deselect(); syncUI();
                if (engine.gameOver) showGameOver();
                else if (gameMode === 'ai') makeAIMove();
            }
        });
        promotionChoices.appendChild(b);
    }
}

// ---- Timer ----
function formatTime(s) { if (s < 0) s = 0; return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
function updateTimerDisplay() {
    if (!timerEnabled) return;
    const my = myColor === 'white' ? whiteTime : blackTime;
    const op = myColor === 'white' ? blackTime : whiteTime;
    selfTimer.textContent = formatTime(my);
    opponentTimer.textContent = formatTime(op);
    selfTimer.classList.toggle('low-time', my < 30 && my > 0);
    opponentTimer.classList.toggle('low-time', op < 30 && op > 0);
}
function startTimer() { stopTimer(); lastTimerTick = Date.now(); timerInterval = setInterval(tickTimer, 100); }
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
function tickTimer() {
    if (!timerEnabled || engine.gameOver) { stopTimer(); return; }
    const dt = (Date.now() - lastTimerTick) / 1000; lastTimerTick = Date.now();
    if (engine.turn === 'white') {
        whiteTime -= dt;
        if (whiteTime <= 0) { whiteTime = 0; engine.gameOver = true; engine.result = 'timeout'; engine.winner = 'black'; stopTimer(); if (gameMode === 'online') send({ type: 'timeout', loser: 'white' }); updateTimerDisplay(); showGameOver(); return; }
    } else {
        blackTime -= dt;
        if (blackTime <= 0) { blackTime = 0; engine.gameOver = true; engine.result = 'timeout'; engine.winner = 'white'; stopTimer(); if (gameMode === 'online') send({ type: 'timeout', loser: 'black' }); updateTimerDisplay(); showGameOver(); return; }
    }
    updateTimerDisplay();
}

// ---- Status ----
function updateStatus() {
    const selfRow = document.querySelector('.player-row:last-of-type');
    const oppRow = document.querySelector('.player-row:first-of-type');
    // Use parent to find the right rows
    const rows = document.querySelectorAll('.player-row');
    const opp = rows[0], self = rows[1];

    if (engine.turn === myColor) {
        self.classList.add('active-turn'); opp.classList.remove('active-turn');
        gameStatus.textContent = 'À vous de jouer';
        gameStatus.className = 'status-text';
    } else {
        self.classList.remove('active-turn'); opp.classList.add('active-turn');
        gameStatus.textContent = gameMode === 'ai' ? "L'IA réfléchit…" : "Tour adverse";
        gameStatus.className = 'status-text';
    }
    if (engine.isInCheck(engine.turn)) {
        gameStatus.textContent += ' — ÉCHEC !';
        gameStatus.className = 'status-text check';
    }
}

function updateMoveHistory() {
    movesList.innerHTML = '';
    for (let i = 0; i < engine.moveHistory.length; i += 2) {
        const e = document.createElement('div');
        e.className = 'move-entry';
        const n = document.createElement('span'); n.className = 'move-number';
        n.textContent = (Math.floor(i / 2) + 1) + '.'; e.appendChild(n);
        const w = document.createElement('span');
        w.textContent = engine.moveHistory[i].notation; e.appendChild(w);
        if (i + 1 < engine.moveHistory.length) {
            const b = document.createElement('span');
            b.textContent = engine.moveHistory[i + 1].notation; e.appendChild(b);
        }
        movesList.appendChild(e);
    }
    movesList.scrollTop = movesList.scrollHeight;
}

// ---- Game Over ----
function showGameOver() {
    gameOverModal.classList.remove('hidden');
    btnResign.classList.add('hidden');
    btnBackMenu.classList.remove('hidden');
    stopTimer();
    const w = engine.winner === myColor;
    switch (engine.result) {
        case 'checkmate':
            gameOverIcon.textContent = w ? '🏆' : '💀';
            gameOverTitle.textContent = w ? 'Victoire !' : 'Défaite';
            gameOverMessage.textContent = w
                ? (gameMode === 'ai' ? "Échec et mat contre l'IA !" : 'Échec et mat !')
                : (gameMode === 'ai' ? "L'IA vous a maté." : 'Vous êtes maté.');
            break;
        case 'stalemate':
            gameOverIcon.textContent = '🤝'; gameOverTitle.textContent = 'Pat';
            gameOverMessage.textContent = 'Match nul.'; break;
        case 'draw':
            gameOverIcon.textContent = '🤝'; gameOverTitle.textContent = 'Nulle';
            gameOverMessage.textContent = 'Matériel insuffisant.'; break;
        case 'resign':
            gameOverIcon.textContent = '🏆'; gameOverTitle.textContent = 'Victoire !';
            gameOverMessage.textContent = "L'adversaire a abandonné."; break;
        case 'disconnect':
            gameOverIcon.textContent = '🔌'; gameOverTitle.textContent = 'Victoire';
            gameOverMessage.textContent = 'Déconnexion adverse.'; break;
        case 'timeout':
            gameOverIcon.textContent = w ? '🏆' : '⏱';
            gameOverTitle.textContent = w ? 'Victoire !' : 'Temps écoulé';
            gameOverMessage.textContent = w ? 'Temps adverse écoulé !' : 'Votre temps est écoulé.';
            break;
    }
}

btnResign.addEventListener('click', () => {
    if (!confirm('Abandonner ?')) return;
    if (gameMode === 'online') send({ type: 'resign' });
    engine.gameOver = true; engine.result = 'resign';
    engine.winner = myColor === 'white' ? 'black' : 'white';
    gameOverIcon.textContent = '🏳'; gameOverTitle.textContent = 'Abandon';
    gameOverMessage.textContent = 'Vous avez abandonné.';
    gameOverModal.classList.remove('hidden');
    btnResign.classList.add('hidden'); btnBackMenu.classList.remove('hidden');
});

btnBackMenu.addEventListener('click', backToLobby);
btnNewGame.addEventListener('click', backToLobby);

// ---- AI ----
function makeAIMove() {
    if (engine.gameOver || engine.turn !== aiColor) return;
    aiThinking = true; updateStatus();
    setTimeout(() => {
        const best = aiPlayer.findBestMove(engine, aiColor);
        if (best) { engine.makeMove(best.from, best.to, best.promotion || undefined); syncUI(); if (engine.gameOver) showGameOver(); }
        aiThinking = false; updateStatus();
    }, 100);
}

function backToLobby() {
    stopTimer(); if (ws) ws.close();
    aiPlayer = null; aiThinking = false;
    gameScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
    waitingPanel.classList.add('hidden');
    lobbyContent.classList.remove('hidden');
    lobbyStatus.classList.add('hidden');
    inputRoom.value = '';
}