// ==========================================
// 1. グローバル定数・システム変数
// ==========================================
let monsters = [], speciesBook = [], scenery = [], foods = [], corpses = [], newBabies = [];
let selectedObject = null;

const CHUNK = 1500;
let worldW = CHUNK * 9, worldH = CHUNK * 9;
let camX = CHUNK * 4, camY = CHUNK * 4, zoom = 0.3;
let isDragging = false, lastMouseX = 0, lastMouseY = 0;
let gameSpeed = 1, isFocus = false;

// 環境・天候・時間
let gameTime = 0, isNight = false;
let weather = 'sunny', weatherTimer = 1800;
let raindrops = [], lightnings = [];

const gCanvas = document.getElementById('gameCanvas');
const gCtx = gCanvas.getContext('2d');
const tPrev = document.getElementById('targetPreview');
const tCtx = tPrev.getContext('2d');

// ピクセルアート（環境物・アイテム）
const artData = {
    tree: { p: ['#5e3c27', '#3d994e'], d: [[0,2,2,0],[2,2,2,2],[0,1,1,0]] },
    cactus: { p: ['#2e7d32', '#1b5e20'], d: [[0,1,1,0],[1,1,1,1],[0,1,1,0]] },
    ice: { p: ['#e1f5fe', '#81d4fa'], d: [[1,1,1],[1,2,2],[1,2,2]] },
    ore: { p: ['#757575', '#bdbdbd'], d: [[1,1,1],[1,2,1]] },
    fruit: { p: ['#ff4444', '#44aa44'], d: [[0,2,0],[1,1,1]] },
    fish: { p: ['#90caf9', '#1565c0'], d: [[0,1,1],[2,2,2],[0,1,1]] },
    mushroom: { p: ['#f8f8f8', '#d84315'], d: [[0,2,2,0],[0,1,1,0]] },
    corpse: { p: ['#e0e0e0', '#757575'], d: [[1,1,1],[1,2,1]] }
};

// ==========================================
// 2. モンスタークラス（AI・全ステータス統合）
// ==========================================
class Monster {
    constructor(pixelData, species, statMin, statMax, artUrl, diet, heat=0, cold=0) {
        this.data = JSON.parse(JSON.stringify(pixelData));
        this.species = species; this.artUrl = artUrl; this.diet = diet;
        this.heatResist = heat; this.coldResist = cold;
        
        // ステータス生成
        this.totalStat = Math.floor(Math.random() * (statMax - statMin + 1)) + statMin;
        this.power = Math.floor(this.totalStat * 0.6);
        this.speedVal = (this.totalStat / 25) + 1.2;
        this.stamina = Math.floor(this.totalStat * 0.8);
        this.hpMax = this.stamina * 5 + 50; this.hp = this.hpMax;
        
        this.x = Math.random() * (worldW-400) + 200; 
        this.y = Math.random() * (worldH-400) + 200;
        this.vx = 0; this.vy = 0; this.timer = 0;
        this.hunger = 0; this.breedTimer = 2000;
        this.level = 1; this.exp = 0; this.nextExp = 100;
        this.isDead = false; this.emotion = "";
        this.personality = this.totalStat < 30 ? "おくびょう" : (this.totalStat > 70 ? "あらくれ" : "まじめ");
        this.lifeTimer = Math.floor((Math.random() * 500 + 300) * 60);
        this.targetBiome = this.decideHome();
    }

    decideHome() {
        if(this.heatResist >= 20) return "desert";
        if(this.coldResist >= 20) return "snow";
        return "plain";
    }

