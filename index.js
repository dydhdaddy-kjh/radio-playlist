const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 8888;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

let accessToken = null;
let refreshToken = null;
let tokenExpiry = null;

// CBS 프로그램 목록
const PROGRAMS = {
  'cbs_P000218': '그대와 여는 아침 (김용신)',
  'cbs_P000219': '한동준의 FM POPS',
  'cbs_P000221': '허윤희의 꿈과 음악사이에',
  'cbs_P000011': '김현주의 행복한 동행',
  'cbs_P000223': '박승화의 가요속으로',
};

// 토큰 자동 갱신
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
    <html><head><meta charset="utf-8"></head><body>
    <h1>📻 CBS 라디오 플레이리스트 생성기</h1>
    <p style="color:green">✅ 스포티파이 연결됨 (자동 갱신 활성화)</p>
    <form action="/create" method="get">
      <label>프로그램 선택:</label><br>
      <select name="program" style="width:300px; padding:4px; margin-bottom:12px">
        ${programOptions}
      </select><br><br>
      <label>시작 날짜:</label><br>
      <input type="date" name="startDate" required><br><br>
      <label>종료 날짜:</label><br>
      <input type="date" name="endDate" required><br><br>
      <label>플레이리스트 이름:</label><br>
      <input type="text" name="name" style="width:300px"><br><br>
      <button type="submit">플레이리스트 생성</button>
    </form>
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
    const time = $(el).find('span').first().text().trim();
    const spans = $(el).find('span');
    let artist = '';
    spans.each((j, span) => {
      const t = $(span).text().trim();
      if (t && t !== time && t !== title) artist = t;
    });
    if (title && !title.includes('배너') && !title.includes('banner')) {
      tracks.push({ title, artist });
    }
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
    return null;
  }
}

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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`서버 시작! 브라우저에서 http://127.0.0.1:8888 열어주세요`);
});