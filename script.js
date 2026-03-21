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
        let raindrops = [];

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
                const living = monsters.filter(m => m.species === s.name);
                const currentCount = living.length;
                let highestLvStr = "なし";
                let btnHtml = "";
                if (currentCount > 0) {
                    const topMonster = living.reduce((max, m) => m.level > max.level ? m : max, living[0]);
                    highestLvStr = `Lv ${topMonster.level}`;
                    btnHtml = `<button onclick="focusOnTopMonster(${i})" class="btn" style="padding:5px 10px; font-size:11px; background:#2196F3; width:80%; margin-top:5px;">👑最高Lvを追従</button>`;
                }

                grid.innerHTML += `<div class="book-item">
                    <button class="delete-x" onclick="deleteSpecies(${i})">×</button>
                    <img src="${s.url}" class="book-img"><br>
                    <b>${s.name}</b> [${s.diet}]<br>
                    <div style="font-size:11px; background:#f0f0f0; padding:5px; border-radius:5px; margin:5px 0;">
                        生存数: <span style="color:blue; font-weight:bold;">${currentCount}</span><br>
                        最高Lv: <span style="color:#d32f2f; font-weight:bold;">${highestLvStr}</span><br>
                        耐性🔥${s.h}❄️${s.c}<br>
                        放流セット数: <button class="qty-btn" onclick="changeQty(${i}, -1)">-</button><span>${s.count}</span><button class="qty-btn" onclick="changeQty(${i}, 1)">+</button>
                    </div>
                    <button onclick="spawnMore(${i})" class="btn" style="padding:5px 10px; font-size:11px; background:#4CAF50; width:80%;">追加放流</button>
                    ${btnHtml}
                </div>`;
            });
        }

        function focusOnTopMonster(index) {
            const sName = speciesBook[index].name;
            const living = monsters.filter(m => m.species === sName);
            if (living.length === 0) return;
            const topMonster = living.reduce((max, m) => m.level > max.level ? m : max, living[0]);
            selectedObject = topMonster;
            isFocus = true;
            document.getElementById('focusBtn').classList.add('active-focus');
            document.getElementById('focusBtn').innerText = "注目追従: ON";
            document.getElementById('targetMonitor').style.display = 'block';
            closeBook();
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
            
            // --- 追加：天候による画面暗転と雨エフェクト ---
            if (weather === 'rain' || weather === 'storm') {
                gCtx.fillStyle = weather === 'storm' ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.2)";
                gCtx.fillRect(0, 0, gCanvas.width, gCanvas.height);
                
                if (gameSpeed > 0) {
                    let dropCount = weather === 'storm' ? 5 : 2;
                    for(let i=0; i<dropCount * gameSpeed; i++) {
                        raindrops.push({ x: Math.random() * gCanvas.width, y: -20, l: Math.random() * 20 + 10, v: Math.random() * 10 + 15 });
                    }
                }
                gCtx.strokeStyle = "rgba(174, 194, 224, 0.5)";
                gCtx.lineWidth = 2;
                gCtx.beginPath();
                raindrops.forEach(r => {
                    gCtx.moveTo(r.x, r.y);
                    gCtx.lineTo(r.x - r.l * 0.3, r.y + r.l);
                    if (gameSpeed > 0) { r.x -= r.v * 0.3 * gameSpeed; r.y += r.v * gameSpeed; }
                });
                gCtx.stroke();
                raindrops = raindrops.filter(r => r.y < gCanvas.height && r.x > -50);
            }
            // ---------------------------------------------

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

// ==========================================
// 拡張パック：自動清掃・エラーガード・ショートカット
// ==========================================

// 1. パフォーマンス維持：増えすぎた死体やエサを自動で片付ける（30秒周期）
// 長時間放置してもブラウザが重くなるのを防ぎます
setInterval(() => {
    if (typeof corpses !== 'undefined' && corpses.length > 50) {
        corpses.splice(0, corpses.length - 50); // 古い死体から順に削除
    }
    if (typeof foods !== 'undefined' && foods.length > 1500) {
        foods.splice(0, 300); // 溜まりすぎたエサを古い順に間引く
    }
}, 30000);

