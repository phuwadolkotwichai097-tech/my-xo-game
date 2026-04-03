import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyAvBcOT1ZzasAVzfksDE2ubWf55dd_jV_I",
    authDomain: "my-xo-game-ddf8e.firebaseapp.com",
    databaseURL: "https://my-xo-game-ddf8e-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "my-xo-game-ddf8e",
    storageBucket: "my-xo-game-ddf8e.firebasestorage.app",
    messagingSenderId: "121057994178",
    appId: "1:121057994178:web:17b25fc67355e2baf1a25b"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- Game State ---
let gameRef, roomId, myRole, isMatchOver = false;
let cells = Array(9).fill(''), currentPlayer = 'X', gameOver = false;
let placedCount = {X:0, O:0}, timeLeft = {X:60, O:60}, isCountingDown = false, scores = {X:0, O:0};
let dragSourceIdx = null;

// --- Matchmaking Functions (Attached to window for HTML access) ---
window.findQuickMatch = async () => {
    lockLobby(true);
    const snap = await get(ref(db, 'rooms'));
    let foundId = null;
    if (snap.exists()) {
        const rooms = snap.val();
        for (let id in rooms) { 
            if (rooms[id].status === 'waiting' && !rooms[id].playerO) { 
                foundId = id; break; 
            } 
        }
    }
    if (foundId) {
        roomId = foundId; myRole = 'O';
        await update(ref(db, `rooms/${roomId}`), { playerO: true, status: 'playing', isCountingDown: true });
        startSession();
    } else {
        roomId = "Q_" + Math.floor(1000 + Math.random() * 9000); myRole = 'X';
        await set(ref(db, `rooms/${roomId}`), { status: 'waiting', cells: Array(9).fill(''), currentPlayer: 'X', gameOver: false, placedCount: {X:0, O:0}, timeLeft: {X:60, O:60}, isCountingDown: false, playerX: true, playerO: false, scores: {X:0, O:0} });
        onValue(ref(db, `rooms/${roomId}/playerO`), (s) => { if(s.val() === true) startSession(); });
    }
};

window.createPrivateRoom = () => {
    lockLobby(true);
    roomId = Math.floor(1000 + Math.random() * 9000).toString(); myRole = 'X';
    set(ref(db, `rooms/${roomId}`), { status: 'waiting', cells: Array(9).fill(''), currentPlayer: 'X', gameOver: false, placedCount: {X:0, O:0}, timeLeft: {X:60, O:60}, isCountingDown: false, playerX: true, playerO: false, scores: {X:0, O:0} });
    document.getElementById('match-status').textContent = `WAITING... CODE: ${roomId}`;
    onValue(ref(db, `rooms/${roomId}/playerO`), (s) => { if(s.val() === true) startSession(); });
};

window.joinPrivateRoom = async () => {
    const inputId = document.getElementById('room-input').value.trim();
    if (!inputId) return;
    const snap = await get(ref(db, `rooms/${inputId}`));
    if(!snap.exists() || snap.val().playerO) return alert("Invalid Room");
    lockLobby(true); roomId = inputId; myRole = 'O';
    await update(ref(db, `rooms/${roomId}`), { playerO: true, status: 'playing', isCountingDown: true });
    startSession();
};

// --- Core Game Logic ---
function lockLobby(locked) {
    document.getElementById('btn-quick').disabled = locked;
    document.getElementById('btn-create').disabled = locked;
    document.getElementById('btn-join').disabled = locked;
    document.getElementById('match-status').style.display = locked ? 'block' : 'none';
}

function startSession() {
    gameRef = ref(db, `rooms/${roomId}`);
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';
    
    onDisconnect(ref(db, `rooms/${roomId}/player${myRole}`)).set(false);

    onValue(gameRef, (snap) => {
        const d = snap.val(); if (!d || isMatchOver) return;
        
        if (d.status === 'playing' && !d.isCountingDown) {
            if (d.playerX === false) return finishMatch('O', 'X DISCONNECTED');
            if (d.playerO === false) return finishMatch('X', 'O DISCONNECTED');
        }
        if (d.status === 'finished') return finishMatch(d.finalWinner, d.reason);

        cells = d.cells; currentPlayer = d.currentPlayer; gameOver = d.gameOver;
        placedCount = d.placedCount; timeLeft = d.timeLeft; scores = d.scores;
        
        if (isCountingDown !== d.isCountingDown && d.isCountingDown) runCountdown();
        isCountingDown = d.isCountingDown;

        document.getElementById('score-x').textContent = scores.X;
        document.getElementById('score-o').textContent = scores.O;
        updateUI();
        if (gameOver && myRole === 'X') handleRoundEnd();
    });

    setInterval(() => {
        if (currentPlayer === myRole && !gameOver && !isCountingDown && !isMatchOver) {
            timeLeft[myRole]--;
            update(gameRef, { [`timeLeft/${myRole}`]: timeLeft[myRole] });
            if (timeLeft[myRole] <= 0) update(gameRef, { gameOver: true });
        }
    }, 1000);
}

