const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 8888;
app.use(express.json());

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
    console.log('토큰 자동 갱신 완료!');
  } catch (e) {
    console.log('토큰 갱신 실패:', e.message);
    accessToken = null;
  }
}

async function ensureValidToken() {
  if (!accessToken || !refreshToken) return false;
  if (Date.now() >= tokenExpiry) {
    await refreshAccessToken();
  }
  return !!accessToken;
}

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

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!accessToken) {
    return res.send(`
      <html><head><meta charset="utf-8"></head><body>
      <h1>📻 CBS 라디오 플레이리스트 생성기</h1>
      <a href="/login">스포티파이 로그인</a>
      </body></html>
    `);
  }

  const programOptions = Object.entries(PROGRAMS)
    .map(([code, name]) => `<option value="${code}">${name}</option>`)
    .join('');

  res.send(`
    <html><head><meta charset="utf-8">
    <style>
      body { font-family: sans-serif; padding: 20px; }
      .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
      .tab { padding: 8px 20px; cursor: pointer; border: 1px solid #ccc; border-radius: 4px; background: #f5f5f5; }
      .tab.active { background: #1db954; color: white; border-color: #1db954; }
      .tab-content { display: none; }
      .tab-content.active { display: block; }
      textarea { width: 500px; height: 200px; font-family: monospace; font-size: 13px; }
      input[type=text], select { width: 300px; padding: 4px; }
      button { padding: 8px 20px; background: #1db954; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 10px; }
    </style>
    </head><body>
    <h1>📻 라디오 플레이리스트 생성기</h1>
    <p style="color:green">✅ 스포티파이 연결됨 (자동 갱신 활성화)</p>

    <div class="tabs">
      <div class="tab active" onclick="showTab('cbs')">📻 CBS 선곡표</div>
      <div class="tab" onclick="showTab('ai')">🎵 AI 추천 플리</div>
    </div>

    <div id="cbs" class="tab-content active">
      <form action="/create" method="get">
        <label>프로그램 선택:</label><br>
        <select name="program">${programOptions}</select><br><br>
        <label>시작 날짜:</label><br>
        <input type="date" name="startDate" required><br><br>
        <label>종료 날짜:</label><br>
        <input type="date" name="endDate" required><br><br>
        <label>플레이리스트 이름:</label><br>
        <input type="text" name="name" style="width:300px"><br><br>
        <button type="submit">플레이리스트 생성</button>
      </form>
    </div>

    <div id="ai" class="tab-content">
      <p>Claude가 추천한 곡 목록을 아래에 붙여넣으세요.<br>
      <small>형식: 한 줄에 하나씩 <b>곡명 - 아티스트</b> 또는 <b>아티스트 - 곡명</b></small></p>
      <textarea id="trackList" placeholder="예시:&#10;Becaus - Dave Brubeck&#10;So What - Miles Davis&#10;Take Five - Dave Brubeck"></textarea><br><br>
      <label>플레이리스트 이름:</label><br>
      <input type="text" id="aiPlaylistName" style="width:300px" placeholder="플레이리스트 이름 입력"><br><br>
      <button onclick="createAiPlaylist()">플레이리스트 생성</button>
      <div id="aiResult" style="margin-top:20px"></div>
    </div>

    <script>
      function showTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(tab).classList.add('active');
        event.target.classList.add('active');
      }

      async function createAiPlaylist() {
        const text = document.getElementById('trackList').value.trim();
        const name = document.getElementById('aiPlaylistName').value.trim() || 'AI 추천 플리';
        if (!text) { alert('곡 목록을 입력해주세요!'); return; }

        document.getElementById('aiResult').innerHTML = '⏳ 플레이리스트 생성 중...';

        const response = await fetch('/create-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackList: text, name })
        });
        const result = await response.json();

        if (result.error) {
          document.getElementById('aiResult').innerHTML = '❌ 오류: ' + result.error;
        } else {
          document.getElementById('aiResult').innerHTML =
            '✅ 완료! 플레이리스트 <b>' + result.name + '</b> 생성됐어요!<br>' +
            '추가된 곡: ' + result.added + '곡<br>' +
            (result.notFound.length > 0 ? '못 찾은 곡:<br>' + result.notFound.join('<br>') : '');
        }
      }
    </script>
    </body></html>
  `);
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
      console.log(`Rate limit! ${retryAfter/1000}초 후 재시도...`);
      await sleep(retryAfter);
      return searchTrack(title, artist);
    }
    return null;
  }
}

// AI 추천 플리 생성 엔드포인트
app.post('/create-ai', async (req, res) => {
  const { trackList, name } = req.body;

  const valid = await ensureValidToken();
  if (!valid) {
    return res.json({ error: '로그인이 필요해요' });
  }

  try {
    // 곡 목록 파싱 (곡명 - 아티스트 또는 아티스트 - 곡명)
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
    return res.send(`<html><head><meta charset="utf-8"></head><body><p>로그인이 필요해요. <a href="/login">스포티파이 로그인</a></p></body></html>`);
  }

  try {
    res.write(`<html><head><meta charset="utf-8"></head><body>`);
    res.write(`<h1>📻 플레이리스트 생성 중...</h1>`);
    res.write(`<p>프로그램: ${programName}</p>`);
    res.write(`<p>날짜 범위: ${startDate} ~ ${endDate}</p>`);
    res.write(`<p>잠시 기다려주세요...</p>`);

    const dates = getDateRange(startDate, endDate);
    const allTracks = [];
    const foundDates = [];

    for (const date of dates) {
      try {
        const tracks = await getTracksForDate(program, date);
        if (tracks.length > 0) {
          allTracks.push(...tracks);
          foundDates.push(date);
        }
      } catch(e) {
        continue;
      }
    }

    if (allTracks.length === 0) {
      res.end(`<p>❌ 해당 기간의 선곡표를 찾을 수 없어요.</p><a href="/">돌아가기</a></body></html>`);
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

    res.write(`<h2>✅ 완료!</h2>`);
    res.write(`<p>플레이리스트 <b>${playlistName} (${startDate}~${endDate})</b> 생성됐어요!</p>`);
    res.write(`<p>선곡표 찾은 날짜: ${foundDates.join(', ')}</p>`);
    res.write(`<p>총 곡 수: ${unique.length}곡 / 추가된 곡: ${uris.length}곡</p>`);
    if (notFound.length > 0) {
      res.write(`<p>스포티파이에서 못 찾은 곡:<br>${notFound.join('<br>')}</p>`);
    }
    res.end(`<a href="/">돌아가기</a></body></html>`);

  } catch (e) {
    res.end(`<p>오류 발생: ${e.message}</p><a href="/">돌아가기</a></body></html>`);
  }
});

app.listen(process.env.PORT || PORT, '0.0.0.0', () => {
  console.log(`서버 시작! 브라우저에서 http://127.0.0.1:8888 열어주세요`);
});