    update() {
        if (this.isDead) return false;
        this.lifeTimer--;
        if (this.lifeTimer <= 0) return this.die("寿命");

        const biome = getBiome(this.x, this.y);
        if (biome === "desert" && this.heatResist < 15) this.hp -= 0.1;
        if (biome === "snow" && this.coldResist < 15) this.hp -= 0.1;

        this.hunger += 0.02;
        if (this.hunger > 100) { this.hp -= 0.3; if (this.hp <= 0) return this.die("餓死"); }

        // AI思考
        if (this.timer-- <= 0) {
            this.timer = 60 + Math.random() * 60;
            let angle = Math.random() * Math.PI * 2;
            
            // 腹が減ったら餌を探す
            if (this.hunger > 40) {
                let f = foods.find(food => Math.sqrt((this.x-food.x)**2+(this.y-food.y)**2) < 500);
                if(f) angle = Math.atan2(f.y - this.y, f.x - this.x);
            }
            this.vx = Math.cos(angle) * this.speedVal;
            this.vy = Math.sin(angle) * this.speedVal;
        }

        this.x = Math.max(100, Math.min(worldW-100, this.x + this.vx));
        this.y = Math.max(100, Math.min(worldH-100, this.y + this.vy));

        // 捕食判定
        let fIdx = foods.findIndex(f => Math.sqrt((this.x-f.x)**2+(this.y-f.y)**2) < 50);
        if (fIdx !== -1) {
            this.hunger = Math.max(0, this.hunger - 50);
            this.hp = Math.min(this.hpMax, this.hp + 30);
            foods.splice(fIdx, 1);
            this.gainExp(20);
        }

        // 繁殖判定
        if (this.breedTimer-- <= 0 && this.hunger < 20) {
            let mate = monsters.find(m => m !== this && m.species === this.species && m.breedTimer <= 0 && Math.sqrt((this.x-m.x)**2+(this.y-m.y)**2) < 100);
            if(mate) {
                const child = new Monster(this.data, this.species, this.totalStat*0.8, this.totalStat*1.2, this.artUrl, this.diet, this.heatResist, this.coldResist);
                child.x = this.x; child.y = this.y; newBabies.push(child);
                this.breedTimer = 6000; mate.breedTimer = 6000;
                addLog(`🐣 ${this.species}の赤ちゃんが誕生！`);
            }
        }
        return true;
    }

    gainExp(v) {
        this.exp += v;
        if(this.exp >= this.nextExp) {
            this.level++; this.exp = 0; this.nextExp *= 1.5;
            this.hpMax += 20; this.hp = this.hpMax;
            addLog(`🆙 ${this.species}がLv${this.level}に成長！`);
        }
    }

    die(reason) {
        this.isDead = true;
        corpses.push({x:this.x, y:this.y});
        addLog(`🪦 ${this.species}(Lv${this.level})が${reason}で死亡`);
        return false;
    }

    draw() {
        let sx = (this.x - camX) * zoom, sy = (this.y - camY) * zoom;
        if (sx < -100 || sx > gCanvas.width + 100 || sy < -100 || sy > gCanvas.height + 100) return;
        const size = ( (64 + (this.level*2)) / 32 ) * zoom;
        for(let y=0; y<32; y++) for(let x=0; x<32; x++) {
            if(this.data[y][x]) { gCtx.fillStyle = this.data[y][x]; gCtx.fillRect(sx+x*size, sy+y*size, size+1, size+1); }
        }
        if(selectedObject === this) {
            gCtx.strokeStyle = "yellow"; gCtx.lineWidth = 2;
            gCtx.strokeRect(sx-4, sy-4, (32*size)+8, (32*size)+8);
        }
    }
}

// ==========================================
// 3. 図鑑（Encyclopedia）完全版
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
        const alive = monsters.filter(m => m.species === s.name).length;
        const card = document.createElement('div');
        card.className = 'book-item';
        card.innerHTML = `
            <button class="delete-x" onclick="deleteSpecies(${i})">×</button>
            <img src="${s.url}" class="book-img"><br>
            <b>${s.name}</b><br>
            生存: ${alive}体<br>
            放流数: <button class="qty-btn" onclick="changeQty(${i}, -1)">-</button>
            <span id="qty-${i}">${s.count}</span>
            <button class="qty-btn" onclick="changeQty(${i}, 1)">+</button><br>
            <button class="btn" onclick="spawnMore(${i})" style="margin-top:5px; font-size:10px;">追加放流</button>
        `;
        grid.appendChild(card);
    });
}

function changeQty(i, d) {
    speciesBook[i].count = Math.max(1, (speciesBook[i].count || 1) + d);
    document.getElementById(`qty-${i}`).innerText = speciesBook[i].count;
}

function spawnMore(i) {
    const s = speciesBook[i];
    for(let j=0; j<s.count; j++) monsters.push(new Monster(s.pixels, s.name, s.mi, s.ma, s.url, s.diet, s.h, s.c));
    addLog(`✨ ${s.name}を${s.count}体追加しました`);
}