// 2. クラッシュ防止：万が一変数が宣言されていなかった場合の自動補完
// 過去のコードとの不整合で発生する「undefinedエラー」を未然に防ぎます
(function() {
    const essentialArrays = ['monsters', 'foods', 'speciesBook', 'corpses', 'scenery', 'newBabies'];
    essentialArrays.forEach(v => {
        if (typeof window[v] === 'undefined') window[v] = [];
    });
    if (typeof window.zoom === 'undefined') window.zoom = 1;
    if (typeof window.camX === 'undefined') window.camX = 0;
    if (typeof window.camY === 'undefined') window.camY = 0;
    if (typeof window.gameSpeed === 'undefined') window.gameSpeed = 1;
})();

// 3. キーボードショートカット
// マウス操作以外での操作性を向上させます
window.addEventListener('keydown', (e) => {
    // 'S'キー：即座にセーブを実行
    if (e.key === 's' || e.key === 'S') {
        if (typeof saveGame === 'function') {
            saveGame();
        }
    }
    // 'C'キー：カメラ位置をワールド中央にリセット
    if (e.key === 'c' || e.key === 'C') {
        if (typeof worldW !== 'undefined' && typeof gCanvas !== 'undefined') {
            camX = (worldW / 2) - (gCanvas.width / 2 / (zoom || 1));
            camY = (worldH / 2) - (gCanvas.height / 2 / (zoom || 1));
            if (typeof addLog === 'function') addLog("🎥 カメラ位置をリセットしました");
        }
    }
});