function handleRoundEnd() {
    const win = checkWinWithBoard(cells);
    let roundWinner = win ? (currentPlayer === 'X' ? 'X' : 'O') : (timeLeft.X <= 0 ? 'O' : 'X');
    const newScores = { ...scores }; newScores[roundWinner]++;

    if (newScores.X >= 2 || newScores.O >= 2) {
        update(gameRef, { scores: newScores, status: 'finished', finalWinner: roundWinner, reason: 'MATCH ENDED' });
    } else {
        setTimeout(() => {
            update(gameRef, { cells: Array(9).fill(''), currentPlayer: 'X', gameOver: false, placedCount: {X:0, O:0}, timeLeft: {X:60, O:60}, isCountingDown: true, scores: newScores });
        }, 2000);
    }
}

function finishMatch(winner, reason) {
    if (isMatchOver) return; isMatchOver = true;
    document.getElementById('result-screen').style.display = 'flex';
    const winDisp = document.getElementById('winner-display');
    winDisp.textContent = `${winner} WIN!`;
    winDisp.style.color = winner === 'X' ? 'var(--neon-pink)' : 'var(--neon-cyan)';
    document.getElementById('result-reason').textContent = reason;
}

function updateUI() {
    document.getElementById('time-x').textContent = (timeLeft.X || 0) + 's';
    document.getElementById('time-o').textContent = (timeLeft.O || 0) + 's';
    
    const b = document.getElementById('board'); b.innerHTML = '';
    cells.forEach((v, i) => {
        const c = document.createElement('div');
        c.className = 'cell';
        c.textContent = v;
        c.style.color = v === 'X' ? 'var(--neon-pink)' : 'var(--neon-cyan)';
        
        if (v === myRole && currentPlayer === myRole && !gameOver && !isCountingDown && placedCount[myRole] >= 3) {
            c.draggable = true;
        }

        c.ondragstart = () => { dragSourceIdx = i; };
        c.ondragover = (e) => { e.preventDefault(); if (!cells[i]) c.classList.add('drag-over'); };
        c.ondragleave = () => c.classList.remove('drag-over');
        c.ondrop = (e) => { e.preventDefault(); c.classList.remove('drag-over'); handleDrop(i); };
        b.appendChild(c);
    });

    const tx = document.getElementById('tray-x'), to = document.getElementById('tray-o');
    tx.innerHTML = ''; to.innerHTML = '';
    document.getElementById('zone-x').className = 'player-zone' + (currentPlayer === 'X' ? ' active-zone' : '');
    document.getElementById('zone-o').className = 'player-zone' + (currentPlayer === 'O' ? ' active-zone' : '');
    
    for (let i = placedCount.X; i < 3; i++) tx.appendChild(createTrayPiece('X'));
    for (let i = placedCount.O; i < 3; i++) to.appendChild(createTrayPiece('O'));
}

function createTrayPiece(t) {
    const p = document.createElement('div');
    p.className = 'piece';
    p.textContent = t;
    p.style.background = t === 'X' ? 'var(--neon-pink)' : 'var(--neon-cyan)';
    if (t === myRole && currentPlayer === myRole && !gameOver && !isCountingDown && placedCount[myRole] < 3) {
        p.draggable = true;
    }
    p.ondragstart = () => { dragSourceIdx = null; };
    return p;
}

function handleDrop(targetIdx) {
    if (currentPlayer !== myRole || gameOver || isCountingDown || cells[targetIdx] !== '') return;

    let nextCells = [...cells];
    let nextPlaced = { ...placedCount };
    let canMove = false;

    if (dragSourceIdx === null && nextPlaced[myRole] < 3) {
        nextCells[targetIdx] = myRole;
        nextPlaced[myRole]++;
        canMove = true;
    } else if (dragSourceIdx !== null && cells[dragSourceIdx] === myRole && nextPlaced[myRole] >= 3) {
        nextCells[dragSourceIdx] = '';
        nextCells[targetIdx] = myRole;
        canMove = true;
    }

    if (canMove) {
        const hasWin = checkWinWithBoard(nextCells);
        update(gameRef, {
            cells: nextCells,
            placedCount: nextPlaced,
            currentPlayer: hasWin ? myRole : (myRole === 'X' ? 'O' : 'X'),
            gameOver: hasWin
        });
    }
}

function checkWinWithBoard(b) {
    const p = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    return p.some(a => b[a[0]] && b[a[0]] === b[a[1]] && b[a[1]] === b[a[2]]);
}

async function runCountdown() {
    const el = document.getElementById('big-countdown'); el.style.display = 'block';
    for (let i = 3; i > 0; i--) { el.textContent = i; await new Promise(r => setTimeout(r, 1000)); }
    el.style.display = 'none'; if (myRole === 'X') update(gameRef, { isCountingDown: false });
}