function deleteSpecies(i) {
    if(confirm("図鑑から削除しますか？")) { speciesBook.splice(i, 1); renderBook(); }
}

function closeBook() {
    document.getElementById('bookScreen').classList.remove('active');
    document.getElementById('farmScreen').classList.add('active');
}

// ==========================================
// 4. エディター機能
// ==========================================
let currentTool = 'pen', pixels = Array(32).fill().map(()=>Array(32).fill(null)), drawing = false;
const edCanvas = document.getElementById('editorCanvas'), edCtx = edCanvas.getContext('2d');

function openEditor() { 
    document.getElementById('farmScreen').classList.remove('active'); 
    document.getElementById('editorScreen').classList.add('active'); 
    drawEd();
}

function setTool(t) { 
    currentTool = t; 
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool'));
    document.getElementById(t + 'Tool').classList.add('active-tool');
}

function drawEd() {
    edCtx.clearRect(0,0,320,320);
    pixels.forEach((row,y)=>row.forEach((c,x)=>{
        if(c){ edCtx.fillStyle=c; edCtx.fillRect(x*10,y*10,10,10); }
        edCtx.strokeStyle="#444"; edCtx.strokeRect(x*10,y*10,10,10);
    }));
}

edCanvas.onmousedown = (e) => { drawing = true; paint(e); };
edCanvas.onmousemove = (e) => { if(drawing) paint(e); };
window.onmouseup = () => drawing = false;

function paint(e) {
    const rect = edCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / 10), y = Math.floor((e.clientY - rect.top) / 10);
    if(x>=0 && x<32 && y>=0 && y<32) {
        pixels[y][x] = currentTool === 'eraser' ? null : document.getElementById('colorPicker').value;
        drawEd();
    }
}

function saveAndGoFarm() {
    const name = document.getElementById('speciesInput').value || "ナナシ";
    const diet = document.getElementById('dietInput').value;
    const h = parseInt(document.getElementById('heatResist').value) || 0;
    const c = parseInt(document.getElementById('coldResist').value) || 0;
    const count = parseInt(document.getElementById('spawnCount').value) || 5;
    const mi = parseInt(document.getElementById('statMin').value) || 20;
    const ma = parseInt(document.getElementById('statMax').value) || 40;

    const tmp = document.createElement('canvas'); tmp.width=32; tmp.height=32;
    const tx = tmp.getContext('2d');
    pixels.forEach((row,y)=>row.forEach((col,x)=>{if(col){tx.fillStyle=col; tx.fillRect(x,y,1,1);}}));
    const url = tmp.toDataURL();

    speciesBook.push({name, url, pixels:JSON.parse(JSON.stringify(pixels)), mi, ma, diet, h, c, count});
    for(let i=0; i<count; i++) monsters.push(new Monster(pixels, name, mi, ma, url, diet, h, c));
    
    document.getElementById('editorScreen').classList.remove('active');
    document.getElementById('farmScreen').classList.add('active');
    addLog(`✨ 新種「${name}」誕生！`);
}

// ==========================================
// 5. メインループ & システム
// ==========================================
function getBiome(x, y) {
    const ix = Math.floor(x/CHUNK), iy = Math.floor(y/CHUNK);
    if(iy <= 2) return "mountain"; if(iy >= 6) return "sea";
    if(ix <= 2) return "desert"; if(ix >= 6) return "snow";
    return "plain";
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
    corpses.forEach(c => drawPixelArt(gCtx, c.x, c.y, artData.corpse.p, artData.corpse.d, 8));

    if(gameSpeed > 0) {
        gameTime++; isNight = (gameTime % 5000) > 2500;
        if(Math.random() < 0.05) {
            const rx = Math.random()*worldW, ry = Math.random()*worldH;
            const b = getBiome(rx, ry);
            foods.push({x: rx, y: ry, type: b==='sea'?'fish':b==='desert'?'fruit':b==='snow'?'mushroom':'fruit'});
        }
        monsters = monsters.filter(m => m.update());
        if(newBabies.length > 0) { monsters = monsters.concat(newBabies); newBabies = []; }
    }

    monsters.forEach(m => m.draw());

    // ステータスモニター
    if(selectedObject) {
        const obj = selectedObject; tCtx.clearRect(0,0,32,32);
        let html = "";
        if(obj instanceof Monster) {
            obj.data.forEach((row,y)=>row.forEach((c,x)=>{if(c){tCtx.fillStyle=c; tCtx.fillRect(x,y,1,1);}}));
            html = `<b>${obj.species}</b> Lv.${obj.level}<br>性格: ${obj.personality}<br>
                    HP: ${Math.floor(obj.hp)}/${obj.hpMax}<br>空腹: ${Math.floor(obj.hunger)}%<br>
                    POW: ${obj.power} SPD: ${Math.floor(obj.speedVal*10)}<br>
                    耐性: 🔥${obj.heatResist} ❄️${obj.coldResist}`;
        } else {
            html = `<b>${obj.type}</b> (アイテム)`;
        }
        document.getElementById('targetStats').innerHTML = html;
    }

    if(isNight) { gCtx.fillStyle = "rgba(0,0,50,0.3)"; gCtx.fillRect(0,0,gCanvas.width,gCanvas.height); }
    document.getElementById('count').innerText = monsters.length;
    requestAnimationFrame(mainLoop);
}

