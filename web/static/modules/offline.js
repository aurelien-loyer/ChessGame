/**
 * =========================================================================
 * OFFLINE GAME MODULE — Local AI gameplay
 * =========================================================================
 */

import { $, hide, show } from './core.js';

export class OfflineGame {
  constructor(uiManager, engine) {
    this.ui = uiManager;
    this.engine = engine;
    
    // AI
    this.aiPlayer = null;
    this.aiDifficulty = AI_DIFFICULTY.MEDIUM;
    this.aiColor = 'black';
    this.playerColor = 'white';
    this.aiThinking = false;
    
    // Timer
    this.timerEnabled = true;
    this.whiteTime = 300;
    this.blackTime = 300;
    this.timerInterval = null;
    this.lastTimerTick = null;
    
    // DOM
    this.btnResign = $('btn-resign');
    this.btnBackMenu = $('btn-back-menu');
    
    // Callbacks
    this.onGameEnd = null;
  }

  /**
   * Start a new AI game
   */
  startGame(playerColor, aiDifficulty, timeLimit) {
    // Setup colors
    this.playerColor = playerColor;
    this.aiColor = playerColor === 'white' ? 'black' : 'white';
    this.aiDifficulty = aiDifficulty;
    
    // Setup AI
    this.aiPlayer = new ChessAI(aiDifficulty);
    
    // Setup timer
    if (timeLimit > 0) {
      this.timerEnabled = true;
      this.whiteTime = timeLimit;
      this.blackTime = timeLimit;
    } else {
      this.timerEnabled = false;
    }
    
    // Reset state
    this.engine.reset();
    this.ui.reset();
    this.ui.myColor = playerColor;
    this.ui.boardFlipped = playerColor === 'black';
    this.aiThinking = false;
    
    // Show game screen
    hide($('lobby'));
    show($('game'));
    $('game').classList.add('active');
    hide(this.ui.gameOverModal);
    hide(this.btnBackMenu);
    show(this.btnResign);
    
    // Setup UI
    this.ui.updatePlayerInfo(playerColor, 'ai', aiDifficulty);
    this.ui.buildBoard(this.engine, (r, c) => this.onSquareClick(r, c));
    this.syncUI();
    
    if (this.timerEnabled) {
      this.startTimer();
    }
    
    // AI plays first if white
    if (this.aiColor === 'white') {
      setTimeout(() => this.makeAIMove(), 100);
    }
  }

  /**
   * Handle square click
   */
  onSquareClick(row, col) {
    // Prevent interaction during AI turn or game over
    if (this.engine.gameOver || 
        this.engine.turn !== this.playerColor || 
        this.aiThinking) {
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
      if (piece?.color === this.playerColor) {
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
    } else if (piece?.color === this.playerColor) {
      // Select piece
      this.ui.selectSquare(row, col, this.engine);
      this.ui.renderBoard(this.engine);
    }
  }

  /**
   * Make a player move
   */
  makeMove(from, to, promotion = null) {
    if (this.engine.makeMove(from, to, promotion)) {
      this.ui.deselectSquare();
      this.syncUI();
      
      if (this.engine.gameOver) {
        this.stopTimer();
        this.showGameOver();
      } else {
        // AI's turn — use setTimeout(0) to let browser paint player's move first
        setTimeout(() => this.makeAIMove(), 0);
      }
    }
  }

  /**
   * Get AI thinking delay based on difficulty (in ms)
   * Reduced delays since computation is now time-budgeted
   */
  getAIDelay() {
    const baseDelay = {
      1: 200,   // Facile: 0.2s
      2: 300,   // Moyen: 0.3s
      3: 400,   // Difficile: 0.4s
      4: 500    // Expert: 0.5s
    };
    const base = baseDelay[this.aiDifficulty] || 300;
    // Add some random variation (±20%) for natural feel
    const variation = base * 0.2;
    return base + (Math.random() * variation * 2 - variation);
  }

  /**
   * Make AI move
   */
  makeAIMove() {
    if (this.engine.gameOver || this.engine.turn !== this.aiColor) {
      return;
    }
    
    this.aiThinking = true;
    this.ui.updateStatus(this.engine, 'ai', true);
    
    // Compute AI move immediately, then delay the execution for UX
    const bestMove = this.aiPlayer.findBestMove(this.engine, this.aiColor);
    const delay = this.getAIDelay();
    
    setTimeout(() => {
      if (bestMove) {
        this.engine.makeMove(
          bestMove.from, 
          bestMove.to, 
          bestMove.promotion || undefined
        );
        
        this.syncUI();
        
        if (this.engine.gameOver) {
          this.stopTimer();
          this.showGameOver();
        }
      }
      
      this.aiThinking = false;
      this.ui.updateStatus(this.engine, 'ai', false);
    }, delay);
  }

  /**
   * Sync UI with game state
   */
  syncUI() {
    this.ui.updateCapturedPieces(this.engine);
    this.ui.renderBoard(this.engine);
    this.ui.updateStatus(this.engine, 'ai', this.aiThinking);
    this.ui.updateMoveHistory(this.engine);
    this.ui.updateTimerDisplay(this.whiteTime, this.blackTime, this.timerEnabled);
  }

  /**
   * Resign from game
   */
  resign() {
    if (!confirm('Abandonner ?')) return;
    
    this.engine.gameOver = true;
    this.engine.result = 'resign';
    this.engine.winner = this.playerColor === 'white' ? 'black' : 'white';
    
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
    this.ui.showGameOver(this.engine, 'ai');
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
        this.ui.updateTimerDisplay(this.whiteTime, this.blackTime, this.timerEnabled);
        this.showGameOver();
        return;
      }
    }
    
    this.ui.updateTimerDisplay(this.whiteTime, this.blackTime, this.timerEnabled);
  }

  /**
   * Clean up
   */
  cleanup() {
    this.stopTimer();
    this.aiPlayer = null;
    this.aiThinking = false;
  }
}
