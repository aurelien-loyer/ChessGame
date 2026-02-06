/**
 * app.js - Interface et logique réseau pour le jeu d'échecs en ligne.
 */

// ---- État global ----
let ws = null;
let engine = new ChessEngine();
let myColor = null;        // 'white' ou 'black'
let roomId = null;
let selectedSquare = null; // { row, col }
let legalMoves = [];       // coups légaux pour la pièce sélectionnée
let boardFlipped = false;
let selectedTime = 300;    // temps sélectionné en secondes (défaut: 5 min)
let timerEnabled = true;
let whiteTime = 300;
let blackTime = 300;
let timerInterval = null;
let lastTimerTick = null;

// ---- Éléments DOM ----
const lobbyScreen = document.getElementById('lobby');
const gameScreen = document.getElementById('game');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const inputRoom = document.getElementById('input-room');
const lobbyStatus = document.getElementById('lobby-status');
const waitingPanel = document.getElementById('waiting-panel');
const displayRoomCode = document.getElementById('display-room-code');
const btnCopyCode = document.getElementById('btn-copy-code');
const btnCancel = document.getElementById('btn-cancel');
const boardEl = document.getElementById('board');
const gameStatus = document.getElementById('game-status');
const movesList = document.getElementById('moves-list');
const btnResign = document.getElementById('btn-resign');
const btnBackMenu = document.getElementById('btn-back-menu');
const btnNewGame = document.getElementById('btn-new-game');
const promotionDialog = document.getElementById('promotion-dialog');
const promotionChoices = document.getElementById('promotion-choices');
const gameOverModal = document.getElementById('game-over');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMessage = document.getElementById('game-over-message');
const selfIndicator = document.getElementById('self-indicator');
const opponentIndicator = document.getElementById('opponent-indicator');
const selfLabel = document.getElementById('self-label');
const opponentLabel = document.getElementById('opponent-label');
const selfTimer = document.getElementById('self-timer');
const opponentTimer = document.getElementById('opponent-timer');

// ---- WebSocket ----
function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);

    ws.onopen = () => {
        console.log('WebSocket connecté');
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
    };

    ws.onclose = () => {
        console.log('WebSocket déconnecté');
        ws = null;
    };

    ws.onerror = (err) => {
        console.error('WebSocket erreur:', err);
        showLobbyStatus('Erreur de connexion au serveur', 'error');
    };
}

function sendMessage(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function handleServerMessage(msg) {
    switch (msg.type) {
        case 'room_created':
            roomId = msg.room_id;
            displayRoomCode.textContent = roomId;
            document.querySelector('.lobby-actions').classList.add('hidden');
            waitingPanel.classList.remove('hidden');
            lobbyStatus.classList.add('hidden');
            break;

        case 'game_start':
            myColor = msg.color;
            roomId = msg.room_id;
            boardFlipped = (myColor === 'black');
            // Timer
            if (msg.time && msg.time > 0) {
                timerEnabled = true;
                selectedTime = msg.time;
                whiteTime = msg.time;
                blackTime = msg.time;
            } else {
                timerEnabled = false;
            }
            startGame();
            break;

        case 'move':
            // Appliquer le coup de l'adversaire
            const from = msg.from;
            const to = msg.to;
            engine.applyNetworkMove(from, to, msg.promotion || null);
            // Synchroniser les timers si envoyés
            if (msg.white_time !== undefined) {
                whiteTime = msg.white_time;
                blackTime = msg.black_time;
            }
            renderBoard();
            updateStatus();
            updateMoveHistory();
            updateTimerDisplay();
            if (engine.gameOver) {
                stopTimer();
                showGameOver();
            }
            break;

        case 'opponent_resigned':
            engine.gameOver = true;
            engine.result = 'resign';
            engine.winner = myColor;
            stopTimer();
            showGameOver();
            break;

        case 'opponent_disconnected':
            engine.gameOver = true;
            engine.result = 'disconnect';
            engine.winner = myColor;
            stopTimer();
            showGameOver();
            break;

        case 'timeout':
            engine.gameOver = true;
            engine.result = 'timeout';
            engine.winner = msg.winner;
            stopTimer();
            showGameOver();
            break;

        case 'error':
            showLobbyStatus(msg.message, 'error');
            break;
    }
}

// ---- Lobby ----
function showLobbyStatus(text, type = 'info') {
    lobbyStatus.textContent = text;
    lobbyStatus.className = 'status-message ' + type;
    lobbyStatus.classList.remove('hidden');
}

// ---- Time selection ----
document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedTime = parseInt(btn.dataset.time);
    });
});

btnCreate.addEventListener('click', () => {
    connectWS();
    const interval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            clearInterval(interval);
            sendMessage({ type: 'create_room', time: selectedTime });
        }
    }, 100);
});

