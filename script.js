// ==========================================
// 1. グローバル変数の初期化（エラー防止のため冒頭で宣言）
// ==========================================
let monsters = [];
let speciesBook = [];
let scenery = [];
let foods = [];
let corpses = [];
let newBabies = [];
let selectedObject = null;

// BGM・SE設定（エラー回避のためcatchを追加）
const bgm = new Audio("Emerald_Grove_Drifter.mp3");
bgm.loop = true;
bgm.volume = 0.1;
function changeVolume(v) { bgm.volume = v; }

const se = new Audio("se.mp3");
se.volume = 0.1;
function changeSEVolume(v) { se.volume = v; }
function playSE() { se.currentTime = 0; se.play().catch(()=>{}); }

// UI要素の取得
const gCanvas = document.getElementById('gameCanvas');
const gCtx = gCanvas.getContext('2d');
const tPrev = document.getElementById('targetPreview');
const tCtx = tPrev.getContext('2d');

// 定数・システム変数
const CHUNK = 1500;
let worldW = CHUNK * 9, worldH = CHUNK * 9;
let camX = CHUNK * 4, camY = CHUNK * 4, zoom = 0.3;
let isDragging = false, lastMouseX = 0, lastMouseY = 0;
let gameSpeed = 1, isFocus = false;

// 環境システム
let weather = 'sunny';
let weatherTimer = 1800; 
let lightnings = [];
let raindrops = [];
let gameTime = 0;
let isNight = false;

// ピクセルアート用色・形状データ
const artData = {
    tree: { p: ['#5e3c27', '#3d994e'], d: [[0,2,2,0],[2,2,2,2],[0,1,1,0]] },
    cactus: { p: ['#2e7d32', '#1b5e20'], d: [[0,1,1,0],[1,1,1,1],[0,1,1,0]] },
    ice: { p: ['#e1f5fe', '#81d4fa'], d: [[1,1,1],[1,2,2],[1,2,2]] },
    palm: { p: ['#795548', '#2e7d32'], d: [[2,2,2],[0,1,0],[0,1,0]] },
    ore: { p: ['#757575', '#bdbdbd'], d: [[1,1,1],[1,2,1]] },
    fruit: { p: ['#ff4444', '#44aa44'], d: [[0,2,0],[1,1,1]] },
    meat: { p: ['#ff8a80', '#d32f2f'], d: [[1,2,1],[1,1,1]] },
    fish: { p: ['#90caf9', '#1565c0'], d: [[0,1,1],[2,2,2],[0,1,1]] },
    mushroom: { p: ['#f8f8f8', '#d84315'], d: [[0,2,2,0],[0,1,1,0]] },
    corpse: { p: ['#e0e0e0', '#757575'], d: [[1,1,1],[1,2,1]] },
    blackRock: { p: ['#212121', '#424242'], d: [[1,1,1],[1,2,1],[1,1,1]] }
};

// ==========================================
// 2. 基本ユーティリティ関数
// ==========================================

function addLog(msg) {
    const log = document.getElementById('logPanel');
    if(!log) return;
    const entry = document.createElement('div');
    entry.innerText = msg;
    log.appendChild(entry);
    if(log.childNodes.length > 7) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
}

function drawPixelArt(ctx, x, y, palette, data, size = 10, useCam=true) {
    data.forEach((row, i) => { row.forEach((p, j) => {
        if (p !== 0) {
            ctx.fillStyle = palette[p - 1];
            if(useCam) {
                ctx.fillRect((x + j * size - camX) * zoom, (y + i * size - camY) * zoom, size * zoom + 1, size * zoom + 1);
            } else {
                ctx.fillRect(x + j * size, y + i * size, size, size);
            }
        }
    }); });
}

function getBiome(x, y) {
    const ix = Math.floor(x / CHUNK), iy = Math.floor(y / CHUNK);
    if (iy <= 2) return "mountain"; 
    if (iy >= 6) return "sea"; 
    if (ix <= 2) return "desert"; 
    if (ix >= 6) return "snow";
    return "plain";
}

// ==========================================
// 3. モンスタークラス（生態・AI）
// ==========================================