// ==========================================
// 拡張パック：感情アイコン・縄張り・巣作りAI
// ==========================================
(function() {
    // 既存の基本処理（移動や描画）をバックアップ
    const origUpdate = Monster.prototype.update;
    const origDraw = Monster.prototype.draw;

    // --- 1. AIロジックの拡張 ---
    Monster.prototype.update = function() {
        // 元の生存判定・基本移動・空腹ダメージ等を先に実行
        const isAlive = origUpdate.call(this);
        if (!isAlive) return false;

        // 巣の座標がない場合（古いデータ等）は現在地をホームに設定
        if (typeof this.territoryX === 'undefined') {
            this.territoryX = this.x;
            this.territoryY = this.y;
        }

        this.emotion = "";
        let isSleeping = false;
        let distToNest = Math.sqrt((this.x - this.territoryX)**2 + (this.y - this.territoryY)**2);

        // ① 睡眠 (💤) : 夜間、またはHP30%以下
        if ((typeof isNight !== 'undefined' && isNight) || this.hp < this.hpMax * 0.3) {
            if (distToNest < 80) {
                isSleeping = true;
                this.vx = 0; this.vy = 0;
                this.emotion = "💤";
                this.hp = Math.min(this.hpMax, this.hp + 0.1); // 巣で休むと少しずつ回復
            } else {
                // 巣に帰還する
                let angle = Math.atan2(this.territoryY - this.y, this.territoryX - this.x);
                this.vx = Math.cos(angle) * this.speedVal;
                this.vy = Math.sin(angle) * this.speedVal;
                this.emotion = "💤"; 
            }
        }

        if (!isSleeping) {
            // ② 縄張り防衛と怒り (💢) : 巣の半径300以内にいる他種族を攻撃
            let enemy = monsters.find(m => m !== this && m.species !== this.species && !m.isDead && Math.sqrt((this.x - m.x)**2 + (this.y - m.y)**2) < 150);
            let isDefending = false;
            
            if (enemy && distToNest < 300) {
                let angle = Math.atan2(enemy.y - this.y, enemy.x - this.x);
                this.vx = Math.cos(angle) * (this.speedVal * 1.5); // 怒りのダッシュ
                this.vy = Math.sin(angle) * (this.speedVal * 1.5);
                this.emotion = "💢";
                isDefending = true;
                
                // 接触したらダメージを与える
                if (Math.sqrt((this.x - enemy.x)**2 + (this.y - enemy.y)**2) < 40) {
                    enemy.hp -= this.power * 0.05;
                }
            }

            // ③ パニック・逃走 (💦) : 縄張り外で、自分より明らかに強い敵が近くにいる場合
            if (!isDefending && enemy && enemy.power > this.power * 1.2) {
                let angle = Math.atan2(this.y - enemy.y, this.x - enemy.x); // 逆方向に逃げる
                this.vx = Math.cos(angle) * (this.speedVal * 1.5);
                this.vy = Math.sin(angle) * (this.speedVal * 1.5);
                this.emotion = "💦";
            }

            // ④ 求愛 (❤️) : 繁殖期かつ空腹でない
            if (!this.emotion && this.breedTimer <= 0 && this.hunger < 30) {
                let mate = monsters.find(m => m !== this && m.species === this.species && m.breedTimer <= 0 && Math.sqrt((this.x - m.x)**2 + (this.y - m.y)**2) < 200);
                if (mate) {
                    let angle = Math.atan2(mate.y - this.y, mate.x - this.x);
                    this.vx = Math.cos(angle) * this.speedVal;
                    this.vy = Math.sin(angle) * this.speedVal;
                    this.emotion = "❤️";
                }
            }

            // ⑤ 空腹 (🍖)
            if (!this.emotion && this.hunger > 60) {
                this.emotion = "🍖";
            }

            // ⑥ 巣作り（エサ・なきがらの運搬） : 満腹時に周囲のアイテムを巣へ集める
            if (!this.emotion && !isDefending && this.hunger < 50) {
                if (!this.carrying) {
                    // 足元にあるアイテムを探す
                    let itemIdx = -1, isCorpse = false;
                    if (typeof corpses !== 'undefined') {
                        itemIdx = corpses.findIndex(c => Math.sqrt((this.x - c.x)**2 + (this.y - c.y)**2) < 40);
                        isCorpse = true;
                    }
                    if (itemIdx === -1 && typeof foods !== 'undefined') {
                        itemIdx = foods.findIndex(f => Math.sqrt((this.x - f.x)**2 + (this.y - f.y)**2) < 40);
                        isCorpse = false;
                    }

                    if (itemIdx !== -1) {
                        // アイテムを拾う
                        this.carrying = isCorpse ? corpses.splice(itemIdx, 1)[0] : foods.splice(itemIdx, 1)[0];
                        this.carrying.isCorpse = isCorpse;
                    }
                } else {
                    // アイテムを巣に持ち帰る
                    if (distToNest < 50) {
                        // 巣の周りに配置
                        if (this.carrying.isCorpse && typeof corpses !== 'undefined') {
                            corpses.push({x: this.territoryX + Math.random()*40-20, y: this.territoryY + Math.random()*40-20});
                        } else if (typeof foods !== 'undefined') {
                            foods.push({x: this.territoryX + Math.random()*40-20, y: this.territoryY + Math.random()*40-20, type: this.carrying.type});
                        }
                        this.carrying = null;
                    } else {
                        let angle = Math.atan2(this.territoryY - this.y, this.territoryX - this.x);
                        this.vx = Math.cos(angle) * this.speedVal;
                        this.vy = Math.sin(angle) * this.speedVal;
                        this.emotion = "📦"; // 隠し要素：運搬中アイコン
                    }
                }
            }
        }
        
        // 追加AIによって移動方向(vx, vy)を上書きした場合、
        // 元コードのランダム移動処理に上書きされないようタイマーを延長して保護
        if (this.emotion !== "" || isSleeping || this.carrying) {
            this.timer = 10; 
        }

        return true;
    };

    // --- 2. 描画ロジックの拡張 ---
    Monster.prototype.draw = function() {
        // 元の描画（モンスター本体）を実行
        origDraw.call(this);

        // ズームとカメラの計算を安全に取得
        const z = typeof zoom !== 'undefined' ? zoom : 1;
        const cx = typeof camX !== 'undefined' ? camX : 0;
        const cy = typeof camY !== 'undefined' ? camY : 0;
        let sx = (this.x - cx) * z;
        let sy = (this.y - cy) * z;

        // 画面外ならアイコンを描画しない（パフォーマンス対策）
        if (sx < -50 || sx > (typeof gCanvas !== 'undefined' ? gCanvas.width : 2000) + 50 || 
            sy < -50 || sy > (typeof gCanvas !== 'undefined' ? gCanvas.height : 2000) + 50) return;

        const ctx = typeof gCtx !== 'undefined' ? gCtx : document.getElementById('gameCanvas').getContext('2d');

        // 感情アイコンを頭上に描画
        if (this.emotion) {
            ctx.font = `${24 * z}px sans-serif`;
            ctx.fillText(this.emotion, sx + 5 * z, sy - 5 * z);
        }
        
        // 運搬中のアイテムを足元に描画
        if (this.carrying) {
            ctx.fillStyle = this.carrying.isCorpse ? "#e0e0e0" : "#ff4444";
            ctx.fillRect(sx + 15 * z, sy + 15 * z, 8 * z, 8 * z);
        }
    };
})();