// ユーティリティ
function addLog(m) {
    const l = document.getElementById('logPanel');
    const d = document.createElement('div'); d.innerText = m;
    l.appendChild(d); if(l.childNodes.length > 10) l.removeChild(l.firstChild);
    l.scrollTop = l.scrollHeight;
}

function drawPixelArt(ctx, x, y, palette, data, size, useCam=true) {
    data.forEach((row, i) => row.forEach((p, j) => {
        if (p !== 0) {
            ctx.fillStyle = palette[p - 1];
            if(useCam) ctx.fillRect((x + j*size - camX)*zoom, (y + i*size - camY)*zoom, size*zoom+1, size*zoom+1);
            else ctx.fillRect(x + j*size, y + i*size, size, size);
        }
    }));
}

// ==========================================
// 6. イベント・初期化
// ==========================================
gCanvas.addEventListener('mousedown', (e) => {
    isDragging = true; lastMouseX = e.clientX; lastMouseY = e.clientY;
    const mx = (e.clientX/zoom)+camX, my = (e.clientY/zoom)+camY;
    selectedObject = monsters.find(m => Math.abs(m.x - mx) < 50 && Math.abs(m.y - my) < 50) ||
                     foods.find(f => Math.abs(f.x - mx) < 30 && Math.abs(f.y - my) < 30);
    document.getElementById('targetMonitor').style.display = selectedObject ? 'block' : 'none';
});
window.addEventListener('mousemove', (e) => { if(isDragging && !isFocus){ camX-=(e.clientX-lastMouseX)/zoom; camY-=(e.clientY-lastMouseY)/zoom; } lastMouseX=e.clientX; lastMouseY=e.clientY; });
window.addEventListener('mouseup', () => isDragging = false);

function saveGame() { localStorage.setItem('monsterFarmFull', JSON.stringify({monsters, speciesBook, gameTime})); addLog("💾 セーブ完了"); }
function loadGame() {
    const s = localStorage.getItem('monsterFarmFull');
    if(s) {
        const d = JSON.parse(s); speciesBook = d.speciesBook || [];
        monsters = (d.monsters || []).map(m => { let n = new Monster(m.data, m.species, 10, 10, m.artUrl, m.diet, m.heatResist, m.coldResist); Object.assign(n, m); return n; });
        addLog("📂 ロード完了");
    }
}
function resetGame() { if(confirm("データを消去しますか？")) { localStorage.clear(); location.reload(); } }
function setGameSpeed(s, b) { gameSpeed = s; document.querySelectorAll('.speed-btn').forEach(x=>x.classList.remove('active-speed')); b.classList.add('active-speed'); }
function toggleFocus() { isFocus = !isFocus; document.getElementById('focusBtn').classList.toggle('active-focus'); }
function handleSliderZoom(v) { zoom = v/100; }

window.onresize = () => { gCanvas.width = window.innerWidth; gCanvas.height = window.innerHeight; };
window.onresize();
for(let i=0; i<800; i++) {
    const rx = Math.random()*worldW, ry = Math.random()*worldH;
    const b = getBiome(rx, ry);
    scenery.push({x: rx, y: ry, type: b==='desert'?'cactus':b==='snow'?'ice':b==='mountain'?'ore':'tree'});
}
loadGame();
mainLoop();