class Monster {
    constructor(pixelData, species, statMin, statMax, artUrl, diet, heat=0, cold=0) {
        this.data = JSON.parse(JSON.stringify(pixelData));
        this.species = species; this.artUrl = artUrl; this.diet = diet;
        this.heatResist = heat; this.coldResist = cold;
        this.totalStat = Math.floor(Math.random() * (statMax - statMin + 1)) + statMin;
        this.power = Math.floor(this.totalStat * 0.6);
        this.speedVal = (this.totalStat / 25) + 1.2;
        this.stamina = Math.floor(this.totalStat * 0.8);
        this.hpMax = this.stamina * 5 + 50; this.hp = this.hpMax;
        this.speed = this.speedVal;
        this.hunger = 0;
        this.targetBiome = this.decideHome();
        this.initPosition();
        this.vx = 0; this.vy = 0; this.timer = 0; this.breedTimer = 1000;
        this.socialTimer = 0; this.cachedAllies = [];
        this.personality = this.totalStat < 30 ? "おくびょう" : "まじめ";
        this.lifeTimer = Math.floor((Math.random() * 350 + 150) * 60); 
        this.level = 1; this.exp = 0; this.nextExp = 100;
        this.fightTimer = 0; this.panicTimer = 0;
        this.carryingType = null; this.emotion = ""; this.isDead = false;
    }

    decideHome() {
        if(this.heatResist >= 20) return "desert";
        if(this.coldResist >= 20) return "snow";
        if(this.heatResist + this.coldResist > 30) return "mountain";
        return "plain";
    }

    initPosition() {
        let found = false;
        while(!found) {
            this.x = Math.random() * (worldW-400) + 200; 
            this.y = Math.random() * (worldH-400) + 200;
            if(getBiome(this.x, this.y) === this.targetBiome) found = true;
        }
        this.territoryX = this.x; this.territoryY = this.y;
    }

    gainExp(amount) {
        this.exp += amount;
        if (this.exp >= this.nextExp) {
            this.level++; this.exp = 0; this.nextExp = Math.floor(this.nextExp * 1.5);
            this.power += 1; this.stamina += 1; this.hpMax += 10;
            addLog(`🆙 ${this.species}がLv${this.level}になった！`);
        }
    }

    die(reason) {
        if (this.isDead) return false;
        this.isDead = true;
        corpses.push({x:this.x, y:this.y}); 
        addLog(`🪦 ${this.species}が${reason}で息絶えました…`);
        return false;
    }

