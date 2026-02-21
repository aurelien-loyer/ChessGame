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
    this.username = null;
    this.salonMode = false;
    
    // DOM References
    this.modeSelectScreen = $('mode-select-screen');
    this.welcomeScreen = $('welcome-screen');
    this.lobbyScreen = $('lobby');
    this.gameScreen = $('game');
    this.lobbyContent = $('lobby-content');
    this.waitingPanel = $('waiting-panel');
    this.matchmakingPanel = $('matchmaking-panel');
    this.lobbyStatus = $('lobby-status');
    this.inputRoom = $('input-room');
    
    // Initialize
    this.setupModeSelectScreen();
    this.setupWelcomeScreen();
    this.setupEventListeners();
    this.setupGameCallbacks();
  }

  /**
   * Setup mode selection screen
   */
  setupModeSelectScreen() {
    const btnBasic = $('btn-mode-basic');
    const btnSalon = $('btn-mode-salon');

    btnBasic.addEventListener('click', () => {
      this.salonMode = false;
      this.transitionToWelcome();
    });

    btnSalon.addEventListener('click', () => {
      this.salonMode = true;
      this.transitionToWelcome();
    });

    // Spawn floating chess piece particles
    this.spawnParticles();
  }

  /**
   * Spawn floating particles for mode selection background
   */
  spawnParticles() {
    const container = $('ms-particles');
    if (!container) return;
    const pieces = ['♔','♕','♖','♗','♘','♙','♚','♛','♜','♝','♞','♟'];
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('span');
      el.className = 'ms-particle';
      el.textContent = pieces[Math.floor(Math.random() * pieces.length)];
      el.style.left = Math.random() * 100 + '%';
      el.style.fontSize = (16 + Math.random() * 24) + 'px';
      el.style.animationDuration = (12 + Math.random() * 18) + 's';
      el.style.animationDelay = -(Math.random() * 20) + 's';
      container.appendChild(el);
    }
  }

  /**
   * Transition from mode select to welcome screen
   */
  transitionToWelcome() {
    hide(this.modeSelectScreen);
    this.modeSelectScreen.classList.remove('active');
    show(this.welcomeScreen);
    this.welcomeScreen.classList.add('active');
    setTimeout(() => $('input-username').focus(), 200);
  }

  /**
   * Setup welcome screen
   */
  setupWelcomeScreen() {
    const btnEnter = $('btn-enter');
    
    const enterLobby = () => {
      // Auto-generate cool username if none stored
      let name = localStorage.getItem('chess_username');
      if (!name) {
          const adjs = ['Grand', 'Royal', 'Speedy', 'Silent', 'Golden', 'Silver', 'Iron', 'Mystic'];
          const nouns = ['King', 'Rook', 'Knight', 'Pawn', 'Master', 'Legend', 'Ghost', 'Wolf'];
          name = adjs[Math.floor(Math.random()*adjs.length)] + ' ' + nouns[Math.floor(Math.random()*nouns.length)];
          localStorage.setItem('chess_username', name);
      }
      
      this.username = name;
      
      // Pass username to online game
      this.onlineGame.username = name;
      
      // Show tagline with username
      const tagline = $('welcome-tagline');
      if (tagline) tagline.textContent = `Bienvenue, ${name} !`;
      
      // Adapt lobby for salon mode (silently force AI)
      if (this.salonMode) {
        this.setupSalonLobby();
      } else {
        this.resetLobbyToNormal();
      }
      
      // Transition
      hide(this.welcomeScreen);
      this.welcomeScreen.classList.remove('active');
      show(this.lobbyScreen);
      this.lobbyScreen.classList.add('active');
    };

    btnEnter.addEventListener('click', enterLobby);
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
    
    // Matchmaking
    $('btn-matchmaking').addEventListener('click', () => this.startMatchmaking());
    $('btn-cancel-mm').addEventListener('click', () => this.cancelMatchmaking());
    
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
   * Setup lobby for salon mode — silently force AI only
   */
  setupSalonLobby() {
    // Force AI mode
    this.currentMode = 'ai';
    
    // Hide mode switch so user can't switch to online
    const modeSwitch = document.querySelector('.mode-switch');
    if (modeSwitch) modeSwitch.classList.add('hidden');
    
    // Show AI actions, hide online actions
    $('online-actions').classList.add('hidden');
    $('ai-actions').classList.remove('hidden');
  }

  /**
   * Reset lobby to normal mode (all options visible)
   */
  resetLobbyToNormal() {
    const modeSwitch = document.querySelector('.mode-switch');
    if (modeSwitch) modeSwitch.classList.remove('hidden');
    
    // Reset to online mode
    this.currentMode = 'online';
    this.selectMode('online');
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
   * Start matchmaking
   */
  startMatchmaking() {
    console.log('[App] Starting matchmaking...');
    
    // Update UI: show matchmaking panel
    hide(this.lobbyContent);
    hide(this.waitingPanel);
    show(this.matchmakingPanel);
    hide(this.lobbyStatus);
    
    // Update time display
    const timeDisplay = $('mm-time-display');
    if (this.selectedTime === 0) {
      timeDisplay.textContent = '∞ Sans limite';
    } else {
      const mins = Math.floor(this.selectedTime / 60);
      timeDisplay.textContent = mins + ' min';
    }
    
    // Reset elapsed
    $('mm-elapsed').textContent = '0:00';
    
    this.onlineGame.startMatchmaking(this.selectedTime);
  }

  /**
   * Cancel matchmaking
   */
  cancelMatchmaking() {
    console.log('[App] Cancelling matchmaking...');
    this.onlineGame.cancelMatchmaking();
    
    hide(this.matchmakingPanel);
    show(this.lobbyContent);
    hide(this.lobbyStatus);
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
    hide(this.matchmakingPanel);
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
    
    // In salon mode, go back to lobby (keep playing)
    // In normal mode, go back to mode selection
    if (this.salonMode) {
      show(this.lobbyScreen);
      this.lobbyScreen.classList.add('active');
    } else {
      show(this.lobbyScreen);
      this.lobbyScreen.classList.add('active');
    }
    
    hide(this.waitingPanel);
    hide(this.matchmakingPanel);
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