btnJoin.addEventListener('click', () => {
    const code = inputRoom.value.trim().toUpperCase();
    if (!code || code.length < 3) {
        showLobbyStatus('Entrez un code de salon valide', 'error');
        return;
    }
    connectWS();
    const interval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            clearInterval(interval);
            sendMessage({ type: 'join_room', room_id: code });
        }
    }, 100);
});

inputRoom.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
});

btnCopyCode.addEventListener('click', () => {
    navigator.clipboard.writeText(roomId).then(() => {
        btnCopyCode.textContent = '✓ Copié !';
        setTimeout(() => { btnCopyCode.textContent = '📋 Copier'; }, 2000);
    });
});

btnCancel.addEventListener('click', () => {
    if (ws) ws.close();
    waitingPanel.classList.add('hidden');
    document.querySelector('.lobby-actions').classList.remove('hidden');
    lobbyStatus.classList.add('hidden');
});

// ---- Game ----
function startGame() {
    engine.reset();
    selectedSquare = null;
    legalMoves = [];

    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameOverModal.classList.add('hidden');
    btnBackMenu.classList.add('hidden');
    btnResign.classList.remove('hidden');
    movesList.innerHTML = '';

    // Couleurs des joueurs
    selfIndicator.className = 'player-indicator ' + myColor + '-piece';
    opponentIndicator.className = 'player-indicator ' + (myColor === 'white' ? 'black' : 'white') + '-piece';
    selfLabel.textContent = 'Vous (' + (myColor === 'white' ? 'Blancs' : 'Noirs') + ')';
    opponentLabel.textContent = 'Adversaire (' + (myColor === 'white' ? 'Noirs' : 'Blancs') + ')';

    // Timers
    if (timerEnabled) {
        selfTimer.classList.remove('hidden');
        opponentTimer.classList.remove('hidden');
        updateTimerDisplay();
        startTimer();
    } else {
        selfTimer.classList.add('hidden');
        opponentTimer.classList.add('hidden');
    }

    buildBoard();
    renderBoard();
    updateStatus();
}

function buildBoard() {
    boardEl.innerHTML = '';

    // Labels
    const files = 'abcdefgh';
    const labelsTop = document.getElementById('labels-top');
    const labelsBottom = document.getElementById('labels-bottom');
    const labelsLeft = document.getElementById('labels-left');
    const labelsRight = document.getElementById('labels-right');

    labelsTop.innerHTML = '';
    labelsBottom.innerHTML = '';
    labelsLeft.innerHTML = '';
    labelsRight.innerHTML = '';

    for (let i = 0; i < 8; i++) {
        const ci = boardFlipped ? 7 - i : i;
        const ri = boardFlipped ? 7 - i : i;

        const ft = document.createElement('span');
        ft.textContent = files[ci];
        labelsTop.appendChild(ft);

        const fb = document.createElement('span');
        fb.textContent = files[ci];
        labelsBottom.appendChild(fb);

        const rl = document.createElement('span');
        rl.textContent = 8 - ri;
        labelsLeft.appendChild(rl);

        const rr = document.createElement('span');
        rr.textContent = 8 - ri;
        labelsRight.appendChild(rr);
    }

    for (let displayRow = 0; displayRow < 8; displayRow++) {
        for (let displayCol = 0; displayCol < 8; displayCol++) {
            const row = boardFlipped ? 7 - displayRow : displayRow;
            const col = boardFlipped ? 7 - displayCol : displayCol;

            const sq = document.createElement('div');
            sq.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
            sq.dataset.row = row;
            sq.dataset.col = col;
            sq.addEventListener('click', () => onSquareClick(row, col));
            boardEl.appendChild(sq);
        }
    }
}

function renderBoard() {
    const squares = boardEl.querySelectorAll('.square');
    const kingPos = engine.isInCheck(engine.turn) ? engine.getKingPosition(engine.turn) : null;

    squares.forEach(sq => {
        const row = parseInt(sq.dataset.row);
        const col = parseInt(sq.dataset.col);
        const piece = engine.getPiece(row, col);

        // Reset classes
        sq.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');

        // Pièce
        sq.innerHTML = '';
        if (piece) {
            sq.classList.add('has-piece');
            const span = document.createElement('span');
            span.className = 'piece ' + piece.color + '-piece';
            span.textContent = PIECE_SYMBOLS[piece.type][piece.color];
            sq.appendChild(span);
        }

        // Sélection
        if (selectedSquare && row === selectedSquare.row && col === selectedSquare.col) {
            sq.classList.add('selected');
        }

        // Dernier coup
        if (engine.lastMove) {
            if ((row === engine.lastMove.from.row && col === engine.lastMove.from.col) ||
                (row === engine.lastMove.to.row && col === engine.lastMove.to.col)) {
                sq.classList.add('last-move');
            }
        }

        // Coups légaux
        const isLegal = legalMoves.some(m => m.to.row === row && m.to.col === col);
        if (isLegal) {
            if (piece) {
                sq.classList.add('legal-capture');
            } else {
                sq.classList.add('legal-move');
            }
        }

        // En passant: marquer la case cible comme capturable
        if (selectedSquare) {
            const selPiece = engine.getPiece(selectedSquare.row, selectedSquare.col);
            if (selPiece && selPiece.type === 'P') {
                const epMove = legalMoves.find(m =>
                    m.to.row === row && m.to.col === col && m.isEnPassant
                );
                if (epMove) {
                    sq.classList.add('legal-capture');
                    sq.classList.remove('legal-move');
                }
            }
        }

        // Échec
        if (kingPos && row === kingPos.row && col === kingPos.col) {
            sq.classList.add('check-square');
        }
    });
}