// ==========================================
// 睡眠回復 ＆ UI完全乗っ取りシステム（高速ループ対応版）
// ==========================================
(function() {
    // 1. 睡眠中（💤）のHP回復（ここは今まで通り動きます）
    if (window.healTimer) clearInterval(window.healTimer);
    window.healTimer = setInterval(() => {
        if (typeof monsters !== 'undefined' && Array.isArray(monsters)) {
            monsters.forEach(m => {
                if (m.emotion === '💤' && !m.isDead && m.hp < m.hpMax) {
                    m.hp = Math.min(m.hpMax, (m.hp || 0) + 2); 
                }
            });
        }
    }, 1000);

    // 2. 元の高速UIを透明にして、新しい専用UIを被せる
    const oldStats = document.getElementById('targetStats');
    if (oldStats) {
        // 元の文字表示を非表示にする（裏で動き続けるので元の絵のエラーは起きません）
        oldStats.style.display = 'none';
        
        // 新しい自分たち専用の表示エリアを作る
        let newStats = document.getElementById('superTargetStats');
        if (!newStats) {
            newStats = document.createElement('div');
            newStats.id = 'superTargetStats';
            // 古い表示エリアのすぐ下に挿入
            oldStats.parentNode.insertBefore(newStats, oldStats.nextSibling);
        }

        // 元の mainLoop と同じスピード（毎フレーム）で新しいUIを更新する
        function updateSuperUI() {
            if (typeof selectedObject !== 'undefined' && selectedObject) {
                const obj = selectedObject;
                let html = "";

                // --- モンスターかどうかの判定 ---
                if (obj.species !== undefined || obj.hpMax !== undefined) {
                    const em = obj.emotion || "通常";
                    const hpColor = em === '💤' ? '#00ff00' : '#ffffff';
                    
                    html = `
                        <div style="border-bottom:2px solid #555; margin-bottom:8px; padding-bottom:5px;">
                            <span style="font-size:1.6em; vertical-align:middle;">${em}</span>
                            <b style="font-size:1.3em; margin-left:8px;">${obj.species || "モンスター"}</b>
                        </div>
                        <div style="line-height:1.6;">
                            <b>Lv.${obj.level || 1}</b> [${obj.personality || "普通"}]<br>
                            HP: <span style="color:${hpColor}; font-weight:bold;">${Math.floor(obj.hp)}</span> / ${obj.hpMax}<br>
                            空腹: ${Math.floor(obj.hunger || 0)}%<br>
                            パワー: ${Math.floor(obj.power || 0)} / スピード: ${Math.floor((obj.speedVal || 0) * 10)}<br>
                            耐性: 🔥${obj.heatResist || 0} ❄️${obj.coldResist || 0}
                        </div>
                    `;
                } 
                // --- 食べ物（エサ）・なきがらの場合 ---
                else {
                    const type = obj.type || (obj.isCorpse ? "corpse" : "item");
                    const icons = { fruit: '🍎', fish: '🐟', mushroom: '🍄', corpse: '🦴' };
                    const icon = icons[type] || '📦';
                    const label = type === 'corpse' ? 'なきがら' : type.toUpperCase();
                    
                    // 回復量の計算（基本20）
                    const recovery = obj.value || obj.nutrition || 20;

                    html = `
                        <div style="border-bottom:2px solid #555; margin-bottom:8px; padding-bottom:5px;">
                            <span style="font-size:1.6em; vertical-align:middle;">${icon}</span>
                            <b style="font-size:1.3em; margin-left:8px;">${label}</b>
                        </div>
                        <div style="line-height:1.6;">
                            <span style="background:#827717; color:#fff; padding:2px 8px; border-radius:4px; font-weight:bold;">
                                回復量: 🍖 ${recovery}
                            </span><br>
                            <div style="margin-top:8px; color:#ccc; font-size:0.9em;">
                                状態: フィールドオブジェクト<br>
                                座標: X:${Math.floor(obj.x)} Y:${Math.floor(obj.y)}
                            </div>
                        </div>
                    `;
                }

                // 画面のチラつきを防ぐため、内容が変わった時だけ書き換え
                if (newStats.innerHTML !== html) {
                    newStats.innerHTML = html;
                }
            } else {
                // 何も選択されていない時は空にする
                if (newStats.innerHTML !== "") {
                    newStats.innerHTML = "";
                }
            }
            
            // 次のフレームも自分自身を呼び出して更新し続ける
            requestAnimationFrame(updateSuperUI); 
        }
        
        // 影のUIループを開始！

// ==========================================
// 【拡張】突然変異システム ＆ UI表示アップデート
// ==========================================
(function() {
    // --- システム1：突然変異 生成ロジック ---
    // 生まれたばかりのモンスターを監視し、1%で能力を倍にします。
    if (window.mutationSystemTimer) clearInterval(window.mutationSystemTimer);
    
    window.mutationSystemTimer = setInterval(() => {
        if (typeof monsters === 'undefined' || !Array.isArray(monsters)) return;

        monsters.forEach(m => {
            // まだ突然変異のチェックをしていないモンスター（生まれたばかり）が対象
            if (m.isDead) return;
            if (m.hasMutationChecked === undefined) {
                
                // 【1%の確率】で突然変異が発生
                if (Math.random() < 1.0) { 
                    m.isMutant = true; // 突然変異フラグを立てる

                    // パワーかスピード、どちらを倍にするか決める（50%ずつ）
                    if (Math.random() < 0.5) {
                        // パワーを2倍に（念のため数値であることを確認）
                        m.power = (m.power || 10) * 2;
                        m.mutantType = "力"; // UI表示用の目印
                    } else {
                        // スピードを2倍に
                        m.speedVal = (m.speedVal || 1) * 2;
                        m.mutantType = "速";
                    }
                }

                // チェック完了フラグを立てる（二度と倍にならないようにするため）
                m.hasMutationChecked = true; 
            }
        });
    }, 500); // 0.5秒ごとに新しい個体をチェック


    // --- システム2：UI完全乗っ取りシステム（突然変異表示対応版） ---
    // 前回の高速上書きロジックを、突然変異の表示に対応させます。
    
    const oldStats = document.getElementById('targetStats');
    if (oldStats) {
        // 元のUIを非表示にする
        oldStats.style.display = 'none';
        
        // 自分たち専用の表示エリア（superTargetStats）を作る（なければ）
        let newStats = document.getElementById('superTargetStats');
        if (!newStats) {
            newStats = document.createElement('div');
            newStats.id = 'superTargetStats';
            oldStats.parentNode.insertBefore(newStats, oldStats.nextSibling);
        }

        // 毎フレームUIを更新するループ関数
        function updateSuperUIWithMutation() {
            if (typeof selectedObject !== 'undefined' && selectedObject) {
                const obj = selectedObject;
                let html = "";

                // --- 判定：モンスターの場合 ---
                if (obj.species !== undefined || obj.hpMax !== undefined) {
                    const em = obj.emotion || "通常";
                    const hpColor = em === '💤' ? '#00ff00' : '#ffffff';
                    
                    // 【追加点】突然変異個体の場合のラベルを作成
                    let mutantLabel = "";
                    if (obj.isMutant) {
                        const typeChar = obj.mutantType || "？";
                        const typeColor = typeChar === "力" ? "#ff5252" : "#40c4ff"; // 力は赤、速は青
                        mutantLabel = `
                            <div style="background:linear-gradient(45deg, #444, #222); border:1px solid ${typeColor}; color:${typeColor}; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold; display:inline-block; margin-bottom:5px; box-shadow:0 0 5px ${typeColor};">
                                🌟 突然変異個体【${typeChar}】
                            </div>
                        `;
                    }

                    // パワーとスピードの表示スタイル（突然変異した方を強調）
                    const pStyle = (obj.isMutant && obj.mutantType === "力") ? "color:#ff5252; font-weight:bold; text-shadow:0 0 3px #ff5252;" : "";
                    const sStyle = (obj.isMutant && obj.mutantType === "速") ? "color:#40c4ff; font-weight:bold; text-shadow:0 0 3px #40c4ff;" : "";

                    html = `
                        ${mutantLabel}
                        <div style="border-bottom:2px solid #555; margin-bottom:8px; padding-bottom:5px;">
                            <span style="font-size:1.6em; vertical-align:middle;">${em}</span>
                            <b style="font-size:1.3em; margin-left:8px;">${obj.species || "モンスター"}</b>
                        </div>
                        <div style="line-height:1.6; font-family:monospace;">
                            <b>Lv.${obj.level || 1}</b> [${obj.personality || "普通"}]<br>
                            HP: <span style="color:${hpColor}; font-weight:bold;">${Math.floor(obj.hp)}</span> / ${obj.hpMax}<br>
                            空腹: ${Math.floor(obj.hunger || 0)}%<br>
                            パワー: <span style="${pStyle}">${Math.floor(obj.power || 0)}</span> / 速さ: <span style="${sStyle}">${Math.floor((obj.speedVal || 0) * 10)}</span><br>
                            耐性: 🔥${obj.heatResist || 0} ❄️${obj.coldResist || 0}
                        </div>
                    `;
                } 
                // --- 判定：食べ物（エサ）・なきがらの場合（変更なし） ---
                else {
                    const type = obj.type || (obj.isCorpse ? "corpse" : "item");
                    const icons = { fruit: '🍎', fish: '🐟', mushroom: '🍄', corpse: '🦴' };
                    const icon = icons[type] || '📦';
                    const label = type === 'corpse' ? 'なきがら' : type.toUpperCase();
                    const recovery = obj.value || obj.nutrition || 20;

                    html = `
                        <div style="border-bottom:2px solid #555; margin-bottom:8px; padding-bottom:5px;">
                            <span style="font-size:1.6em; vertical-align:middle;">${icon}</span>
                            <b style="font-size:1.3em; margin-left:8px;">${label}</b>
                        </div>
                        <div style="line-height:1.6;">
                            <span style="background:#827717; color:#fff; padding:2px 8px; border-radius:4px; font-weight:bold;">
                                回復量: 🍖 ${recovery}
                            </span><br>
                            <div style="margin-top:8px; color:#ccc; font-size:0.9em;">
                                状態: フィールドオブジェクト<br>
                                座標: X:${Math.floor(obj.x)} Y:${Math.floor(obj.y)}
                            </div>
                        </div>
                    `;
                }

                // 内容が変わった時だけ書き換え
                if (newStats.innerHTML !== html) {
                    newStats.innerHTML = html;
                }
            } else {
                if (newStats.innerHTML !== "") newStats.innerHTML = "";
            }
            
            // 次のフレームも更新
            requestAnimationFrame(updateSuperUIWithMutation); 
        }
        
        // 影のUIループを開始！
        updateSuperUIWithMutation(); 
    }
})();


            
        updateSuperUI(); 
    }
})();
