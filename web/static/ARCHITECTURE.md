# Chess Arena — Architecture Documentation

## 📁 Project Structure

```
web/static/
├── index.html          # Main HTML structure
├── style.css           # Professional CSS with clear sections
├── chess.js            # Chess engine (rules, moves, validation)
├── ai.js               # AI opponent (minimax with alpha-beta pruning)
├── app.js              # Main application controller
└── modules/            # Modular architecture
    ├── core.js         # Shared utilities and constants
    ├── ui.js           # UI management and rendering
    ├── online.js       # Online multiplayer (WebSocket)
    └── offline.js      # Offline AI gameplay
```

## 🏗️ Architecture Overview

### Separation of Concerns

The application follows a **clean modular architecture** with clear separation between:

1. **Online Mode** (`online.js`)
   - WebSocket connection management
   - Multiplayer room creation/joining
   - Real-time move synchronization
   - Network game state handling

2. **Offline Mode** (`offline.js`)
   - Local AI opponent
   - Single-player gameplay
   - AI move calculation
   - Local game state management

3. **UI Layer** (`ui.js`)
   - Board rendering
   - Player information display
   - Move history
   - Timer management
   - Game over modals
   - **Shared between online and offline modes**

4. **Core Utilities** (`core.js`)
   - DOM helpers
   - Time formatting
   - Toast notifications
   - Constants (piece values, etc.)

### Key Design Principles

- **Single Responsibility**: Each module has one clear purpose
- **Dependency Injection**: Modules receive dependencies (engine, UI) rather than creating them
- **Event-Driven**: Clean callback system for game events
- **ES6 Modules**: Modern JavaScript with import/export
- **No Code Duplication**: Shared logic in UI and core modules

## 🔄 Data Flow

```
User Action
    ↓
app.js (Controller)
    ↓
online.js OR offline.js
    ↓
ChessEngine (chess.js)
    ↓
ui.js (Render)
    ↓
DOM Update
```

## 📦 Module Details

### `core.js` — Shared Utilities
- DOM helper functions
- Piece value constants
- Time formatting
- Toast notifications
- Show/hide utilities

### `ui.js` — UI Manager Class
**Responsibilities:**
- Build and render chess board
- Update player info (names, indicators, colors)
- Display move history
- Show captured pieces and material advantage
- Timer display
- Game over modals
- Promotion dialog

**Key Methods:**
- `buildBoard(engine, onSquareClick)` - Create board grid
- `renderBoard(engine)` - Update visual state
- `updateStatus(engine, mode, aiThinking)` - Status text
- `updateMoveHistory(engine)` - Move list
- `updateCapturedPieces(engine)` - Captured display
- `showGameOver(engine, mode)` - End game modal

### `online.js` — Online Game Class
**Responsibilities:**
- WebSocket connection
- Room creation/joining
- Server message handling
- Move synchronization
- Opponent tracking
- Timer sync

**Key Methods:**
- `connect()` - Establish WebSocket
- `createRoom(timeLimit)` - Create multiplayer room
- `joinRoom(roomCode)` - Join existing room
- `onSquareClick(row, col)` - Handle player input
- `makeMove(from, to, promotion)` - Execute and sync move

### `offline.js` — Offline Game Class
**Responsibilities:**
- AI opponent management
- Local game state
- AI move calculation
- Single-player timer

**Key Methods:**
- `startGame(playerColor, aiDifficulty, timeLimit)` - Start AI game
- `onSquareClick(row, col)` - Handle player input
- `makeAIMove()` - Calculate and execute AI move
- `makeMove(from, to, promotion)` - Execute player move

### `app.js` — Application Controller
**Responsibilities:**
- App initialization
- Event listener setup
- Mode switching (online/offline)
- Lobby management
- Game mode orchestration

**Key Methods:**
- `selectMode(mode)` - Switch between online/AI
- `createOnlineGame()` - Start online game
- `startAIGame()` - Start AI game
- `backToLobby()` - Return to main menu

## 🎯 Benefits of This Architecture

### Maintainability
- Easy to locate and fix bugs (clear module boundaries)
- Changes to online mode don't affect offline mode
- UI changes don't require touching game logic

### Scalability
- Easy to add new game modes
- Simple to extend UI features
- Can add more AI difficulties without touching network code

### Testability
- Each module can be tested independently
- Mock dependencies easily
- Clear interfaces between modules

### Readability
- Professional structure
- Self-documenting code organization
- Clear naming conventions

## 🔧 How to Extend

### Add a New Game Mode
1. Create `modules/newmode.js`
2. Extend with similar structure to `online.js`/`offline.js`
3. Inject `ui` and `engine` dependencies
4. Register in `app.js`

### Add New UI Features
1. Add methods to `ui.js`
2. Call from game mode modules
3. Shared automatically between online/offline

### Modify Game Rules
1. Edit `chess.js` only
2. No changes needed in other modules
3. UI updates automatically

## 📝 Code Style

- **Classes** for stateful modules (PascalCase)
- **Functions** for utilities (camelCase)
- **Constants** in UPPER_SNAKE_CASE
- **ES6 features** (arrow functions, destructuring, template literals)
- **Comments** for complex logic and module headers
- **Explicit** over implicit (clear variable names)

## 🚀 Performance

- **Lazy loading**: Only active game mode runs
- **Event delegation**: Efficient DOM event handling
- **Selective rendering**: Only update changed elements
- **Debounced timer**: 100ms intervals for smooth updates

## 🔒 Best Practices

1. **Never mix online and offline logic**
2. **Always use UI manager for rendering**
3. **Keep game logic in chess.js**
4. **Use callbacks for game events**
5. **Clean up resources on mode switch**

---

**Last Updated**: February 6, 2026  
**Architecture Version**: 2.0 (Modular)