function onSquareClick(row, col) {
    if (engine.gameOver) return;
    if (engine.turn !== myColor) return; // Pas notre tour

    const piece = engine.getPiece(row, col);

    // Si une pièce est sélectionnée, essayer de jouer
    if (selectedSquare) {
        // Clic sur la même case → désélectionner
        if (row === selectedSquare.row && col === selectedSquare.col) {
            deselectPiece();
            renderBoard();
            return;
        }

        // Clic sur une autre pièce de notre couleur → sélectionner celle-ci
        if (piece && piece.color === myColor) {
            selectPiece(row, col);
            renderBoard();
            return;
        }

        // Essayer le coup
        const move = legalMoves.find(m => m.to.row === row && m.to.col === col);
        if (move) {
            // Promotion ?
            if (move.promotion) {
                showPromotionDialog(selectedSquare, { row, col });
                return;
            }

            const from = { ...selectedSquare };
            const to = { row, col };
            if (engine.makeMove(from, to)) {
                // Envoyer au serveur
                sendMessage({
                    type: 'move',
                    from: from,
                    to: to,
                    white_time: whiteTime,
                    black_time: blackTime
                });
                deselectPiece();
                renderBoard();
                updateStatus();
                updateMoveHistory();
                updateTimerDisplay();

                if (engine.gameOver) {
                    showGameOver();
                }
            }
        } else {
            deselectPiece();
            renderBoard();
        }
    } else {
        // Sélectionner une pièce
        if (piece && piece.color === myColor) {
            selectPiece(row, col);
            renderBoard();
        }
    }
}

function selectPiece(row, col) {
    selectedSquare = { row, col };
    legalMoves = engine.getLegalMoves(row, col);
}

function deselectPiece() {
    selectedSquare = null;
    legalMoves = [];
}

// ---- Promotion ----
function showPromotionDialog(from, to) {
    promotionDialog.classList.remove('hidden');
    promotionChoices.innerHTML = '';

    const promoTypes = ['Q', 'R', 'B', 'N'];
    for (const type of promoTypes) {
        const btn = document.createElement('div');
        btn.className = 'promotion-choice';
        btn.textContent = PIECE_SYMBOLS[type][myColor];
        btn.addEventListener('click', () => {
            promotionDialog.classList.add('hidden');

            if (engine.makeMove(from, to, type)) {
                sendMessage({
                    type: 'move',
                    from: from,
                    to: to,
                    promotion: type,
                    white_time: whiteTime,
                    black_time: blackTime
                });
                deselectPiece();
                renderBoard();
                updateStatus();
                updateMoveHistory();

                if (engine.gameOver) {
                    showGameOver();
                }
            }
        });
        promotionChoices.appendChild(btn);
    }
}

