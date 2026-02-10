/**
 * =========================================================================
 * ONLINE GAME MODULE — WebSocket multiplayer functionality
 * =========================================================================
 */

import { $, showToast, hide, show } from './core.js';

export class OnlineGame {
  constructor(uiManager, engine) {
    this.ui = uiManager;
    this.engine = engine;
    
    // WebSocket
    this.ws = null;
    this.roomId = null;
    this.myColor = null;
    
    // Matchmaking
    this.isMatchmaking = false;
    this.mmElapsedInterval = null;
    this.mmStartTime = null;
    
    // Timer
    this.timerEnabled = true;
    this.whiteTime = 300;
    this.blackTime = 300;
    this.timerInterval = null;
    this.lastTimerTick = null;
    
    // DOM
    this.lobbyContent = $('lobby-content');
    this.waitingPanel = $('waiting-panel');
    this.matchmakingPanel = $('matchmaking-panel');
    this.displayRoomCode = $('display-room-code');
    this.lobbyStatus = $('lobby-status');
    this.btnResign = $('btn-resign');
    this.btnBackMenu = $('btn-back-menu');
    
    // Callbacks
    this.onGameEnd = null;
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${protocol}://${location.host}/ws`);
    
    this.ws.onopen = () => {
      console.log('[Online] WebSocket connected');
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
    
    this.ws.onclose = () => {
      console.log('[Online] WebSocket disconnected');
      this.ws = null;
    };
    
    this.ws.onerror = () => {
      showToast(this.lobbyStatus, 'Erreur de connexion', 'error');
    };
  }

  /**
   * Send message to server
   */
  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        this.roomId = msg.room_id;
        this.displayRoomCode.textContent = msg.room_id;
        hide(this.lobbyContent);
        show(this.waitingPanel);
        hide(this.lobbyStatus);
        break;
        
      case 'game_start':
        this.myColor = msg.color;
        this.roomId = msg.room_id;
        this.ui.boardFlipped = this.myColor === 'black';
        
        // Stop matchmaking if active
        if (this.isMatchmaking) {
          this.isMatchmaking = false;
          this.stopMatchmakingTimer();
        }
        
        if (msg.time > 0) {
          this.timerEnabled = true;
          this.whiteTime = msg.time;
          this.blackTime = msg.time;
        } else {
          this.timerEnabled = false;
        }
        
        this.startGame();
        break;
        
      case 'move':
        this.engine.applyNetworkMove(msg.from, msg.to, msg.promotion || null);
        
        if (msg.white_time !== undefined) {
          this.whiteTime = msg.white_time;
          this.blackTime = msg.black_time;
        }
        
        this.syncUI();
        
        if (this.engine.gameOver) {
          this.stopTimer();
          this.showGameOver();
        }
        break;
        
      case 'opponent_resigned':
        this.engine.gameOver = true;
        this.engine.result = 'resign';
        this.engine.winner = this.myColor;
        this.stopTimer();
        this.showGameOver();
        break;
        
      case 'opponent_disconnected':
        this.engine.gameOver = true;
        this.engine.result = 'disconnect';
        this.engine.winner = this.myColor;
        this.stopTimer();
        this.showGameOver();
        break;
        
      case 'timeout':
        this.engine.gameOver = true;
        this.engine.result = 'timeout';
        this.engine.winner = msg.winner;
        this.stopTimer();
        this.showGameOver();
        break;
        
      case 'error':
        showToast(this.lobbyStatus, msg.message, 'error');
        break;
        
      case 'matchmaking_waiting':
        console.log('[Online] In matchmaking queue, size:', msg.queue_size);
        break;
        
      case 'matchmaking_cancelled':
        console.log('[Online] Matchmaking cancelled');
        this.isMatchmaking = false;
        this.stopMatchmakingTimer();
        break;
    }
  }

  /**
   * Create a new room
   */
  createRoom(timeLimit) {
    this.connect();
    
    const checkConnection = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        clearInterval(checkConnection);
        this.send({ type: 'create_room', time: timeLimit });
      }
    }, 100);
  }

  /**
   * Join existing room
   */
  joinRoom(roomCode) {
    this.connect();
    
    const checkConnection = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        clearInterval(checkConnection);
        this.send({ type: 'join_room', room_id: roomCode });
      }
    }, 100);
  }

  /**
   * Start matchmaking
   */
  startMatchmaking(timeLimit) {
    this.isMatchmaking = true;
    this.connect();
    
    const checkConnection = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        clearInterval(checkConnection);
        this.send({ type: 'matchmaking_join', time: timeLimit });
        this.startMatchmakingTimer();
      }
    }, 100);
  }

  /**
   * Cancel matchmaking
   */
  cancelMatchmaking() {
    this.isMatchmaking = false;
    this.stopMatchmakingTimer();
    this.send({ type: 'matchmaking_cancel' });
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Start matchmaking elapsed timer
   */
  startMatchmakingTimer() {
    this.mmStartTime = Date.now();
    const elapsedEl = $('mm-elapsed');
    
    this.mmElapsedInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.mmStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      elapsedEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    }, 1000);
  }

  /**
   * Stop matchmaking elapsed timer
   */
  stopMatchmakingTimer() {
    if (this.mmElapsedInterval) {
      clearInterval(this.mmElapsedInterval);
      this.mmElapsedInterval = null;
    }
  }

  /**
   * Start the game
   */
  startGame() {
    this.engine.reset();
    this.ui.reset();
    this.ui.myColor = this.myColor;
    
    hide($('lobby'));
    show($('game'));
    $('game').classList.add('active');
    hide(this.ui.gameOverModal);
    hide(this.btnBackMenu);
    show(this.btnResign);
    
    this.ui.updatePlayerInfo(this.myColor, 'online');
    this.ui.buildBoard(this.engine, (r, c) => this.onSquareClick(r, c));
    this.syncUI();
    
    if (this.timerEnabled) {
      this.startTimer();
    }
  }

  /**
   * Handle square click
   */
  onSquareClick(row, col) {
    if (this.engine.gameOver || this.engine.turn !== this.myColor) {
      return;
    }
    
    const piece = this.engine.getPiece(row, col);
    
    // Handle selection
    if (this.ui.selectedSquare) {
      // Click same square - deselect
      if (row === this.ui.selectedSquare.row && col === this.ui.selectedSquare.col) {
        this.ui.deselectSquare();
        this.ui.renderBoard(this.engine);
        return;
      }
      
      // Click own piece - change selection
      if (piece?.color === this.myColor) {
        this.ui.selectSquare(row, col, this.engine);
        this.ui.renderBoard(this.engine);
        return;
      }
      
      // Try to make move
      const move = this.ui.legalMoves.find(m => 
        m.to.row === row && m.to.col === col
      );
      
      if (move) {
        // Handle promotion
        if (move.promotion) {
          this.ui.showPromotionDialog((promotionType) => {
            this.makeMove(
              { ...this.ui.selectedSquare }, 
              { row, col }, 
              promotionType
            );
          });
          return;
        }
        
        // Normal move
        this.makeMove({ ...this.ui.selectedSquare }, { row, col });
      } else {
        // Invalid move - deselect
        this.ui.deselectSquare();
        this.ui.renderBoard(this.engine);
      }
    } else if (piece?.color === this.myColor) {
      // Select piece
      this.ui.selectSquare(row, col, this.engine);
      this.ui.renderBoard(this.engine);
    }
  }

  /**
   * Make a move
   */
  makeMove(from, to, promotion = null) {
    if (this.engine.makeMove(from, to, promotion)) {
      // Send move to server
      this.send({
        type: 'move',
        from,
        to,
        promotion,
        white_time: this.whiteTime,
        black_time: this.blackTime
      });
      
      this.ui.deselectSquare();
      this.syncUI();
      
      if (this.engine.gameOver) {
        this.stopTimer();
        this.showGameOver();
      }
    }
  }

  /**
   * Sync UI with game state
   */
  syncUI() {
    this.ui.updateCapturedPieces(this.engine);
    this.ui.renderBoard(this.engine);
    this.ui.updateStatus(this.engine, 'online');
    this.ui.updateMoveHistory(this.engine);
    this.ui.updateTimerDisplay(this.whiteTime, this.blackTime, this.timerEnabled);
  }

  /**
   * Resign from game
   */
  resign() {
    if (!confirm('Abandonner ?')) return;
    
    this.send({ type: 'resign' });
    
    this.engine.gameOver = true;
    this.engine.result = 'resign';
    this.engine.winner = this.myColor === 'white' ? 'black' : 'white';
    
    this.ui.gameOverIcon.textContent = '🏳';
    this.ui.gameOverTitle.textContent = 'Abandon';
    this.ui.gameOverMessage.textContent = 'Vous avez abandonné.';
    
    show(this.ui.gameOverModal);
    hide(this.btnResign);
    show(this.btnBackMenu);
  }

  /**
   * Show game over
   */
  showGameOver() {
    this.ui.showGameOver(this.engine, 'online');
    hide(this.btnResign);
    show(this.btnBackMenu);
    
    if (this.onGameEnd) {
      this.onGameEnd();
    }
  }

  /**
   * Timer management
   */
  startTimer() {
    this.stopTimer();
    this.lastTimerTick = Date.now();
    this.timerInterval = setInterval(() => this.tickTimer(), 100);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  tickTimer() {
    if (!this.timerEnabled || this.engine.gameOver) {
      this.stopTimer();
      return;
    }
    
    const deltaTime = (Date.now() - this.lastTimerTick) / 1000;
    this.lastTimerTick = Date.now();
    
    if (this.engine.turn === 'white') {
      this.whiteTime -= deltaTime;
      
      if (this.whiteTime <= 0) {
        this.whiteTime = 0;
        this.engine.gameOver = true;
        this.engine.result = 'timeout';
        this.engine.winner = 'black';
        
        this.stopTimer();
        this.send({ type: 'timeout', loser: 'white' });
        this.ui.updateTimerDisplay(this.whiteTime, this.blackTime, this.timerEnabled);
        this.showGameOver();
        return;
      }
    } else {
      this.blackTime -= deltaTime;
      
      if (this.blackTime <= 0) {
        this.blackTime = 0;
        this.engine.gameOver = true;
        this.engine.result = 'timeout';
        this.engine.winner = 'white';
        
        this.stopTimer();
        this.send({ type: 'timeout', loser: 'black' });
        this.ui.updateTimerDisplay(this.whiteTime, this.blackTime, this.timerEnabled);
        this.showGameOver();
        return;
      }
    }
    
    this.ui.updateTimerDisplay(this.whiteTime, this.blackTime, this.timerEnabled);
  }

  /**
   * Clean up and disconnect
   */
  cleanup() {
    this.stopTimer();
    this.stopMatchmakingTimer();
    this.isMatchmaking = false;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.roomId = null;
    this.myColor = null;
  }
}
