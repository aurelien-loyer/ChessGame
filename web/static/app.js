/**
 * =========================================================================
 * CHESS ARENA — Main Application Controller
 * =========================================================================
 * Professional modular architecture
 * - Separated online (multiplayer) and offline (AI) game modes
 * - Clean dependency injection
 * - Single responsibility principle
 * =========================================================================
 */

import { $, showToast, hide, show } from './modules/core.js';
import { UIManager } from './modules/ui.js';
import { OnlineGame } from './modules/online.js';
import { OfflineGame } from './modules/offline.js';

/**
 * Application Controller
 */
class ChessApp {
  constructor() {
    // Core engine
    this.engine = new ChessEngine();
    
    // UI Manager
    this.ui = new UIManager();
    
    // Game modes
    this.onlineGame = new OnlineGame(this.ui, this.engine);
    this.offlineGame = new OfflineGame(this.ui, this.engine);
    
    // State
    this.currentMode = 'online';
    this.selectedTime = 300;
    
    // DOM References
    this.lobbyScreen = $('lobby');
    this.gameScreen = $('game');
    this.lobbyContent = $('lobby-content');
    this.waitingPanel = $('waiting-panel');
    this.lobbyStatus = $('lobby-status');
    this.inputRoom = $('input-room');
    
    // Initialize
    this.setupEventListeners();
    this.setupGameCallbacks();
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Mode selection
    document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => this.selectMode(btn.dataset.mode));
    });
    
    // Time control selection
    document.querySelectorAll('.time-btn[data-time]').forEach(btn => {
      btn.addEventListener('click', () => this.selectTime(parseInt(btn.dataset.time)));
    });
    
    // Difficulty selection
    document.querySelectorAll('.diff-btn.diff').forEach(btn => {
      btn.addEventListener('click', () => this.selectDifficulty(parseInt(btn.dataset.diff)));
    });
    
    // Color selection
    document.querySelectorAll('.color-btn.color-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn.color-pick').forEach(b => 
          b.classList.remove('active')
        );
        btn.classList.add('active');
      });
    });
    
    // Online actions
    $('btn-create').addEventListener('click', () => this.createOnlineGame());
    $('btn-join').addEventListener('click', () => this.joinOnlineGame());
    $('input-room').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.joinOnlineGame();
    });
    
    // Waiting room actions
    $('btn-copy-code').addEventListener('click', () => this.copyRoomCode());
    $('btn-cancel').addEventListener('click', () => this.cancelWaiting());
    
    // AI actions
    $('btn-play-ai').addEventListener('click', () => this.startAIGame());
    
    // Game actions
    $('btn-resign').addEventListener('click', () => this.resign());
    $('btn-back-menu').addEventListener('click', () => this.backToLobby());
    $('btn-new-game').addEventListener('click', () => this.backToLobby());
  }

  /**
   * Setup game callbacks
   */
  setupGameCallbacks() {
    this.onlineGame.onGameEnd = () => {
      console.log('[App] Online game ended');
    };
    
    this.offlineGame.onGameEnd = () => {
      console.log('[App] Offline game ended');
    };
  }

  /**
   * Select game mode
   */
  selectMode(mode) {
    this.currentMode = mode;
    
    document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    $('online-actions').classList.toggle('hidden', mode !== 'online');
    $('ai-actions').classList.toggle('hidden', mode !== 'ai');
  }

  /**
   * Select time control
   */
  selectTime(time) {
    this.selectedTime = time;
    
    document.querySelectorAll('.time-btn[data-time]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.time) === time);
    });
  }

  /**
   * Select AI difficulty
   */
  selectDifficulty(difficulty) {
    this.offlineGame.aiDifficulty = difficulty;
    
    document.querySelectorAll('.diff-btn.diff').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.diff) === difficulty);
    });
  }

  /**
   * Create online game
   */
  createOnlineGame() {
    console.log('[App] Creating online game...');
    this.onlineGame.createRoom(this.selectedTime);
  }

  /**
   * Join online game
   */
  joinOnlineGame() {
    const code = this.inputRoom.value.trim().toUpperCase();
    
    if (!code || code.length < 3) {
      showToast(this.lobbyStatus, 'Code invalide', 'error');
      return;
    }
    
    console.log('[App] Joining room:', code);
    this.onlineGame.joinRoom(code);
  }

  /**
   * Copy room code to clipboard
   */
  copyRoomCode() {
    const roomCode = this.onlineGame.roomId;
    
    if (!roomCode) return;
    
    navigator.clipboard.writeText(roomCode).then(() => {
      const btn = $('btn-copy-code');
      btn.textContent = '✓ Copié';
      setTimeout(() => {
        btn.textContent = '📋 Copier le code';
      }, 2000);
    }).catch(err => {
      console.error('[App] Failed to copy:', err);
    });
  }

  /**
   * Cancel waiting for opponent
   */
  cancelWaiting() {
    this.onlineGame.cleanup();
    hide(this.waitingPanel);
    show(this.lobbyContent);
    hide(this.lobbyStatus);
  }

  /**
   * Start AI game
   */
  startAIGame() {
    const colorBtn = document.querySelector('.color-btn.color-pick.active');
    let playerColor = colorBtn?.dataset.color || 'white';
    
    if (playerColor === 'random') {
      playerColor = Math.random() < 0.5 ? 'white' : 'black';
    }
    
    console.log('[App] Starting AI game as', playerColor);
    
    this.offlineGame.startGame(
      playerColor,
      this.offlineGame.aiDifficulty,
      this.selectedTime
    );
  }

  /**
   * Resign from current game
   */
  resign() {
    if (this.currentMode === 'online') {
      this.onlineGame.resign();
    } else {
      this.offlineGame.resign();
    }
  }

  /**
   * Return to lobby
   */
  backToLobby() {
    console.log('[App] Returning to lobby...');
    
    // Cleanup current game
    if (this.currentMode === 'online') {
      this.onlineGame.cleanup();
    } else {
      this.offlineGame.cleanup();
    }
    
    // Reset UI
    hide(this.gameScreen);
    this.gameScreen.classList.remove('active');
    show(this.lobbyScreen);
    this.lobbyScreen.classList.add('active');
    
    hide(this.waitingPanel);
    show(this.lobbyContent);
    hide(this.lobbyStatus);
    
    this.inputRoom.value = '';
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[App] Initializing Chess Arena...');
  window.chessApp = new ChessApp();
  console.log('[App] Ready!');
});