    update() {
        if (this.isDead) return false;
        this.lifeTimer--;
        if (this.lifeTimer <= 0) return this.die("寿命");

        this.emotion = "";
        if (this.panicTimer > 0) { this.panicTimer--; this.emotion = "💦"; }
        if (this.fightTimer > 0) { this.fightTimer--; this.emotion = "💢"; return true; } 

        const currentBiome = getBiome(this.x, this.y);
        let speedMult = (currentBiome === this.targetBiome) ? 1.5 : 1.0;
        if (this.panicTimer > 0) speedMult *= 1.5;
        this.speed = this.speedVal * speedMult;

        // 環境ダメージ
        if (currentBiome === "desert" && this.heatResist < 15) this.hp -= 0.05;
        if (currentBiome === "snow" && this.coldResist < 15) this.hp -= 0.05;
        this.hunger += 0.012;
        if (this.hunger > 100) { this.hp -= 0.2; if (this.hp <= 0) return this.die("餓死"); }
        if (this.hp <= 0) return this.die("衰弱");

        let distToNest = Math.sqrt((this.x - this.territoryX)**2 + (this.y - this.territoryY)**2);
        let sleeping = false;
        if (isNight || this.hp < this.hpMax * 0.3) {
            if (distToNest < 60) {
                sleeping = true; this.hp = Math.min(this.hpMax, this.hp + 0.1); this.emotion = "💤";
            }
        }

        // AI思考（移動・捕食・逃走）
        if (this.timer-- <= 0 && !sleeping) {
            this.timer = 60 + Math.random()*60;
            let angle;
            if (this.panicTimer > 0) {
                angle = Math.random() * Math.PI * 2;
            } else if (this.hunger > 40) {
                let food = foods.find(f => Math.sqrt((this.x-f.x)**2+(this.y-f.y)**2) < 500);
                angle = food ? Math.atan2(food.y - this.y, food.x - this.x) : Math.random()*Math.PI*2;
            } else {
                angle = Math.atan2(this.territoryY - this.y, this.territoryX - this.x) + (Math.random()-0.5);
            }
            this.vx = Math.cos(angle)*this.speed; 
            this.vy = Math.sin(angle)*this.speed;
        }
        
        if (sleeping) { this.vx = 0; this.vy = 0; }
        this.x = Math.max(100, Math.min(worldW-100, this.x + this.vx));
        this.y = Math.max(100, Math.min(worldH-100, this.y + this.vy));
        
        // 繁殖
        if (this.breedTimer-- <= 0 && this.hunger < 30 && !isNight) {
            let partner = monsters.find(m => m !== this && m.species === this.species && m.breedTimer <= 0 && Math.sqrt((this.x-m.x)**2+(this.y-m.y)**2) < 100);
            if (partner) {
                const child = new Monster(this.data, this.species, this.totalStat*0.8, this.totalStat*1.2, this.artUrl, this.diet, this.heatResist, this.coldResist);
                child.x = this.x; child.y = this.y; newBabies.push(child);
                this.breedTimer = 5000; partner.breedTimer = 5000;
                addLog(`🐣 ${this.species}が誕生！`);
            }
        }

        // 食事判定
        let fIdx = foods.findIndex(f => Math.sqrt((this.x-f.x)**2+(this.y-f.y)**2) < 40);
        if (fIdx !== -1) {
            this.hunger = Math.max(0, this.hunger-40); this.hp = Math.min(this.hpMax, this.hp+20);
            foods.splice(fIdx, 1); this.gainExp(10);
        }

        return true;
    }

    draw() {
        let sx = (this.x - camX) * zoom, sy = (this.y - camY) * zoom;
        if (sx < -100 || sx > gCanvas.width + 100 || sy < -100 || sy > gCanvas.height + 100) return;
        const displaySize = 60 + (this.level - 1) * 3;
        const s = (displaySize/32)*zoom;
        for(let y=0; y<32; y++) for(let x=0; x<32; x++) if(this.data[y][x]){ gCtx.fillStyle = this.data[y][x]; gCtx.fillRect(sx+x*s, sy+y*s, s+1, s+1); }
        if (selectedObject === this) { gCtx.strokeStyle = "yellow"; gCtx.lineWidth = 3; gCtx.strokeRect(sx-5, sy-5, (displaySize+10)*zoom, (displaySize+10)*zoom); }
        if (this.emotion) {
            gCtx.font = `${24 * zoom}px sans-serif`;
            gCtx.fillText(this.emotion, sx + (displaySize/4)*zoom, sy - 5*zoom);
        }
    }
}

// ==========================================
// 4. UI・操作系イベント
// ==========================================

gCanvas.addEventListener('mousedown', (e) => {
    isDragging = true; lastMouseX = e.clientX; lastMouseY = e.clientY;
    const mx = (e.clientX / zoom) + camX, my = (e.clientY / zoom) + camY;
    selectedObject = monsters.find(m => mx > m.x && mx < m.x+80 && my > m.y && my < m.y+80) ||
                     foods.find(f => Math.sqrt((mx-f.x)**2 + (my-f.y)**2) < 50);
    document.getElementById('targetMonitor').style.display = selectedObject ? 'block' : 'none';
});

window.addEventListener('mousemove', (e) => { 
    if(isDragging && !isFocus){ camX-=(e.clientX-lastMouseX)/zoom; camY-=(e.clientY-lastMouseY)/zoom; } 
    lastMouseX=e.clientX; lastMouseY=e.clientY; 
});

window.addEventListener('mouseup', () => isDragging = false);

window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const mx = e.clientX, my = e.clientY;
    const worldX = mx / zoom + camX, worldY = my / zoom + camY;
    zoom *= e.deltaY > 0 ? 0.9 : 1.1;
    zoom = Math.max(0.05, Math.min(3.0, zoom));
    camX = worldX - mx / zoom;
    camY = worldY - my / zoom;
    document.getElementById('zoomSlider').value = zoom * 100;
}, {passive:false});

