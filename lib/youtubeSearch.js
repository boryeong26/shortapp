// Searches YouTube for videos matching a query, for a curation/discovery
// tool that only links out to YouTube (never downloads or re-hosts
// anything) — so, unlike the earlier clip-compilation version of this
// app, there's no need to restrict results to Creative Commons-licensed
// videos. Linking to and embedding a normal YouTube video is standard,
// within YouTube's own terms.
//
// Uses the YouTube Data API v3 (requires YOUTUBE_API_KEY):
// - search.list to find candidates matching a query
// - videos.list to get duration for those candidates (search.list alone
//   doesn't return it)

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const MAX_RESULTS = 12;

function parseIso8601Duration(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

async function searchVideos(query, options = {}) {
  const apiKey = options.apiKey || process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY 환경변수가 설정되어 있지 않습니다.');
  }
  if (!query || !query.trim()) {
    throw new Error('검색어가 필요합니다.');
  }

  const searchUrl = new URL(`${YOUTUBE_API_BASE}/search`);
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('safeSearch', 'strict');
  searchUrl.searchParams.set('relevanceLanguage', options.relevanceLanguage || 'ko');
  searchUrl.searchParams.set('maxResults', String(options.maxResults || MAX_RESULTS));
  searchUrl.searchParams.set('q', query.trim());
  searchUrl.searchParams.set('key', apiKey);

  const searchRes = await fetch(searchUrl.toString());
  const searchData = await searchRes.json().catch(() => null);
  if (!searchRes.ok || !searchData) {
    const message = searchData && searchData.error ? searchData.error.message : searchRes.statusText;
    throw new Error(`YouTube 검색 실패: ${message}`);
  }

  const videoIds = (searchData.items || [])
    .map((item) => item.id && item.id.videoId)
    .filter(Boolean);

  if (videoIds.length === 0) {
    return [];
  }

  const detailsUrl = new URL(`${YOUTUBE_API_BASE}/videos`);
  detailsUrl.searchParams.set('part', 'contentDetails,snippet');
  detailsUrl.searchParams.set('id', videoIds.join(','));
  detailsUrl.searchParams.set('key', apiKey);

  const detailsRes = await fetch(detailsUrl.toString());
  const detailsData = await detailsRes.json().catch(() => null);
  if (!detailsRes.ok || !detailsData) {
    const message = detailsData && detailsData.error ? detailsData.error.message : detailsRes.statusText;
    throw new Error(`YouTube 영상 상세 조회 실패: ${message}`);
  }

  return (detailsData.items || []).map((item) => {
    const durationSeconds = parseIso8601Duration(item.contentDetails && item.contentDetails.duration);
    const thumbnails = (item.snippet && item.snippet.thumbnails) || {};
    const thumbnail = (thumbnails.medium || thumbnails.default || {}).url || '';
    return {
      videoId: item.id,
      title: (item.snippet && item.snippet.title) || '',
      channelTitle: (item.snippet && item.snippet.channelTitle) || '',
      channelId: (item.snippet && item.snippet.channelId) || '',
      description: ((item.snippet && item.snippet.description) || '').slice(0, 300),
      thumbnail,
      durationSeconds,
      url: `https://www.youtube.com/watch?v=${item.id}`
    };
  });
}

module.exports = { searchVideos, parseIso8601Duration };
