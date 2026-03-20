// ==========================================
// 1. グローバル定数・変数の定義
// ==========================================
let monsters = [];
let speciesBook = [];
let scenery = [];
let foods = [];
let corpses = [];
let newBabies = [];
let selectedObject = null;

const CHUNK = 1500;
let worldW = CHUNK * 9, worldH = CHUNK * 9;
let camX = CHUNK * 4, camY = CHUNK * 4, zoom = 0.3;
let isDragging = false, lastMouseX = 0, lastMouseY = 0;
let gameSpeed = 1, isFocus = false;

// 環境・天候
let weather = 'sunny';
let weatherTimer = 1800; 
let lightnings = [];
let raindrops = [];
let gameTime = 0;
let isNight = false;

// ピクセルアートデータ
const artData = {
    tree: { p: ['#5e3c27', '#3d994e'], d: [[0,2,2,0],[2,2,2,2],[0,1,1,0]] },
    cactus: { p: ['#2e7d32', '#1b5e20'], d: [[0,1,1,0],[1,1,1,1],[0,1,1,0]] },
    ice: { p: ['#e1f5fe', '#81d4fa'], d: [[1,1,1],[1,2,2],[1,2,2]] },
    ore: { p: ['#757575', '#bdbdbd'], d: [[1,1,1],[1,2,1]] },
    fruit: { p: ['#ff4444', '#44aa44'], d: [[0,2,0],[1,1,1]] },
    fish: { p: ['#90caf9', '#1565c0'], d: [[0,1,1],[2,2,2],[0,1,1]] },
    mushroom: { p: ['#f8f8f8', '#d84315'], d: [[0,2,2,0],[0,1,1,0]] },
    corpse: { p: ['#e0e0e0', '#757575'], d: [[1,1,1],[1,2,1]] },
    blackRock: { p: ['#212121', '#424242'], d: [[1,1,1],[1,2,1],[1,1,1]] }
};

// UI要素の取得
const gCanvas = document.getElementById('gameCanvas');
const gCtx = gCanvas.getContext('2d');
const tPrev = document.getElementById('targetPreview');
const tCtx = tPrev.getContext('2d');

// ==========================================
// 2. モンスタークラス（詳細ステータス・AI）
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
        this.personality = this.totalStat < 30 ? "おくびょう" : (this.totalStat > 70 ? "あらくれ" : "まじめ");
        this.lifeTimer = Math.floor((Math.random() * 350 + 150) * 60); 
        this.level = 1; this.exp = 0; this.nextExp = 100;
        this.fightTimer = 0; this.panicTimer = 0;
        this.emotion = ""; this.isDead = false;
    }

    decideHome() {
        if(this.heatResist >= 20) return "desert";
        if(this.coldResist >= 20) return "snow";
        if(this.heatResist + this.coldResist > 30) return "mountain";
        return "plain";
    }

    initPosition() {
        this.x = Math.random() * (worldW-400) + 200; 
        this.y = Math.random() * (worldH-400) + 200;
        this.territoryX = this.x; this.territoryY = this.y;
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

        const currentBiome = getBiome(this.x, this.y);
        if (currentBiome === "desert" && this.heatResist < 15) this.hp -= 0.05;
        if (currentBiome === "snow" && this.coldResist < 15) this.hp -= 0.05;
        
        this.hunger += 0.015;
        if (this.hunger > 100) { this.hp -= 0.2; if (this.hp <= 0) return this.die("餓死"); }
        if (this.hp <= 0) return this.die("衰弱");

        // AI移動
        if (this.timer-- <= 0) {
            this.timer = 60 + Math.random()*60;
            let angle = Math.random() * Math.PI * 2;
            if (this.hunger > 50) {
                let food = foods.find(f => Math.sqrt((this.x-f.x)**2+(this.y-f.y)**2) < 400);
                if(food) angle = Math.atan2(food.y - this.y, food.x - this.x);
            }
            this.vx = Math.cos(angle) * this.speed;
            this.vy = Math.sin(angle) * this.speed;
        }
        
        this.x = Math.max(100, Math.min(worldW-100, this.x + this.vx));
        this.y = Math.max(100, Math.min(worldH-100, this.y + this.vy));

        // 食事
        let fIdx = foods.findIndex(f => Math.sqrt((this.x-f.x)**2+(this.y-f.y)**2) < 40);
        if (fIdx !== -1) {
            this.hunger = Math.max(0, this.hunger-40); this.hp = Math.min(this.hpMax, this.hp+20);
            foods.splice(fIdx, 1);
        }
        return true;
    }

    draw() {
        let sx = (this.x - camX) * zoom, sy = (this.y - camY) * zoom;
        if (sx < -100 || sx > gCanvas.width + 100 || sy < -100 || sy > gCanvas.height + 100) return;
        const displaySize = 60 + (this.level - 1) * 3;
        const s = (displaySize/32)*zoom;
        for(let y=0; y<32; y++) for(let x=0; x<32; x++) {
            if(this.data[y][x]){ gCtx.fillStyle = this.data[y][x]; gCtx.fillRect(sx+x*s, sy+y*s, s+1, s+1); }
        }
        if (selectedObject === this) {
            gCtx.strokeStyle = "yellow"; gCtx.lineWidth = 2;
            gCtx.strokeRect(sx-2, sy-2, (displaySize+4)*zoom, (displaySize+4)*zoom);
        }
    }
}