// HTML側から呼ばれる関数群
function handleSliderZoom(v) { zoom = v / 100; }
function setGameSpeed(s, b) { gameSpeed = s; document.querySelectorAll('.speed-btn').forEach(btn=>btn.classList.remove('active-speed')); b.classList.add('active-speed'); }
function toggleFocus() { isFocus = !isFocus; document.getElementById('focusBtn').classList.toggle('active-focus'); }
function toggleMenu() { const p = document.getElementById('menuPanel'); p.style.display = p.style.display === 'flex' ? 'none' : 'flex'; }

// エディター関連
let currentTool = 'pen', pixels = Array(32).fill().map(()=>Array(32).fill(null)), drawing = false;
const edCanvas = document.getElementById('editorCanvas'), edCtx = edCanvas.getContext('2d');

function openEditor() { 
    document.getElementById('farmScreen').classList.remove('active'); 
    document.getElementById('editorScreen').classList.add('active'); 
    drawEd(); 
}
function closeEditor() { 
    document.getElementById('editorScreen').classList.remove('active'); 
    document.getElementById('farmScreen').classList.add('active'); 
}
function setTool(t) { currentTool = t; }
function clearEd() { pixels = Array(32).fill().map(()=>Array(32).fill(null)); drawEd(); }
function drawEd() {
    edCtx.clearRect(0,0,320,320);
    pixels.forEach((row,y)=>row.forEach((c,x)=>{
        if(c){ edCtx.fillStyle=c; edCtx.fillRect(x*10,y*10,10,10); }
        edCtx.strokeStyle="#ddd"; edCtx.strokeRect(x*10,y*10,10,10);
    }));
}

edCanvas.onmousedown = (e) => { drawing = true; paint(e); };
edCanvas.onmousemove = (e) => { if(drawing) paint(e); };
window.onmouseup = () => drawing = false;

function paint(e) {
    const rect = edCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / 10), y = Math.floor((e.clientY - rect.top) / 10);
    if(x<0 || x>=32 || y<0 || y>=32) return;
    pixels[y][x] = currentTool === 'eraser' ? null : document.getElementById('colorPicker').value;
    drawEd();
}

function saveAndGoFarm() {
    const s = document.getElementById('speciesInput').value || "不明な種";
    const d = document.getElementById('dietInput').value;
    const h = parseInt(document.getElementById('heatResist').value) || 0;
    const c = parseInt(document.getElementById('coldResist').value) || 0;
    const count = parseInt(document.getElementById('spawnCount').value) || 5;
    
    const tempC = document.createElement('canvas'); tempC.width=32; tempC.height=32;
    const tctx = tempC.getContext('2d');
    pixels.forEach((row,y)=>row.forEach((col,x)=>{if(col){tctx.fillStyle=col; tctx.fillRect(x,y,1,1);}}));
    const url = tempC.toDataURL();

    speciesBook.push({name:s, url, pixels:JSON.parse(JSON.stringify(pixels)), mi:20, ma:40, diet:d, h, c, count});
    for(let i=0; i<count; i++) monsters.push(new Monster(pixels, s, 20, 40, url, d, h, c));
    
    addLog(`✨ ${s}を放流しました！`);
    closeEditor();
}

// 図鑑関連
function openBook() {
    document.getElementById('farmScreen').classList.remove('active');
    document.getElementById('bookScreen').classList.add('active');
    const grid = document.getElementById('bookGrid'); grid.innerHTML = '';
    speciesBook.forEach((s, i) => {
        grid.innerHTML += `<div class="book-item">
            <img src="${s.url}" style="width:50px;"><br><b>${s.name}</b><br>
            <button onclick="deleteSpecies(${i})">削除</button>
        </div>`;
    });
}
function closeBook() { document.getElementById('bookScreen').classList.remove('active'); document.getElementById('farmScreen').classList.add('active'); }
function deleteSpecies(i) { speciesBook.splice(i, 1); openBook(); }

