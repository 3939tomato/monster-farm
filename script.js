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
        setInterval(() => { if(gameSpeed > 0) for(let i=0; i<gameSpeed; i++) spawnFoodCluster(); }, 1000);

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

                const currentBiome = getBiome(this.x, this.y);
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
                    
                    if (this.diet === "肉食") {
                        let target = monsters.find(m => m !== this && m.species !== this.species && Math.sqrt((this.x-m.x)**2+(this.y-m.y)**2) < 100);
                        if (target) { target.hp -= (this.power / 10) + 1; if (target.hp <= 0) target.die("捕食"); }
                    } else if (this.diet === "雑食") {
                        let target = monsters.find(m => m.diet === "草食" && Math.sqrt((this.x-m.x)**2+(this.y-m.y)**2) < 100);
                        if (target) { target.hp -= (this.power / 10) + 1; if (target.hp <= 0) target.die("捕食"); }
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
                    // エサ探し：魚は草食モンスターには無視させる
                    let food = foods.find(f => {
                        if (f.type === 'fish' && this.diet === "草食") return false;
                        return Math.sqrt((this.x-f.x)**2+(this.y-f.y)**2) < searchDist;
                    });

                    if (!food && this.cachedAllies.length > 0) {
                        let scout = this.cachedAllies.find(a => a.hunger > 30 && (Math.abs(a.vx)>0.5 || Math.abs(a.vy)>0.5));
                        if(scout) { moveX += scout.vx * 15; moveY += scout.vy * 15; }
                    }

                    let angle;
                    if (food && this.hunger > 10) {
                        angle = Math.atan2(food.y - this.y, food.x - this.x);
                    } else if (currentBiome !== this.targetBiome) {
                        angle = Math.atan2(this.territoryY - this.y + moveY, this.territoryX - this.x + moveX);
                    } else {
                        angle = Math.random()*Math.PI*2;
                    }
                    this.vx = Math.cos(angle)*this.speed + (moveX/100); 
                    this.vy = Math.sin(angle)*this.speed + (moveY/100);
                }
                
                this.x = Math.max(85, Math.min(worldW-145, this.x + this.vx));
                this.y = Math.max(85, Math.min(worldH-145, this.y + this.vy));
                
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
                    corpses.forEach((c, i) => { if (Math.sqrt((this.x-c.x)**2+(this.y-c.y)**2) < 50 && (this.diet!=="草食")) { this.hunger = Math.max(0, this.hunger-60); this.hp = Math.min(this.hpMax, this.hp+40); corpses.splice(i, 1); } });
                    foods.forEach((f, i) => { 
                        if (Math.sqrt((this.x+30-f.x)**2+(this.y+30-f.y)**2) < 50) { 
                            // 食べる際も魚は草食には食べさせない
                            if (f.type === 'fish' && this.diet === "草食") return;
                            this.hunger = Math.max(0, this.hunger-40); 
                            this.hp = Math.min(this.hpMax, this.hp+20); 
                            foods.splice(i, 1); 
                        } 
                    });
                }
                return true;
            }
            draw() {
                const sx = (this.x - camX) * zoom, sy = (this.y - camY) * zoom;
                if (sx < -100 || sx > gCanvas.width + 100 || sy < -100 || sy > gCanvas.height + 100) return;
                const s = (60/32)*zoom;
                for(let y=0; y<32; y++) for(let x=0; x<32; x++) if(this.data[y][x]){ gCtx.fillStyle = this.data[y][x]; gCtx.fillRect(sx+x*s, sy+y*s, s+1, s+1); }
                if (selectedObject === this) { gCtx.strokeStyle = "yellow"; gCtx.lineWidth = 3; gCtx.strokeRect(sx, sy, 60*zoom, 60*zoom); }
            }
        }

        gCanvas.addEventListener('mousedown', (e) => {
            isDragging = true; lastMouseX = e.clientX; lastMouseY = e.clientY;
            const mx = (e.clientX / zoom) + camX, my = (e.clientY / zoom) + camY;
            let found = monsters.find(m => mx > m.x && mx < m.x+60 && my > m.y && my < m.y+60);
            if(!found) found = foods.find(f => Math.sqrt((mx-f.x)**2 + (my-f.y)**2) < 40);
            if(!found) found = corpses.find(c => Math.sqrt((mx-c.x)**2 + (my-c.y)**2) < 40);
            selectedObject = found;
            document.getElementById('targetMonitor').style.display = selectedObject ? 'block' : 'none';
        });
        window.addEventListener('mousemove', (e) => { if(isDragging && !isFocus){ camX-=(e.clientX-lastMouseX)/zoom; camY-=(e.clientY-lastMouseY)/zoom; } lastMouseX=e.clientX; lastMouseY=e.clientY; });
        window.addEventListener('mouseup', () => isDragging = false);
        
        // ズーム機能：カーソルを中心に拡大縮小
        window.addEventListener('wheel', (e) => {
            e.preventDefault();
            const mx = e.clientX, my = e.clientY;
            const worldX = mx / zoom + camX, worldY = my / zoom + camY;
            
            zoom *= e.deltaY > 0 ? 0.9 : 1.1;
            zoom = Math.max(0.01, Math.min(3.0, zoom));
            
            camX = worldX - mx / zoom;
            camY = worldY - my / zoom;
            
            document.getElementById('zoomSlider').value = zoom * 100;
        }, {passive:false});

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
            
            // 図鑑に登録
            speciesBook.push({name:"ブルースライム",url:blue.url,pixels:blue.p,mi:10,ma:20,diet:"雑食",h:0,c:0,count:15});
            speciesBook.push({name:"レッドスライム",url:red.url,pixels:red.p,mi:10,ma:20,diet:"雑食",h:0,c:0,count:25});
            
            // 初回放流
            for(let i=0; i<15; i++) monsters.push(new Monster(blue.p,"ブルースライム",10,20,blue.url,"雑食",0,0));
            for(let i=0; i<25; i++) monsters.push(new Monster(red.p,"レッドスライム",10,20,red.url,"雑食",0,0));
        }

        // --- セーブ機能とロード機能の追加 ---
        function saveGame() {
            const saveData = {
                monsters: monsters.map(m => {
                    let mData = Object.assign({}, m);
                    delete mData.cachedAllies; // エラー回避のため循環参照を削除
                    return mData;
                }),
                speciesBook: speciesBook,
                scenery: scenery,
                foods: foods,
                corpses: corpses,
                camX: camX,
                camY: camY,
                zoom: zoom
            };
            localStorage.setItem('monsterFarmSave', JSON.stringify(saveData));
            addLog('💾 セーブしました！');
        }

        function resetGame() {
            if(confirm("本当にセーブデータを消去して最初からやり直しますか？")) {
                localStorage.removeItem('monsterFarmSave');
                location.reload();
            }
        }

        function loadGame() {
            const saved = localStorage.getItem('monsterFarmSave');
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    speciesBook = data.speciesBook || [];
                    scenery = data.scenery || [];
                    foods = data.foods || [];
                    corpses = data.corpses || [];
                    camX = data.camX !== undefined ? data.camX : (CHUNK * 4);
                    camY = data.camY !== undefined ? data.camY : (CHUNK * 4);
                    zoom = data.zoom || 0.3;
                    document.getElementById('zoomSlider').value = zoom * 100;
                    
                    monsters = [];
                    (data.monsters || []).forEach(m => {
                        let newM = new Monster(m.data, m.species, 10, 10, m.artUrl, m.diet, m.heatResist, m.coldResist);
                        Object.assign(newM, m);
                        newM.cachedAllies = []; // 初期化
                        monsters.push(newM);
                    });
                    addLog('📂 データをロードしました！');
                } catch(e) {
                    console.error("セーブデータの読み込みに失敗しました", e);
                    initEnvironment(); initSlimes();
                }
            } else {
                initEnvironment(); initSlimes();
            }
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
                    monsters = monsters.filter(m => m.update()); 
                    if(newBabies.length > 0) { monsters = monsters.concat(newBabies); newBabies = []; }
                } 
            }
            monsters.forEach(m => m.draw());

            if(isFocus && selectedObject instanceof Monster) { camX = selectedObject.x - (gCanvas.width/2)/zoom; camY = selectedObject.y - (gCanvas.height/2)/zoom; }
            
            if(selectedObject) {
                const obj = selectedObject;
                tCtx.clearRect(0,0,32,32);
                let statsHtml = "";
                if(obj instanceof Monster) {
                    obj.data.forEach((row,y)=>row.forEach((c,x)=>{if(c){tCtx.fillStyle=c; tCtx.fillRect(x,y,1,1);}}));
                    statsHtml = `<b>${obj.species}</b> [${obj.diet}]<br>耐性: 🔥${obj.heatResist} ❄️${obj.coldResist}<br>合計値: ${Math.floor(obj.totalStat)}<br>パワー: ${Math.floor(obj.power)}<br>スピード: ${Math.floor(obj.speedVal * 10)}<br>体力: ${Math.floor(obj.stamina)}<br>HP: ${Math.floor(obj.hp)} / ${Math.floor(obj.hpMax)}<br>空腹: ${Math.floor(obj.hunger)}%<br>性格: ${obj.personality}`;
                } else if(obj.type) { 
                    drawPixelArt(tCtx, 4, 4, artData[obj.type].p, artData[obj.type].d, 6, false);
                    statsHtml = `<b>${obj.type}</b> (自然のエサ)<br><br>空腹回復: <span style="color:#4CAF50;">40</span><br>HP回復: <span style="color:#2196F3;">20</span>`;
                } else { 
                    drawPixelArt(tCtx, 4, 4, artData.corpse.p, artData.corpse.d, 6, false);
                    statsHtml = `<b>なきがら</b><br><br>空腹回復: <span style="color:#e91e63;">60</span><br><small>肉食・雑食が捕食可能</small>`;
                }
                document.getElementById('targetStats').innerHTML = statsHtml;
            }
            document.getElementById('count').innerText = monsters.length;
            requestAnimationFrame(mainLoop);
        }
        
        window.onresize = () => { gCanvas.width = window.innerWidth; gCanvas.height = window.innerHeight; };
        window.onresize(); 
        loadGame(); // 初期化をloadGame()に置き換えました
        mainLoop();
