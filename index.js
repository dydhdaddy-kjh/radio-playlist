const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 8888;
app.use(express.json());
app.use('/fonts', express.static(path.join(__dirname, 'fonts')));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

let accessToken = null;
let refreshToken = null;
let tokenExpiry = null;

const PROGRAMS = {
  'cbs_P000218': '그대와 여는 아침 (김용신)',
  'cbs_P000219': '한동준의 FM POPS',
  'cbs_P000221': '허윤희의 꿈과 음악사이에',
  'cbs_P000011': '김현주의 행복한 동행',
  'cbs_P000223': '박승화의 가요속으로',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function refreshAccessToken() {
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      { headers: { 'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  } catch (e) {
    accessToken = null;
  }
}

async function ensureValidToken() {
  if (!accessToken || !refreshToken) return false;
  if (Date.now() >= tokenExpiry) await refreshAccessToken();
  return !!accessToken;
}

const FONT_CSS = `
  @font-face {
    font-family: 'DoHee';
    src: url('/fonts/dohee.ttf') format('truetype');
    font-weight: normal;
    font-style: normal;
  }
`;

const BASE_STYLE = `
  ${FONT_CSS}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DoHee', -apple-system, sans-serif; font-size: 19px; min-height: 100vh; transition: background 0.3s, color 0.3s; }
  body.dark { background: #141414; color: #f4a7b9; }
  body.light { background: #fde8ef; color: #3a2030; }

  header { padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
  body.dark header { border-bottom: 1px solid #2a2a2a; }
  body.light header { border-bottom: 1px solid #f0c0d0; }

  .logo { font-size: 16px; letter-spacing: 4px; text-transform: uppercase; }
  body.dark .logo { color: #c47a8a; }
  body.light .logo { color: #b06070; }

  .header-right { display: flex; align-items: center; gap: 16px; }
  .status { font-size: 14px; color: #4caf50; display: flex; align-items: center; gap: 6px; }
  .status::before { content: ''; width: 6px; height: 6px; background: #4caf50; border-radius: 50%; display: inline-block; }

  .theme-btn { padding: 6px 14px; border-radius: 100px; font-size: 14px; font-family: 'DoHee', sans-serif; cursor: pointer; border: none; transition: all 0.3s; }
  body.dark .theme-btn { background: #2a2a2a; color: #f4a7b9; }
  body.light .theme-btn { background: #f0c0d0; color: #3a2030; }
  .theme-btn:hover { opacity: 0.75; }

  .logout-btn { padding: 6px 14px; border-radius: 100px; font-size: 14px; font-family: 'DoHee', sans-serif; cursor: pointer; border: none; transition: all 0.3s; }
  body.dark .logout-btn { background: #2a2a2a; color: #7a5060; }
  body.light .logout-btn { background: #f0c0d0; color: #906070; }
  .logout-btn:hover { opacity: 0.75; }

  main { max-width: 600px; margin: 0 auto; padding: 40px 24px; }
  .tabs { display: flex; margin-bottom: 36px; }
  body.dark .tabs { border-bottom: 1px solid #2a2a2a; }
  body.light .tabs { border-bottom: 1px solid #f0c0d0; }

  .tab { padding: 12px 24px; font-size: 18px; font-family: 'DoHee', sans-serif; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.2s; background: none; border-top: none; border-left: none; border-right: none; }
  body.dark .tab { color: #7a5060; }
  body.dark .tab.active { color: #f4a7b9; border-bottom-color: #f4a7b9; }
  body.light .tab { color: #c090a0; }
  body.light .tab.active { color: #3a2030; border-bottom-color: #3a2030; }

  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .field { margin-bottom: 20px; }
  label { display: block; font-size: 15px; margin-bottom: 8px; }
  body.dark label { color: #c47a8a; }
  body.light label { color: #906070; }

  select, input[type=text], input[type=date] { width: 100%; padding: 13px 14px; border-radius: 6px; font-size: 18px; font-family: 'DoHee', sans-serif; outline: none; transition: border-color 0.2s; }
  body.dark select, body.dark input { border: 1px solid #2a2a2a; background: #1e1414; color: #f4a7b9; }
  body.dark select:focus, body.dark input:focus { border-color: #f4a7b9; }
  body.light select, body.light input { border: 1px solid #f0c0d0; background: #fff0f4; color: #3a2030; }
  body.light select:focus, body.light input:focus { border-color: #c06080; }
  select option { background: #1e1414; }

  textarea { width: 100%; padding: 13px 14px; border-radius: 6px; font-size: 16px; font-family: monospace; outline: none; resize: vertical; min-height: 180px; transition: border-color 0.2s; }
  body.dark textarea { border: 1px solid #2a2a2a; background: #1e1414; color: #f4a7b9; }
  body.dark textarea:focus { border-color: #f4a7b9; }
  body.light textarea { border: 1px solid #f0c0d0; background: #fff0f4; color: #3a2030; }
  body.light textarea:focus { border-color: #c06080; }

  .hint { font-size: 13px; margin-top: 6px; }
  body.dark .hint { color: #5a3a4a; }
  body.light .hint { color: #c090a0; }

  .btn { width: 100%; padding: 14px; border: none; border-radius: 6px; font-size: 18px; font-family: 'DoHee', sans-serif; cursor: pointer; transition: opacity 0.2s; margin-top: 8px; }
  body.dark .btn { background: #f4a7b9; color: #141414; }
  body.light .btn { background: #c06080; color: white; }
  .btn:hover { opacity: 0.75; }

  #aiResult { margin-top: 24px; padding: 20px; border-radius: 6px; font-size: 16px; line-height: 1.9; display: none; }
  #aiResult.show { display: block; }
  body.dark #aiResult { background: #1e1414; border: 1px solid #2a2a2a; color: #c47a8a; }
  body.light #aiResult { background: #fff0f4; border: 1px solid #f0c0d0; color: #906070; }

  .back { display: inline-block; margin-top: 32px; font-size: 16px; text-decoration: none; }
  body.dark .back { color: #5a3a4a; }
  body.dark .back:hover { color: #f4a7b9; }
  body.light .back { color: #c090a0; }
  body.light .back:hover { color: #3a2030; }

  @media (max-width: 480px) {
    body { font-size: 20px; }
    main { padding: 32px 16px; }
    .tab { font-size: 19px; padding: 10px 18px; }
    select, input[type=text], input[type=date] { font-size: 19px; }
    .btn { font-size: 19px; padding: 15px; }
  }
`;

const THEME_SCRIPT = `
  const saved = localStorage.getItem('theme') || 'dark';
  document.body.className = saved;
  function toggleTheme() {
    const next = document.body.className === 'dark' ? 'light' : 'dark';
    document.body.className = next;
    localStorage.setItem('theme', next);
    document.querySelector('.theme-btn').textContent = next === 'dark' ? '🌸 밝게' : '🌙 어둡게';
  }
  document.querySelector('.theme-btn').textContent = saved === 'dark' ? '🌸 밝게' : '🌙 어둡게';
`;

app.get('/login', (req, res) => {
  const scope = 'playlist-modify-public playlist-modify-private';
  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      { headers: { 'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;
    tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
    res.redirect('/');
  } catch (e) {
    res.send('로그인 실패: ' + e.message);
  }
});

app.get('/logout', (req, res) => {
  accessToken = null;
  refreshToken = null;
  tokenExpiry = null;
  res.redirect('/');
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!accessToken) {
    return res.send(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Radio Playlist</title>
<style>
  ${FONT_CSS}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DoHee', sans-serif; background: #141414; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box { text-align: center; padding: 48px 32px; }
  .logo { font-size: 17px; letter-spacing: 4px; color: #c47a8a; margin-bottom: 32px; }
  h1 { font-size: 26px; font-weight: normal; color: #f4a7b9; margin-bottom: 10px; }
  p { color: #7a5060; font-size: 18px; margin-bottom: 40px; line-height: 1.7; }
  .btn { display: inline-block; padding: 14px 36px; background: #f4a7b9; color: #141414; text-decoration: none; border-radius: 100px; font-size: 18px; font-family: 'DoHee', sans-serif; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.75; }
</style></head>
<body>
  <div class="login-box">
    <div class="logo">Radio Playlist</div>
    <h1>나만의 라디오 플레이리스트</h1>
    <p>CBS 선곡표와 AI 추천으로<br>스포티파이 플리를 만들어요</p>
    <a href="/login" class="btn">Spotify로 시작하기</a>
  </div>
</body></html>`);
  }

  const programOptions = Object.entries(PROGRAMS)
    .map(([code, name]) => `<option value="${code}">${name}</option>`)
    .join('');

  res.send(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Radio Playlist</title>
<style>${BASE_STYLE}</style></head>
<body class="dark">
<header>
  <div class="logo">Radio Playlist</div>
  <div class="header-right">
    <div class="status">Spotify 연결됨</div>
    <button class="theme-btn" onclick="toggleTheme()">🌸 밝게</button>
    <a href="/logout" class="logout-btn">로그아웃</a>
  </div>
</header>
<main>
  <div class="tabs">
    <button class="tab active" onclick="showTab('cbs', this)">CBS 선곡표</button>
    <button class="tab" onclick="showTab('ai', this)">AI 추천</button>
  </div>

  <div id="cbs" class="tab-content active">
    <form action="/create" method="get">
      <div class="field">
        <label>프로그램</label>
        <select name="program">${programOptions}</select>
      </div>
      <div class="field">
        <label>시작 날짜</label>
        <input type="date" name="startDate" required>
      </div>
      <div class="field">
        <label>종료 날짜</label>
        <input type="date" name="endDate" required>
      </div>
      <div class="field">
        <label>플레이리스트 이름</label>
        <input type="text" name="name" placeholder="이름을 입력하세요">
      </div>
      <button type="submit" class="btn">플레이리스트 만들기</button>
    </form>
  </div>

  <div id="ai" class="tab-content">
    <div class="field">
      <label>곡 목록</label>
      <textarea id="trackList" placeholder="곡명 - 아티스트 형식으로 한 줄씩&#10;&#10;So What - Miles Davis&#10;Take Five - Dave Brubeck"></textarea>
      <div class="hint">Claude가 추천한 곡 목록을 붙여넣으세요</div>
    </div>
    <div class="field">
      <label>플레이리스트 이름</label>
      <input type="text" id="aiPlaylistName" placeholder="이름을 입력하세요">
    </div>
    <button class="btn" onclick="createAiPlaylist()">플레이리스트 만들기</button>
    <div id="aiResult"></div>
  </div>
</main>

<script>
  ${THEME_SCRIPT}

  function showTab(tab, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(tab).classList.add('active');
    el.classList.add('active');
  }

  async function createAiPlaylist() {
    const text = document.getElementById('trackList').value.trim();
    const name = document.getElementById('aiPlaylistName').value.trim() || 'AI 추천 플리';
    if (!text) { alert('곡 목록을 입력해주세요'); return; }

    const result = document.getElementById('aiResult');
    result.className = 'show';
    result.innerHTML = '⏳ 생성 중...';

    const res = await fetch('/create-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackList: text, name })
    });
    const data = await res.json();

    if (data.error) {
      result.innerHTML = '❌ 오류: ' + data.error;
    } else {
      result.innerHTML = '✓ <b>' + data.name + '</b> 생성 완료<br>추가된 곡: ' + data.added + '곡' +
        (data.notFound.length > 0 ? '<br><br><span style="opacity:0.5">못 찾은 곡:<br>' + data.notFound.join('<br>') + '</span>' : '');
    }
  }
</script>
</body></html>`);
});

function getDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

async function getTracksForDate(programCode, date) {
  const url = `https://www.cbs.co.kr/program/playlist/${programCode}?date=${date}`;
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $ = cheerio.load(res.data);
  const tracks = [];

  $('ul li').each((i, el) => {
    const img = $(el).find('img');
    const title = img.attr('alt') || '';
    if (!title || title.includes('배너') || title.includes('banner')) return;

    let artist = '';
    const liText = $(el).text().trim();
    const lines = liText.split('\n').map(l => l.trim()).filter(l => l);

    for (const line of lines) {
      if (line === title) continue;
      if (/^\d{2}:\d{2}/.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (line.includes('배너')) continue;
      artist = line;
      break;
    }

    tracks.push({ title, artist });
  });
  return tracks;
}

async function searchTrack(title, artist) {
  try {
    const query = encodeURIComponent(`${title} ${artist}`);
    const res = await axios.get(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const items = res.data.tracks.items;
    return items.length > 0 ? items[0].uri : null;
  } catch(e) {
    if (e.response && e.response.status === 429) {
      const retryAfter = (e.response.headers['retry-after'] || 3) * 1000;
      await sleep(retryAfter);
      return searchTrack(title, artist);
    }
    return null;
  }
}

app.post('/create-ai', async (req, res) => {
  const { trackList, name } = req.body;
  const valid = await ensureValidToken();
  if (!valid) return res.json({ error: '로그인이 필요해요' });

  try {
    const lines = trackList.split('\n').map(l => l.trim()).filter(l => l && l.includes('-'));
    const tracks = lines.map(line => {
      const parts = line.split('-').map(p => p.trim());
      return { title: parts[0], artist: parts[1] || '' };
    });

    const uris = [];
    const notFound = [];
    for (const track of tracks) {
      await ensureValidToken();
      const uri = await searchTrack(track.title, track.artist);
      if (uri) uris.push(uri);
      else notFound.push(`${track.title} - ${track.artist}`);
      await sleep(200);
    }

    const plRes = await axios.post('https://api.spotify.com/v1/me/playlists',
      { name, public: true },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    const playlistId = plRes.data.id;

    for (let i = 0; i < uris.length; i += 100) {
      await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/items`,
        { uris: uris.slice(i, i + 100) },
        { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
    }

    res.json({ name, added: uris.length, notFound });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/create', async (req, res) => {
  const { program, startDate, endDate, name } = req.query;
  const programName = PROGRAMS[program] || program;
  const playlistName = name || programName;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const valid = await ensureValidToken();
  if (!valid) {
    return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:#141414;color:#f4a7b9;font-family:sans-serif;padding:40px"><p>로그인이 필요해요. <a href="/login" style="color:#f4a7b9">로그인</a></p></body></html>`);
  }

  try {
    res.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Radio Playlist</title>
<style>${BASE_STYLE}</style></head><body class="dark">
<header>
  <div class="logo">Radio Playlist</div>
  <div class="header-right">
    <button class="theme-btn" onclick="toggleTheme()">🌸 밝게</button>
    <a href="/logout" class="logout-btn">로그아웃</a>
  </div>
</header>
<main>
<p style="font-size:18px; opacity:0.5; margin-bottom:20px;">플레이리스트 생성 중</p>
<p style="font-size:20px;">${programName}</p>
<p style="opacity:0.5; margin-top:8px;">${startDate} ~ ${endDate}</p>
<p style="margin-top:20px; opacity:0.3;">잠시 기다려주세요...</p>`);

    const dates = getDateRange(startDate, endDate);
    const allTracks = [];
    const foundDates = [];

    for (const date of dates) {
      try {
        const tracks = await getTracksForDate(program, date);
        if (tracks.length > 0) { allTracks.push(...tracks); foundDates.push(date); }
      } catch(e) { continue; }
    }

    if (allTracks.length === 0) {
      res.end(`<p style="opacity:0.5; margin-top:24px;">선곡표를 찾을 수 없어요.</p><a href="/" class="back">← 돌아가기</a></main><script>${THEME_SCRIPT}</script></body></html>`);
      return;
    }

    const unique = allTracks.filter((t, i, arr) =>
      arr.findIndex(x => x.title === t.title && x.artist === t.artist) === i
    );

    const uris = [];
    const notFound = [];
    for (const track of unique) {
      await ensureValidToken();
      const uri = await searchTrack(track.title, track.artist);
      if (uri) uris.push(uri);
      else notFound.push(`${track.title} - ${track.artist}`);
      await sleep(200);
    }

    await ensureValidToken();
    const plRes = await axios.post('https://api.spotify.com/v1/me/playlists',
      { name: `${playlistName} (${startDate}~${endDate})`, public: true },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    const playlistId = plRes.data.id;

    for (let i = 0; i < uris.length; i += 100) {
      await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/items`,
        { uris: uris.slice(i, i + 100) },
        { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
    }

    res.write(`<p style="font-size:22px; margin-top:32px;">✓ 완료</p>`);
    res.write(`<p style="margin-top:12px; font-size:20px;">${playlistName}</p>`);
    res.write(`<p style="opacity:0.5;">${startDate}~${endDate} · ${uris.length}곡 추가</p>`);
    if (notFound.length > 0) {
      res.write(`<p style="margin-top:16px; opacity:0.3; font-size:15px;">못 찾은 곡:<br>${notFound.join('<br>')}</p>`);
    }
    res.end(`<a href="/" class="back">← 돌아가기</a></main><script>${THEME_SCRIPT}</script></body></html>`);

  } catch(e) {
    res.end(`<p style="opacity:0.5;">오류: ${e.message}</p><a href="/" class="back">← 돌아가기</a></main><script>${THEME_SCRIPT}</script></body></html>`);
  }
});

app.listen(process.env.PORT || PORT, '0.0.0.0', () => {
  console.log(`서버 시작! http://127.0.0.1:8888`);
});