// ---- Timer ----
function formatTime(seconds) {
    if (seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + secs.toString().padStart(2, '0');
}

function updateTimerDisplay() {
    if (!timerEnabled) return;

    const myTime = myColor === 'white' ? whiteTime : blackTime;
    const oppTime = myColor === 'white' ? blackTime : whiteTime;

    selfTimer.textContent = formatTime(myTime);
    opponentTimer.textContent = formatTime(oppTime);

    // Low time warning (< 30s)
    selfTimer.classList.toggle('low-time', myTime < 30 && myTime > 0);
    opponentTimer.classList.toggle('low-time', oppTime < 30 && oppTime > 0);
}

function startTimer() {
    stopTimer();
    lastTimerTick = Date.now();
    timerInterval = setInterval(tickTimer, 100);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function tickTimer() {
    if (!timerEnabled || engine.gameOver) {
        stopTimer();
        return;
    }

    const now = Date.now();
    const dt = (now - lastTimerTick) / 1000;
    lastTimerTick = now;

    // Décrémenter le timer du joueur actif
    if (engine.turn === 'white') {
        whiteTime -= dt;
        if (whiteTime <= 0) {
            whiteTime = 0;
            engine.gameOver = true;
            engine.result = 'timeout';
            engine.winner = 'black';
            stopTimer();
            sendMessage({ type: 'timeout', loser: 'white' });
            updateTimerDisplay();
            showGameOver();
            return;
        }
    } else {
        blackTime -= dt;
        if (blackTime <= 0) {
            blackTime = 0;
            engine.gameOver = true;
            engine.result = 'timeout';
            engine.winner = 'white';
            stopTimer();
            sendMessage({ type: 'timeout', loser: 'black' });
            updateTimerDisplay();
            showGameOver();
            return;
        }
    }

    updateTimerDisplay();
}

// ---- Status ----
function updateStatus() {
    const selfInfo = document.querySelector('.player-info.self');
    const oppInfo = document.querySelector('.player-info.opponent');

    if (engine.turn === myColor) {
        selfInfo.classList.add('active-turn');
        oppInfo.classList.remove('active-turn');
        gameStatus.textContent = 'À vous de jouer';
        gameStatus.className = 'game-status';
    } else {
        selfInfo.classList.remove('active-turn');
        oppInfo.classList.add('active-turn');
        gameStatus.textContent = "Tour de l'adversaire";
        gameStatus.className = 'game-status';
    }

    if (engine.isInCheck(engine.turn)) {
        gameStatus.textContent += ' — ÉCHEC !';
        gameStatus.className = 'game-status check';
    }
}

function updateMoveHistory() {
    movesList.innerHTML = '';
    for (let i = 0; i < engine.moveHistory.length; i += 2) {
        const moveNum = Math.floor(i / 2) + 1;
        const entry = document.createElement('div');
        entry.className = 'move-entry';

        const num = document.createElement('span');
        num.className = 'move-number';
        num.textContent = moveNum + '.';
        entry.appendChild(num);

        const whiteMove = document.createElement('span');
        whiteMove.textContent = engine.moveHistory[i].notation;
        entry.appendChild(whiteMove);

        if (i + 1 < engine.moveHistory.length) {
            const blackMove = document.createElement('span');
            blackMove.textContent = engine.moveHistory[i + 1].notation;
            entry.appendChild(blackMove);
        }

        movesList.appendChild(entry);
    }
    movesList.scrollTop = movesList.scrollHeight;
}

// ---- Game Over ----
function showGameOver() {
    gameOverModal.classList.remove('hidden');
    btnResign.classList.add('hidden');
    btnBackMenu.classList.remove('hidden');
    stopTimer();

    switch (engine.result) {
        case 'checkmate': {
            const isWinner = engine.winner === myColor;
            gameOverTitle.textContent = isWinner ? '🏆 Victoire !' : '💀 Défaite';
            gameOverMessage.textContent = isWinner
                ? 'Vous avez mis votre adversaire échec et mat !'
                : 'Vous êtes échec et mat.';
            break;
        }
        case 'stalemate':
            gameOverTitle.textContent = '🤝 Pat';
            gameOverMessage.textContent = 'Match nul par pat.';
            break;
        case 'draw':
            gameOverTitle.textContent = '🤝 Nulle';
            gameOverMessage.textContent = 'Match nul par matériel insuffisant.';
            break;
        case 'resign':
            gameOverTitle.textContent = '🏆 Victoire !';
            gameOverMessage.textContent = "Votre adversaire a abandonné.";
            break;
        case 'disconnect':
            gameOverTitle.textContent = '🏆 Victoire';
            gameOverMessage.textContent = "Votre adversaire s'est déconnecté.";
            break;
        case 'timeout': {
            const isWinner = engine.winner === myColor;
            gameOverTitle.textContent = isWinner ? '🏆 Victoire !' : '⏱ Temps écoulé';
            gameOverMessage.textContent = isWinner
                ? 'Votre adversaire a dépassé le temps !'
                : 'Votre temps est écoulé.';
            break;
        }
    }
}

btnResign.addEventListener('click', () => {
    if (confirm('Voulez-vous vraiment abandonner ?')) {
        sendMessage({ type: 'resign' });
        engine.gameOver = true;
        engine.result = 'resign';
        engine.winner = myColor === 'white' ? 'black' : 'white';

        gameOverTitle.textContent = '🏳 Abandon';
        gameOverMessage.textContent = 'Vous avez abandonné la partie.';
        gameOverModal.classList.remove('hidden');
        btnResign.classList.add('hidden');
        btnBackMenu.classList.remove('hidden');
    }
});

btnBackMenu.addEventListener('click', () => {
    backToLobby();
});

btnNewGame.addEventListener('click', () => {
    backToLobby();
});

function backToLobby() {
    stopTimer();
    if (ws) ws.close();
    gameScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
    waitingPanel.classList.add('hidden');
    document.querySelector('.lobby-actions').classList.remove('hidden');
    lobbyStatus.classList.add('hidden');
    inputRoom.value = '';
}