// ==========================================
// 3. 図鑑・エディター機能（ここを完全に修復）
// ==========================================

function openBook() {
    document.getElementById('farmScreen').classList.remove('active');
    document.getElementById('bookScreen').classList.add('active');
    renderBook();
}

function renderBook() {
    const grid = document.getElementById('bookGrid');
    grid.innerHTML = '';
    speciesBook.forEach((s, i) => {
        const currentCount = monsters.filter(m => m.species === s.name).length;
        const item = document.createElement('div');
        item.className = 'book-item';
        item.innerHTML = `
            <button class="delete-x" onclick="deleteSpecies(${i})">×</button>
            <img src="${s.url}" class="book-img"><br>
            <b>${s.name}</b><br>
            生存数: ${currentCount}<br>
            放流: <button class="qty-btn" onclick="changeQty(${i}, -1)">-</button>
            <span>${s.count}</span>
            <button class="qty-btn" onclick="changeQty(${i}, 1)">+</button><br>
            <button onclick="spawnMore(${i})" class="btn" style="padding:5px 10px; font-size:11px; margin-top:5px;">追加放流</button>
        `;
        grid.appendChild(item);
    });
}

function changeQty(index, delta) {
    speciesBook[index].count = Math.max(1, (speciesBook[index].count || 1) + delta);
    renderBook();
}

function spawnMore(index) {
    const s = speciesBook[index];
    for(let i=0; i<s.count; i++) {
        monsters.push(new Monster(s.pixels, s.name, s.mi, s.ma, s.url, s.diet, s.h, s.c));
    }
    addLog(`✨ ${s.name}を${s.count}体追加放流しました。`);
    renderBook();
}

function deleteSpecies(index) {
    if(confirm("この種を登録解除しますか？（牧場の個体は消えません）")) {
        speciesBook.splice(index, 1);
        renderBook();
    }
}

function closeBook() {
    document.getElementById('bookScreen').classList.remove('active');
    document.getElementById('farmScreen').classList.add('active');
}

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

function setTool(t) { 
    currentTool = t; 
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool'));
    document.getElementById(t + 'Tool').classList.add('active-tool');
}

function clearEd() { pixels = Array(32).fill().map(()=>Array(32).fill(null)); drawEd(); }

