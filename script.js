// BGM・SE設定
        const bgm = new Audio("Emerald_Grove_Drifter.mp3");
        bgm.loop = true;
        bgm.volume = 0.1;
        function changeVolume(v) { bgm.volume = v; }

        const se = new Audio("se.mp3");
        se.volume = 0.1;
        function changeSEVolume(v) { se.volume = v; }
        function playSE() { se.currentTime = 0; se.play().catch(()=>{}); }

        // 最初のクリックで再生制限を解除
        window.addEventListener('mousedown', () => { if(bgm.paused) bgm.play().catch(()=>{}); }, { once: true });

        // UIボタンクリック時にSEを鳴らす
        window.addEventListener('click', (e) => {
            if(e.target.tagName === 'BUTTON' || e.target.id === 'menuBtn') playSE();
        });

        const gCanvas = document.getElementById('gameCanvas');
        const gCtx = gCanvas.getContext('2d');
        const tPrev = document.getElementById('targetPreview');
        const tCtx = tPrev.getContext('2d');
        const CHUNK = 1500;
        let worldW = CHUNK * 9, worldH = CHUNK * 9;
        let camX = CHUNK * 4, camY = CHUNK * 4, zoom = 0.3;
        let isDragging = false, lastMouseX = 0, lastMouseY = 0;
        let gameSpeed = 1, isFocus = false;

        let monsters = [], newBabies = [], speciesBook = []; 
        let scenery = [], foods = [], corpses = [];
        let selectedObject = null; 

        // 天候システム用変数
        let weather = 'sunny';
        let weatherTimer = 1800; 
        let lightnings = [];

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

        function addLog(msg) {
            const log = document.getElementById('logPanel');
            const entry = document.createElement('div');
            entry.innerText = msg;
            log.appendChild(entry);
            if(log.childNodes.length > 7) log.removeChild(log.firstChild);
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

        function spawnFoodCluster() {
            if (foods.length > 2500 || gameSpeed === 0) return;
            const cx = Math.random()*worldW, cy = Math.random()*worldH;
            const b = getBiome(cx, cy);
            let n = 0, type = 'fruit';
            if(b === 'mountain') { n = 1; type = 'fruit'; }
            else if(b === 'snow') { n = 2; type = 'mushroom'; }
            else if(b === 'desert') { n = 5; type = 'fruit'; }
            else if(b === 'plain') { n = 20; type = Math.random() > 0.4 ? 'fruit' : 'mushroom'; }
            else if(b === 'sea') { n = 3; type = 'fish'; }
            for(let i=0; i<n; i++) {
                const rx = cx + (Math.random()-0.5)*200;
                const ry = cy + (Math.random()-0.5)*200;
                if(rx > 80 && rx < worldW-80 && ry > 80 && ry < worldH-80) foods.push({x: rx, y: ry, type: type});
            }
        }
        
        // 雨の日は生成速度アップ
        setInterval(() => { 
            if(gameSpeed > 0) {
                for(let i=0; i<gameSpeed; i++) {
                    spawnFoodCluster(); 
                    if (weather === 'rain') spawnFoodCluster(); 
                }
            }
        }, 1000);

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
                this.socialTimer = 0; 
                this.cachedAllies = [];
                this.personality = this.totalStat < 30 ? "おくびょう" : "まじめ";
                this.lifeTimer = Math.floor((Math.random() * 350 + 150) * 60); 

                this.level = 1;
                this.exp = 0;
                this.nextExp = 100;

                // 戦闘用
                this.fightTimer = 0;
            }

            gainExp(amount) {
                this.exp += amount;
                if (this.exp >= this.nextExp) this.levelUp();
            }

            levelUp() {
                this.level++;
                this.exp = 0;
                this.nextExp = Math.floor(this.nextExp * 1.5);
                const rand = Math.random();
                if (rand < 0.33) this.power += 1;
                else if (rand < 0.66) { this.speedVal += 0.1; this.speed = this.speedVal; }
                else { this.stamina += 1; this.hpMax = this.stamina * 5 + 50; this.hp = Math.min(this.hpMax, this.hp + 20); }
                addLog(`🆙 ${this.species}がLv${this.level}になった！`);
            }

            decideHome() {
                if(this.heatResist >= 20 || this.heatResist > this.coldResist + 5) return "desert";
                if(this.coldResist >= 20 || this.coldResist > this.heatResist + 5) return "snow";
                if(this.heatResist + this.coldResist > 30) return "mountain";
                return "plain";
            }
            initPosition() {
                let found = false;
                while(!found) {
                    this.x = Math.random() * (worldW-200) + 100; this.y = Math.random() * (worldH-200) + 100;
                    if(getBiome(this.x, this.y) === this.targetBiome) found = true;
                }
                this.territoryX = this.x; this.territoryY = this.y;
            }
            die(reason) {
                corpses.push({x:this.x, y:this.y}); 
                addLog(`🪦 ${this.species}が${reason}で息絶えました…`);
                return false;
            }
            update() {
                this.lifeTimer--;
                if (this.lifeTimer <= 0) return this.die("寿命");
                if (this.fightTimer > 0) { this.fightTimer--; return true; } // 戦闘中は移動・思考停止

                const currentBiome = getBiome(this.x, this.y);
                
                // バフと天候による速度計算
                let speedMult = 1.0;
                if (currentBiome === this.targetBiome) speedMult *= 1.5; // 自バイオームバフ
                if (weather === 'sunny') speedMult *= 1.2; // 晴れバフ
                this.speed = this.speedVal * speedMult;

                const isHighResist = (this.heatResist >= 20 || this.coldResist >= 20);

                if (currentBiome === "desert" && this.heatResist < 15) this.hp -= 0.05;
                if (currentBiome === "snow" && this.coldResist < 15) this.hp -= 0.05;
                if (currentBiome === "plain" && isHighResist) this.hp -= 0.1;
                this.hunger += (this.diet === "草食") ? 0.01 : 0.015;
                if (this.hunger > 100) { this.hp -= 0.2; if (this.hp <= 0) return this.die("餓死"); }
                if (this.hp <= 0) return this.die("衰弱");

                if (this.socialTimer-- <= 0) {
                    this.socialTimer = 20 + Math.random() * 10;
                    this.cachedAllies = monsters.filter(m => m !== this && m.species === this.species && Math.sqrt((this.x-m.x)**2+(this.y-m.y)**2) < 300);
                    
                    let target = null;
                    if (this.diet === "肉食") target = monsters.find(m => m !== this && m.species !== this.species && Math.sqrt((this.x-m.x)**2+(this.y-m.y)**2) < 100);
                    else if (this.diet === "雑食") target = monsters.find(m => m.diet === "草食" && Math.sqrt((this.x-m.x)**2+(this.y-m.y)**2) < 100);

                    if (target) { 
                        // 戦闘発生
                        target.hp -= (this.power / 10) + 1; // 攻撃
                        this.hp -= (target.power / 20) + 0.5; // 反撃ダメージ
                        this.fightTimer = 60; // 1秒間の戦闘モーション
                        target.fightTimer = 60;
                        this.vx = 0; this.vy = 0; // その場で止まる
                        
                        if (target.hp <= 0) {
                            target.die("捕食");
                            this.gainExp(50);
                        }
                        if (this.hp <= 0) return this.die("返り討ち");
                    }
                }

                if (this.timer-- <= 0) {
                    this.timer = 80 + Math.random()*60;
                    let moveX = 0, moveY = 0;
                    if (this.cachedAllies.length > 0) {
                        let ax = this.cachedAllies.reduce((s, a) => s + a.x, 0) / this.cachedAllies.length;
                        let ay = this.cachedAllies.reduce((s, a) => s + a.y, 0) / this.cachedAllies.length;
                        moveX += (ax - this.x) * 0.1; moveY += (ay - this.y) * 0.1;
                    }
                    let searchDist = 400;
                    let food = foods.find(f => (f.type !== 'fish' || this.diet !== "草食") && Math.sqrt((this.x-f.x)**2+(this.y-f.y)**2) < searchDist);
                    let angle;
                    if (food && this.hunger > 10) angle = Math.atan2(food.y - this.y, food.x - this.x);
                    else if (currentBiome !== this.targetBiome) angle = Math.atan2(this.territoryY - this.y + moveY, this.territoryX - this.x + moveX);
                    else angle = Math.random()*Math.PI*2;
                    this.vx = Math.cos(angle)*this.speed + (moveX/100); 
                    this.vy = Math.sin(angle)*this.speed + (moveY/100);
                }
                
                let nextX = Math.max(85, Math.min(worldW-145, this.x + this.vx));
                let nextY = Math.max(85, Math.min(worldH-145, this.y + this.vy));
                
                // 山岳と海の進入制限 (体力5超かつ耐寒5超のみ)
                let nextBiome = getBiome(nextX, nextY);
                if ((nextBiome === 'mountain' || nextBiome === 'sea') && !(this.stamina > 5 && this.coldResist > 5)) {
                    if (currentBiome !== 'mountain' && currentBiome !== 'sea') {
                        nextX = this.x; // 進入をブロック
                        nextY = this.y;
                    }
                }
                
                this.x = nextX;
                this.y = nextY;
                
                if (this.breedTimer-- <= 0 && this.hunger < 40) {
                    let partner = this.cachedAllies.find(m => m.breedTimer <= 0);
                    if (partner && Math.sqrt((this.x-partner.x)**2+(this.y-partner.y)**2) < 60) {
                        const avg = (this.totalStat + partner.totalStat)/2;
                        let ch = this.heatResist, cc = this.coldResist;
                        if (currentBiome === "desert") ch += 1; if (currentBiome === "snow") cc += 1;
                        const child = new Monster(this.data, this.species, avg*0.9, avg*1.1, this.artUrl, this.diet, ch, cc);
                        child.x = this.x; child.y = this.y; newBabies.push(child);
                        this.breedTimer = 3000; partner.breedTimer = 3000;
                        addLog(`🐣 ${this.species}が誕生！(🔥${ch}❄️${cc})`);
                    }
                }

                if (this.hunger > 20) {
                    corpses.forEach((c, i) => { if (Math.sqrt((this.x-c.x)**2+(this.y-c.y)**2) < 50 && (this.diet!=="草食")) { this.hunger = Math.max(0, this.hunger-60); this.hp = Math.min(this.hpMax, this.hp+40); corpses.splice(i, 1); this.gainExp(50); } });
                    foods.forEach((f, i) => { 
                        if (Math.sqrt((this.x+30-f.x)**2+(this.y+30-f.y)**2) < 50) { 
                            if (f.type === 'fish' && this.diet === "草食") return;
                            this.hunger = Math.max(0, this.hunger-40); this.hp = Math.min(this.hpMax, this.hp+20); foods.splice(i, 1); this.gainExp(10);
                        } 
                    });
                }
                return true;
            }
            draw() {
                let sx = (this.x - camX) * zoom, sy = (this.y - camY) * zoom;
                if (sx < -100 || sx > gCanvas.width + 100 || sy < -100 || sy > gCanvas.height + 100) return;
                
                // 戦闘モーション（激しく震える）
                if (this.fightTimer > 0) {
                    sx += (Math.random() - 0.5) * 10 * zoom;
                    sy += (Math.random() - 0.5) * 10 * zoom;
                }

                const displaySize = 60 + (this.level - 1) * 4;
                const s = (displaySize/32)*zoom;
                for(let y=0; y<32; y++) for(let x=0; x<32; x++) if(this.data[y][x]){ gCtx.fillStyle = this.data[y][x]; gCtx.fillRect(sx+x*s, sy+y*s, s+1, s+1); }
                if (selectedObject === this) { gCtx.strokeStyle = "yellow"; gCtx.lineWidth = 3; gCtx.strokeRect(sx, sy, displaySize*zoom, displaySize*zoom); }
            }
        }

        gCanvas.addEventListener('mousedown', (e) => {
            isDragging = true; lastMouseX = e.clientX; lastMouseY = e.clientY;
            const mx = (e.clientX / zoom) + camX, my = (e.clientY / zoom) + camY;
            let found = monsters.find(m => { const size = 60 + (m.level - 1) * 4; return mx > m.x && mx < m.x+size && my > m.y && my < m.y+size; });
            if(!found) found = foods.find(f => Math.sqrt((mx-f.x)**2 + (my-f.y)**2) < 40);
            if(!found) found = corpses.find(c => Math.sqrt((mx-c.x)**2 + (my-c.y)**2) < 40);
            selectedObject = found;
            document.getElementById('targetMonitor').style.display = selectedObject ? 'block' : 'none';
        });
        window.addEventListener('mousemove', (e) => { if(isDragging && !isFocus){ camX-=(e.clientX-lastMouseX)/zoom; camY-=(e.clientY-lastMouseY)/zoom; } lastMouseX=e.clientX; lastMouseY=e.clientY; });
        window.addEventListener('mouseup', () => isDragging = false);
        window.addEventListener('wheel', (e) => { e.preventDefault(); const mx = e.clientX, my = e.clientY; const worldX = mx / zoom + camX, worldY = my / zoom + camY; zoom *= e.deltaY > 0 ? 0.9 : 1.1; zoom = Math.max(0.01, Math.min(3.0, zoom)); camX = worldX - mx / zoom; camY = worldY - my / zoom; document.getElementById('zoomSlider').value = zoom * 100; }, {passive:false});

        function handleSliderZoom(v) { const cx = gCanvas.width / 2, cy = gCanvas.height / 2; const worldX = cx / zoom + camX, worldY = cy / zoom + camY; zoom = v / 100; camX = worldX - cx / zoom; camY = worldY - cy / zoom; }
        function setGameSpeed(s, b) { gameSpeed = s; document.querySelectorAll('.speed-btn').forEach(btn=>btn.classList.remove('active-speed')); b.classList.add('active-speed'); }
        function toggleFocus() { isFocus = !isFocus; document.getElementById('focusBtn').classList.toggle('active-focus'); document.getElementById('focusBtn').innerText = isFocus ? "注目追従: ON" : "注目追従: OFF"; }

        function openBook() {
            document.getElementById('farmScreen').classList.remove('active');
            document.getElementById('bookScreen').classList.add('active');
            const grid = document.getElementById('bookGrid'); grid.innerHTML = '';
            speciesBook.forEach((s, i) => {
                const currentCount = monsters.filter(m => m.species === s.name).length;
                grid.innerHTML += `<div class="book-item">
                    <button class="delete-x" onclick="deleteSpecies(${i})">×</button>
                    <img src="${s.url}" class="book-img"><br>
                    <b>${s.name}</b> [${s.diet}]<br>
                    <div style="font-size:11px; background:#f0f0f0; padding:5px; border-radius:5px; margin:5px 0;">
                        生存数: <span style="color:blue; font-weight:bold;">${currentCount}</span><br>
                        耐性🔥${s.h}❄️${s.c}<br>
                        放流セット数: <button class="qty-btn" onclick="changeQty(${i}, -1)">-</button><span>${s.count}</span><button class="qty-btn" onclick="changeQty(${i}, 1)">+</button>
                    </div>
                    <button onclick="spawnMore(${i})" class="btn" style="padding:5px 10px; font-size:11px; background:#4CAF50; width:80%;">追加放流</button>
                </div>`;
            });
        }

        let currentTool = 'pen', pixels = Array(32).fill().map(()=>Array(32).fill(null)), drawing = false;
        const edCanvas = document.getElementById('editorCanvas'), edCtx = edCanvas.getContext('2d');
        function setTool(t) { currentTool = t; document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active-tool')); document.getElementById(t+'Tool').classList.add('active-tool'); }
        function drawEd() { edCtx.clearRect(0,0,320,320); pixels.forEach((row,y)=>row.forEach((c,x)=>{ if(c){ edCtx.fillStyle=c; edCtx.fillRect(x*10,y*10,10,10); } edCtx.strokeStyle="#ddd"; edCtx.strokeRect(x*10,y*10,10,10); })); }
        function validateResist() { const h = parseInt(document.getElementById('heatResist').value)||0, c = parseInt(document.getElementById('coldResist').value)||0; if(h+c > 50) { document.getElementById('resistError').innerText = "耐性合計は50まで！"; return false; } document.getElementById('resistError').innerText = ""; return true; }
        function saveAndGoFarm() { if(!validateResist()) return; const s = document.getElementById('speciesInput').value, d = document.getElementById('dietInput').value; const h = parseInt(document.getElementById('heatResist').value), c = parseInt(document.getElementById('coldResist').value); const mi = parseInt(document.getElementById('statMin').value), ma = parseInt(document.getElementById('statMax').value); const count = parseInt(document.getElementById('spawnCount').value); const tempC = document.createElement('canvas'); tempC.width=32; tempC.height=32; const tctx = tempC.getContext('2d'); pixels.forEach((row,y)=>row.forEach((col,x)=>{if(col){tctx.fillStyle=col; tctx.fillRect(x,y,1,1);}})); const url = tempC.toDataURL(); speciesBook.push({name:s, url, pixels:JSON.parse(JSON.stringify(pixels)), mi, ma, diet:d, h, c, count}); for(let i=0; i<count; i++) monsters.push(new Monster(pixels, s, mi, ma, url, d, h, c)); addLog(`✨ ${s}を${count}体放流！`); closeEditor(); }
        function deleteSpecies(index) { const name = speciesBook[index].name; monsters = monsters.filter(m => m.species !== name); speciesBook.splice(index, 1); openBook(); }
        function spawnMore(index) { const s = speciesBook[index]; for(let i=0; i<s.count; i++) monsters.push(new Monster(s.pixels, s.name, s.mi, s.ma, s.url, s.diet, s.h, s.c)); }
        function changeQty(index, delta) { speciesBook[index].count = Math.max(1, (speciesBook[index].count || 1) + delta); openBook(); }
        function closeBook() { document.getElementById('bookScreen').classList.remove('active'); document.getElementById('farmScreen').classList.add('active'); }
        function openEditor() { document.getElementById('farmScreen').classList.remove('active'); document.getElementById('editorScreen').classList.add('active'); drawEd(); }
        function closeEditor() { document.getElementById('editorScreen').classList.remove('active'); document.getElementById('farmScreen').classList.add('active'); }
        function toggleMenu() { const p = document.getElementById('menuPanel'); p.style.display = p.style.display === 'flex' ? 'none' : 'flex'; }
        edCanvas.onmousedown = (e) => { drawing = true; paint(e); }; window.onmouseup = () => drawing = false; edCanvas.onmousemove = (e) => { if(drawing) paint(e); };
        function paint(e) { const rect = edCanvas.getBoundingClientRect(); const x = Math.floor((e.clientX - rect.left) / 10), y = Math.floor((e.clientY - rect.top) / 10); if(x<0 || x>=32 || y<0 || y>=32) return; const color = currentTool==='eraser' ? null : document.getElementById('colorPicker').value; const bSize = parseInt(document.getElementById('brushSize').value); if(currentTool==='bucket') { const target = pixels[y][x]; if(target===color) return; const fill = (cx,cy)=>{ if(cx<0||cx>=32||cy<0||cy>=32||pixels[cy][cx]!==target)return; pixels[cy][cx]=color; fill(cx+1,cy); fill(cx-1,cy); fill(cx,cy+1); fill(cx,cy-1);}; fill(x,y); } else { for(let i=0; i<bSize; i++) for(let j=0; j<bSize; j++) if(y+i<32 && x+j<32) pixels[y+i][x+j] = color; } drawEd(); }
        function clearEd() { pixels = Array(32).fill().map(()=>Array(32).fill(null)); drawEd(); }

        function initEnvironment() {
            scenery = [];
            for(let x=0; x<worldW; x+=40) { scenery.push({x: x, y: 0, type:'blackRock'}); scenery.push({x: x, y: worldH-80, type:'blackRock'}); }
            for(let y=0; y<worldH; y+=40) { scenery.push({x: 0, y: y, type:'blackRock'}); scenery.push({x: worldW-80, y: y, type:'blackRock'}); }
            for(let i=0; i<2000; i++) {
                const rx = 100 + Math.random()*(worldW-200), ry = 100 + Math.random()*(worldH-200);
                const b = getBiome(rx, ry); if(b === 'sea') continue;
                let type = 'tree'; if(b==='desert') type='cactus'; if(b==='snow') type='ice'; if(b==='mountain') type='ore';
                scenery.push({x: rx, y: ry, type});
            }
            for(let i=0; i<100; i++) spawnFoodCluster();
        }

        function initSlimes() {
            const shape = [[0,1,1,1,0],[1,1,1,1,1],[1,2,1,2,1],[1,1,1,1,1]];
            const getSlimeData = (c) => {
                let p = Array(32).fill().map(()=>Array(32).fill(null));
                shape.forEach((r,y)=>r.forEach((v,x)=>{if(v===1)p[y+14][x+14]=c; if(v===2)p[y+14][x+14]="#fff";}));
                const can = document.createElement('canvas'); can.width=32; can.height=32; const ctx = can.getContext('2d');
                p.forEach((row,py)=>row.forEach((col,px)=>{if(col){ctx.fillStyle=col; ctx.fillRect(px,py,1,1);}}));
                return {p, url: can.toDataURL()};
            };
            const blue = getSlimeData("#42a5f5"), red = getSlimeData("#ef5350");
            speciesBook.push({name:"ブルースライム",url:blue.url,pixels:blue.p,mi:10,ma:20,diet:"雑食",h:0,c:0,count:15});
            speciesBook.push({name:"レッドスライム",url:red.url,pixels:red.p,mi:10,ma:20,diet:"雑食",h:0,c:0,count:25});
            for(let i=0; i<15; i++) monsters.push(new Monster(blue.p,"ブルースライム",10,20,blue.url,"雑食",0,0));
            for(let i=0; i<25; i++) monsters.push(new Monster(red.p,"レッドスライム",10,20,red.url,"雑食",0,0));
        }

        function saveGame() {
            const saveData = { monsters: monsters.map(m => { let mData = Object.assign({}, m); delete mData.cachedAllies; return mData; }), speciesBook, scenery, foods, corpses, camX, camY, zoom };
            localStorage.setItem('monsterFarmSave', JSON.stringify(saveData));
            addLog('💾 セーブしました！');
        }
        function resetGame() { if(confirm("本当にリセットしますか？")) { localStorage.removeItem('monsterFarmSave'); location.reload(); } }
        function loadGame() {
            const saved = localStorage.getItem('monsterFarmSave');
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    speciesBook = data.speciesBook || []; scenery = data.scenery || []; foods = data.foods || []; corpses = data.corpses || []; camX = data.camX; camY = data.camY; zoom = data.zoom || 0.3;
                    document.getElementById('zoomSlider').value = zoom * 100;
                    monsters = (data.monsters || []).map(m => { let newM = new Monster(m.data, m.species, 10, 10, m.artUrl, m.diet, m.heatResist, m.coldResist); Object.assign(newM, m); newM.cachedAllies = []; return newM; });
                    addLog('📂 ロード完了！');
                } catch(e) { initEnvironment(); initSlimes(); }
            } else { initEnvironment(); initSlimes(); }
        }

        function mainLoop() {
            gCtx.clearRect(0,0,gCanvas.width,gCanvas.height);
            for(let x=0; x<9; x++) for(let y=0; y<9; y++) {
                const b = getBiome(x*CHUNK+1, y*CHUNK+1);
                gCtx.fillStyle = b==='desert'?"#f0e68c":b==='snow'?"#e0ffff":b==='mountain'?"#9e9e9e":b==='sea'?"#2196F3":"#7cc77c";
                gCtx.fillRect((x*CHUNK-camX)*zoom, (y*CHUNK-camY)*zoom, CHUNK*zoom, CHUNK*zoom);
            }
            scenery.forEach(s => drawPixelArt(gCtx, s.x, s.y, artData[s.type].p, artData[s.type].d, 12));
            foods.forEach(f => drawPixelArt(gCtx, f.x, f.y, artData[f.type].p, artData[f.type].d, 6));
            corpses.forEach(c => drawPixelArt(gCtx, c.x, c.y, artData.corpse.p, artData.corpse.d, 8));
            
            if(gameSpeed > 0) { 
                for(let i=0; i<gameSpeed; i++) { 
                    // 天候の変化
                    weatherTimer--;
                    if (weatherTimer <= 0) {
                        const r = Math.random();
                        if (r < 0.4) weather = 'sunny';
                        else if (r < 0.7) weather = 'rain';
                        else weather = 'storm';
                        weatherTimer = 1800 + Math.random() * 1800;
                        addLog(`☁️ 天候が【${weather === 'sunny' ? '晴れ' : weather === 'rain' ? '雨' : '嵐'}】に変わった！`);
                    }

                    // 嵐の時の落雷処理
                    if (weather === 'storm' && Math.random() < 0.02) { 
                        const lx = Math.random() * worldW;
                        const ly = Math.random() * worldH;
                        lightnings.push({x: lx, y: ly, timer: 15});
                        
                        monsters.forEach(m => {
                            if (Math.sqrt((m.x - lx)**2 + (m.y - ly)**2) < 200) {
                                m.hp -= 50;
                                if (m.hp <= 0) m.die("落雷");
                            }
                        });
                        
                        foods = foods.filter(f => Math.sqrt((f.x - lx)**2 + (f.y - ly)**2) > 60);
                    }

                    monsters = monsters.filter(m => m.update()); 
                    if(newBabies.length > 0) { monsters = monsters.concat(newBabies); newBabies = []; } 
                } 
            }
            
            monsters.forEach(m => m.draw());
            
            if(isFocus && selectedObject instanceof Monster) { camX = selectedObject.x - (gCanvas.width/2)/zoom; camY = selectedObject.y - (gCanvas.height/2)/zoom; }
            
            // 雷の描画
            lightnings.forEach(l => {
                if (l.timer > 0) {
                    gCtx.fillStyle = `rgba(255, 255, 0, ${l.timer / 15})`;
                    gCtx.beginPath();
                    gCtx.arc((l.x - camX) * zoom, (l.y - camY) * zoom, 200 * zoom, 0, Math.PI * 2);
                    gCtx.fill();
                    gCtx.strokeStyle = `rgba(255, 255, 255, ${l.timer / 15})`;
                    gCtx.lineWidth = 10 * zoom;
                    gCtx.beginPath();
                    gCtx.moveTo((l.x - camX) * zoom, (l.y - camY) * zoom);
                    gCtx.lineTo((l.x - camX + (Math.random()-0.5)*200) * zoom, (l.y - camY - 1500) * zoom);
                    gCtx.stroke();
                    l.timer--;
                }
            });
            lightnings = lightnings.filter(l => l.timer > 0);

            // 天候の画面表示 (画面上部中央)
            gCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
            const textW = 120;
            gCtx.fillRect(gCanvas.width/2 - textW/2, 20, textW, 30);
            gCtx.fillStyle = "white";
            gCtx.font = "bold 16px sans-serif";
            gCtx.textAlign = "center";
            const wText = weather === 'sunny' ? '☀️ 晴れ' : weather === 'rain' ? '🌧️ 雨' : '⚡ 嵐';
            gCtx.fillText("天候: " + wText, gCanvas.width/2, 40);
            gCtx.textAlign = "left"; // リセット

            if(selectedObject) {
                const obj = selectedObject; tCtx.clearRect(0,0,32,32);
                let statsHtml = "";
                if(obj instanceof Monster) {
                    obj.data.forEach((row,y)=>row.forEach((c,x)=>{if(c){tCtx.fillStyle=c; tCtx.fillRect(x,y,1,1);}}));
                    statsHtml = `<b>${obj.species}</b> [${obj.diet}]<br><span style="color:#ffeb3b; font-weight:bold;">Lv ${obj.level}</span> (次まで: ${obj.nextExp - obj.exp})<br>耐性: 🔥${obj.heatResist} ❄️${obj.coldResist}<br>パワー: ${Math.floor(obj.power)}<br>スピード: ${Math.floor(obj.speedVal * 10)}<br>体力: ${Math.floor(obj.stamina)}<br>HP: ${Math.floor(obj.hp)} / ${Math.floor(obj.hpMax)}<br>空腹: ${Math.floor(obj.hunger)}%<br>性格: ${obj.personality}`;
                } else if(obj.type) { drawPixelArt(tCtx, 4, 4, artData[obj.type].p, artData[obj.type].d, 6, false); statsHtml = `<b>${obj.type}</b> (エサ)`; }
                else { drawPixelArt(tCtx, 4, 4, artData.corpse.p, artData.corpse.d, 6, false); statsHtml = `<b>なきがら</b>`; }
                document.getElementById('targetStats').innerHTML = statsHtml;
            }
            document.getElementById('count').innerText = monsters.length;
            requestAnimationFrame(mainLoop);
        }
        window.onresize = () => { gCanvas.width = window.innerWidth; gCanvas.height = window.innerHeight; };
        window.onresize(); loadGame(); mainLoop();
