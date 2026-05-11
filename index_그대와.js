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
      <h1>📻 CBS 그대와 여는 아침 플레이리스트 생성기</h1>
      <a href="/login">스포티파이 로그인</a>
      </body></html>
    `);
  }
  res.send(`
    <html><head><meta charset="utf-8"></head><body>
    <h1>📻 CBS 그대와 여는 아침 플레이리스트 생성기</h1>
    <form action="/create" method="get">
      <label>시작 날짜:</label><br>
      <input type="date" name="startDate" required><br><br>
      <label>종료 날짜:</label><br>
      <input type="date" name="endDate" required><br><br>
      <label>플레이리스트 이름:</label><br>
      <input type="text" name="name" value="그대와 여는 아침" style="width:300px"><br><br>
      <button type="submit">플레이리스트 생성</button>
    </form>
    </body></html>
  `);
});

// 날짜 범위의 모든 날짜 배열 생성
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

// 특정 날짜 선곡표 가져오기
async function getTracksForDate(date) {
  const url = `https://www.cbs.co.kr/program/playlist/cbs_P000218?date=${date}`;
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

// 스포티파이에서 곡 검색
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
  const { startDate, endDate, name } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  try {
    res.write(`<html><head><meta charset="utf-8"></head><body>`);
    res.write(`<h1>📻 플레이리스트 생성 중...</h1>`);
    res.write(`<p>날짜 범위: ${startDate} ~ ${endDate}</p>`);
    res.write(`<p>잠시 기다려주세요...</p>`);

    const dates = getDateRange(startDate, endDate);
    const allTracks = [];
    const foundDates = [];

    for (const date of dates) {
      try {
        const tracks = await getTracksForDate(date);
        if (tracks.length > 0) {
          allTracks.push(...tracks);
          foundDates.push(date);
        }
      } catch(e) {
        // 해당 날짜 선곡표 없으면 스킵
      }
    }

    if (allTracks.length === 0) {
      res.end(`<p>❌ 해당 기간의 선곡표를 찾을 수 없어요.</p><a href="/">돌아가기</a></body></html>`);
      return;
    }

    // 중복 제거
    const unique = allTracks.filter((t, i, arr) =>
      arr.findIndex(x => x.title === t.title && x.artist === t.artist) === i
    );

    // 스포티파이 곡 검색
    const uris = [];
    const notFound = [];
    for (const track of unique) {
      const uri = await searchTrack(track.title, track.artist);
      if (uri) uris.push(uri);
      else notFound.push(`${track.title} - ${track.artist}`);
    }

    // 플레이리스트 생성
    const plRes = await axios.post('https://api.spotify.com/v1/me/playlists',
      { name: `${name} (${startDate}~${endDate})`, public: true },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    const playlistId = plRes.data.id;

    // 100곡씩 나눠서 추가
    for (let i = 0; i < uris.length; i += 100) {
      await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/items`,
        { uris: uris.slice(i, i + 100) },
        { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
    }

    res.write(`<h2>✅ 완료!</h2>`);
    res.write(`<p>플레이리스트 <b>${name} (${startDate}~${endDate})</b> 생성됐어요!</p>`);
    res.write(`<p>선곡표 찾은 날짜: ${foundDates.join(', ')}</p>`);
    res.write(`<p>총 곡 수: ${unique.length}곡 / 스포티파이에 추가된 곡: ${uris.length}곡</p>`);
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