function drawEd() {
    edCtx.clearRect(0,0,320,320);
    pixels.forEach((row,y)=>row.forEach((c,x)=>{
        if(c){ edCtx.fillStyle=c; edCtx.fillRect(x*10,y*10,10,10); }
        edCtx.strokeStyle="#eee"; edCtx.strokeRect(x*10,y*10,10,10);
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
    const name = document.getElementById('speciesInput').value || "ナナシ";
    const diet = document.getElementById('dietInput').value;
    const h = parseInt(document.getElementById('heatResist').value) || 0;
    const c = parseInt(document.getElementById('coldResist').value) || 0;
    const count = parseInt(document.getElementById('spawnCount').value) || 5;
    const mi = parseInt(document.getElementById('statMin').value) || 20;
    const ma = parseInt(document.getElementById('statMax').value) || 40;
    
    const tempC = document.createElement('canvas'); tempC.width=32; tempC.height=32;
    const tctx = tempC.getContext('2d');
    pixels.forEach((row,y)=>row.forEach((col,x)=>{if(col){tctx.fillStyle=col; tctx.fillRect(x,y,1,1);}}));
    const url = tempC.toDataURL();

    speciesBook.push({name, url, pixels:JSON.parse(JSON.stringify(pixels)), mi, ma, diet, h, c, count});
    for(let i=0; i<count; i++) monsters.push(new Monster(pixels, name, mi, ma, url, diet, h, c));
    
    addLog(`✨ 新種「${name}」を放流！`);
    closeEditor();
}

// ==========================================
// 4. システムコア・描画・UI
// ==========================================

function addLog(msg) {
    const log = document.getElementById('logPanel');
    const entry = document.createElement('div');
    entry.innerText = msg;
    log.appendChild(entry);
    if(log.childNodes.length > 8) log.removeChild(log.firstChild);
}

function getBiome(x, y) {
    const ix = Math.floor(x / CHUNK), iy = Math.floor(y / CHUNK);
    if (iy <= 2) return "mountain"; if (iy >= 6) return "sea"; 
    if (ix <= 2) return "desert"; if (ix >= 6) return "snow";
    return "plain";
}

function drawPixelArt(ctx, x, y, palette, data, size = 10, useCam=true) {
    data.forEach((row, i) => { row.forEach((p, j) => {
        if (p !== 0) {
            ctx.fillStyle = palette[p - 1];
            if(useCam) ctx.fillRect((x + j * size - camX) * zoom, (y + i * size - camY) * zoom, size * zoom + 1, size * zoom + 1);
            else ctx.fillRect(x + j * size, y + i * size, size, size);
        }
    }); });
}

function mainLoop() {
    gCtx.clearRect(0,0,gCanvas.width,gCanvas.height);
    
    // 背景
    for(let x=0; x<9; x++) for(let y=0; y<9; y++) {
        const b = getBiome(x*CHUNK+1, y*CHUNK+1);
        gCtx.fillStyle = b==='desert'?"#f0e68c":b==='snow'?"#e0ffff":b==='mountain'?"#9e9e9e":b==='sea'?"#2196F3":"#7cc77c";
        gCtx.fillRect((x*CHUNK-camX)*zoom, (y*CHUNK-camY)*zoom, CHUNK*zoom+1, CHUNK*zoom+1);
    }

    scenery.forEach(s => drawPixelArt(gCtx, s.x, s.y, artData[s.type].p, artData[s.type].d, 12));
    foods.forEach(f => drawPixelArt(gCtx, f.x, f.y, artData[f.type].p, artData[f.type].d, 6));
    corpses.forEach(c => drawPixelArt(gCtx, c.x, c.y, artData.corpse.p, artData.corpse.d, 8));

    if(gameSpeed > 0) {
        gameTime++; isNight = (gameTime % 4000) > 2000;
        if(Math.random() < 0.05) {
            const rx = Math.random()*worldW, ry = Math.random()*worldH;
            const b = getBiome(rx, ry);
            foods.push({x: rx, y: ry, type: b==='sea'?'fish':b==='desert'?'fruit':b==='snow'?'mushroom':'fruit'});
        }
        monsters = monsters.filter(m => m.update());
        if(newBabies.length > 0) { monsters = monsters.concat(newBabies); newBabies = []; }
    }

    monsters.forEach(m => m.draw());

    // 詳細ステータスモニターの更新（index.htmlの仕様に完全準拠）
    if(selectedObject) {
        const obj = selectedObject; tCtx.clearRect(0,0,32,32);
        let statsHtml = "";
        if(obj instanceof Monster) {
            obj.data.forEach((row,y)=>row.forEach((c,x)=>{if(c){tCtx.fillStyle=c; tCtx.fillRect(x,y,1,1);}}));
            statsHtml = `<b>${obj.species}</b> [${obj.diet}]<br>
                         耐性: 🔥${obj.heatResist} ❄️${obj.coldResist}<br>
                         パワー: ${Math.floor(obj.power)} スピード: ${Math.floor(obj.speedVal * 10)}<br>
                         HP: ${Math.floor(obj.hp)} / ${Math.floor(obj.hpMax)}<br>
                         空腹: ${Math.floor(obj.hunger)}%<br>性格: ${obj.personality}`;
        } else if(obj.type) {
            drawPixelArt(tCtx, 4, 4, artData[obj.type].p, artData[obj.type].d, 6, false);
            statsHtml = `<b>${obj.type}</b> (エサ)`;
        }
        document.getElementById('targetStats').innerHTML = statsHtml;
    }

    document.getElementById('count').innerText = monsters.length;
    requestAnimationFrame(mainLoop);
}

// ==========================================
// 5. 操作・初期化
// ==========================================

gCanvas.addEventListener('mousedown', (e) => {
    isDragging = true; lastMouseX = e.clientX; lastMouseY = e.clientY;
    const mx = (e.clientX / zoom) + camX, my = (e.clientY / zoom) + camY;
    selectedObject = monsters.find(m => mx > m.x && mx < m.x+80 && my > m.y && my < m.y+80) ||
                     foods.find(f => Math.sqrt((mx-f.x)**2 + (my-f.y)**2) < 50);
    document.getElementById('targetMonitor').style.display = selectedObject ? 'block' : 'none';
});
window.addEventListener('mousemove', (e) => { if(isDragging && !isFocus){ camX-=(e.clientX-lastMouseX)/zoom; camY-=(e.clientY-lastMouseY)/zoom; } lastMouseX=e.clientX; lastMouseY=e.clientY; });
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('wheel', (e) => {
    e.preventDefault(); const worldX = e.clientX / zoom + camX, worldY = e.clientY / zoom + camY;
    zoom *= e.deltaY > 0 ? 0.9 : 1.1; zoom = Math.max(0.05, Math.min(3.0, zoom));
    camX = worldX - e.clientX / zoom; camY = worldY - e.clientY / zoom;
    document.getElementById('zoomSlider').value = zoom * 100;
}, {passive:false});

function handleSliderZoom(v) { zoom = v / 100; }
function setGameSpeed(s, b) { gameSpeed = s; document.querySelectorAll('.speed-btn').forEach(btn=>btn.classList.remove('active-speed')); b.classList.add('active-speed'); }
function toggleFocus() { isFocus = !isFocus; document.getElementById('focusBtn').classList.toggle('active-focus'); }
function toggleMenu() { const p = document.getElementById('menuPanel'); p.style.display = p.style.display === 'flex' ? 'none' : 'flex'; }
function saveGame() { localStorage.setItem('monsterFarmSave', JSON.stringify({monsters, speciesBook, gameTime})); addLog('💾 セーブ完了'); }
function resetGame() { if(confirm("初期化しますか？")) { localStorage.removeItem('monsterFarmSave'); location.reload(); } }

function init() {
    for(let i=0; i<1000; i++) {
        const rx = Math.random()*worldW, ry = Math.random()*worldH;
        const b = getBiome(rx, ry);
        scenery.push({x: rx, y: ry, type: b==='desert'?'cactus':b==='snow'?'ice':b==='mountain'?'ore':'tree'});
    }
    const saved = localStorage.getItem('monsterFarmSave');
    if(saved) {
        const d = JSON.parse(saved);
        speciesBook = d.speciesBook || [];
        monsters = (d.monsters || []).map(m => { let n = new Monster(m.data, m.species, 10, 10, m.artUrl, m.diet, m.heatResist, m.coldResist); Object.assign(n, m); return n; });
    }
    mainLoop();
}

window.onresize = () => { gCanvas.width = window.innerWidth; gCanvas.height = window.innerHeight; };
window.onresize(); init();