// ==========================================
// 5. システムコア（セーブ・ループ）
// ==========================================

function spawnFoodCluster() {
    if (foods.length > 1500) return;
    const rx = Math.random()*worldW, ry = Math.random()*worldH;
    const b = getBiome(rx, ry);
    let type = (b==='sea')?'fish':(b==='desert')?'fruit':(b==='snow')?'mushroom':'fruit';
    foods.push({x: rx, y: ry, type: type});
}

function saveGame() {
    const data = { monsters, speciesBook, scenery, foods, gameTime, camX, camY, zoom };
    localStorage.setItem('monsterFarmSave', JSON.stringify(data));
    addLog('💾 セーブ完了');
}

function loadGame() {
    const saved = localStorage.getItem('monsterFarmSave');
    if (saved) {
        const d = JSON.parse(saved);
        speciesBook = d.speciesBook || [];
        scenery = d.scenery || [];
        foods = d.foods || [];
        monsters = (d.monsters || []).map(m => {
            let n = new Monster(m.data, m.species, 10, 10, m.artUrl, m.diet, m.heatResist, m.coldResist);
            Object.assign(n, m); return n;
        });
        addLog('📂 ロード完了');
    } else {
        initEnvironment();
    }
}

function resetGame() { if(confirm("初期化しますか？")) { localStorage.removeItem('monsterFarmSave'); location.reload(); } }

function initEnvironment() {
    for(let i=0; i<1500; i++) {
        const rx = Math.random()*worldW, ry = Math.random()*worldH;
        const b = getBiome(rx, ry);
        let type = (b==='desert')?'cactus':(b==='snow')?'ice':(b==='mountain')?'ore':'tree';
        scenery.push({x: rx, y: ry, type});
    }
    for(let i=0; i<300; i++) spawnFoodCluster();
}

function mainLoop() {
    gCtx.clearRect(0,0,gCanvas.width,gCanvas.height);
    
    // 背景描画
    for(let x=0; x<9; x++) for(let y=0; y<9; y++) {
        const b = getBiome(x*CHUNK+1, y*CHUNK+1);
        gCtx.fillStyle = b==='desert'?"#f0e68c":b==='snow'?"#e0ffff":b==='mountain'?"#9e9e9e":b==='sea'?"#2196F3":"#7cc77c";
        gCtx.fillRect((x*CHUNK-camX)*zoom, (y*CHUNK-camY)*zoom, CHUNK*zoom+1, CHUNK*zoom+1);
    }

    scenery.forEach(s => drawPixelArt(gCtx, s.x, s.y, artData[s.type].p, artData[s.type].d, 12));
    foods.forEach(f => drawPixelArt(gCtx, f.x, f.y, artData[f.type].p, artData[f.type].d, 6));
    
    if(gameSpeed > 0) {
        gameTime++; isNight = (gameTime % 4000) > 2000;
        if(Math.random() < 0.05) spawnFoodCluster();
        monsters = monsters.filter(m => m.update());
        if(newBabies.length > 0) { monsters = monsters.concat(newBabies); newBabies = []; }
    }

    monsters.forEach(m => m.draw());

    if(isFocus && selectedObject instanceof Monster) {
        camX = selectedObject.x - (gCanvas.width/2)/zoom;
        camY = selectedObject.y - (gCanvas.height/2)/zoom;
    }

    // 夜間オーバーレイ
    if (isNight) { gCtx.fillStyle = "rgba(0, 0, 40, 0.3)"; gCtx.fillRect(0, 0, gCanvas.width, gCanvas.height); }

    // モニター更新
    if(selectedObject) {
        const obj = selectedObject;
        let stats = obj.species ? `<b>${obj.species}</b><br>HP: ${Math.floor(obj.hp)}<br>空腹: ${Math.floor(obj.hunger)}%` : `<b>${obj.type}</b>`;
        document.getElementById('targetStats').innerHTML = stats;
    }
    document.getElementById('count').innerText = monsters.length;

    requestAnimationFrame(mainLoop);
}

window.onresize = () => { gCanvas.width = window.innerWidth; gCanvas.height = window.innerHeight; };
window.onresize();
loadGame();
mainLoop();
