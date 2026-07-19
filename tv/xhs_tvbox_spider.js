const host = 'https://www.xiaohongshu.com';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://www.xiaohongshu.com/'
};

// 缓存比赛数据
let matchesCache = null;
let cacheTime = 0;
const CACHE_TTL = 300000; // 5分钟缓存

function extractState(html) {
    if (!html || html.indexOf('window.__INITIAL_STATE__') === -1) return null;
    let match = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({.+?})<\/script>/s);
    if (!match) match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*<\/script>/s);
    if (!match) return null;
    let jsonStr = match[1];
    jsonStr = jsonStr.replace(/(?<=[:\[,\s])(undefined)(?=[\s:,\}\]])/g, 'null');
    jsonStr = jsonStr.replace(/NaN/g, 'null');
    try { return JSON.parse(jsonStr); } catch(e) { return null; }
}

// 获取所有比赛数据
async function getAllMatches() {
    const now = Date.now();
    if (matchesCache && (now - cacheTime) < CACHE_TTL) {
        return matchesCache;
    }

    const url = host + '/worldcup26/fixtures?wcup_source=web_main_venue_page&wcup_tab=calendar&wcup_redirect=home';
    const r = await req(url, { headers });
    if (!r || !r.content) return [];

    const state = extractState(r.content);
    if (!state || !state.worldCupMatch) return [];

    // 提取比赛数据
    const matches = state.worldCupMatch.matches || [];
    const matchList = state.worldCupMatch.matchList || [];

    // 合并数据
    const allMatches = [];

    // 从 matches 提取
    for (const match of matches) {
        if (match.matchId) {
            allMatches.push({
                matchId: match.matchId,
                homeTeam: match.homeTeamName || '',
                awayTeam: match.awayTeamName || '',
                homeScore: match.homeScore || '0',
                awayScore: match.awayScore || '0',
                homeLogo: match.homeTeamLogo || '',
                awayLogo: match.awayTeamLogo || '',
                status: match.statusDesc || '',
                round: match.roundStage || '',
                time: match.matchTime || '',
                venue: match.venue || ''
            });
        }
    }

    // 从 matchList 补充（如果有）
    if (matchList && Array.isArray(matchList)) {
        for (const match of matchList) {
            if (match.matchId && !allMatches.find(m => m.matchId === match.matchId)) {
                allMatches.push({
                    matchId: match.matchId,
                    homeTeam: match.homeTeamName || '',
                    awayTeam: match.awayTeamName || '',
                    homeScore: match.homeScore || '0',
                    awayScore: match.awayScore || '0',
                    homeLogo: match.homeTeamLogo || '',
                    awayLogo: match.awayTeamLogo || '',
                    status: match.statusDesc || '',
                    round: match.roundStage || '',
                    time: match.matchTime || '',
                    venue: match.venue || ''
                });
            }
        }
    }

    matchesCache = allMatches;
    cacheTime = now;
    return allMatches;
}

// 获取单场比赛的视频数据
async function getMatchVideos(matchId) {
    const matchUrl = host + '/worldcup26/match/' + matchId + '?wcup_source=web_main_venue_page';
    const r = await req(matchUrl, { headers });
    if (!r || !r.content) return null;

    const state = extractState(r.content);
    if (!state) return null;

    const matchBase = state.worldCupMatch?.matchBase || {};
    const matchInfo = state.worldCupMatch?.matchInfo || {};

    return {
        matchBase: matchBase,
        matchInfo: matchInfo,
        homeTeam: matchBase.homeTeamName || '未知',
        awayTeam: matchBase.awayTeamName || '未知',
        homeScore: matchBase.homeScore || '0',
        awayScore: matchBase.awayScore || '0',
        homeLogo: matchBase.homeTeamLogo || '',
        status: matchBase.statusDesc || '',
        // 各类视频列表
        replayNoteId: matchBase.liveInfo?.replayNoteId || null,
        replayXsecToken: matchBase.liveInfo?.xsecToken || '',
        reportList: matchInfo.reportList || [],
        highList: matchInfo.highList || []
    };
}

// 从笔记页面提取720P视频流
async function getNoteVideo720P(noteId, xsecToken) {
    let noteUrl = host + '/explore/' + noteId;
    if (xsecToken) {
        noteUrl += '?xsec_token=' + encodeURIComponent(xsecToken) + '&xsec_source=pc_stab';
    }

    try {
        const r = await req(noteUrl, { headers });
        if (!r || !r.content) return null;

        const state = extractState(r.content);
        if (!state) return null;

        const noteData = state.note?.noteDetailMap?.[noteId]?.note || {};
        const videoData = noteData.video || {};

        let allStreams = [];

        // 1. 从 media.stream 提取
        const media = videoData.media || {};
        const stream = media.stream || {};
        const codecs = ['h264', 'h265', 'av1'];

        for (const codec of codecs) {
            if (stream[codec] && Array.isArray(stream[codec])) {
                for (const s of stream[codec]) {
                    allStreams.push({
                        url: s.masterUrl || (s.backupUrls && s.backupUrls[0]) || '',
                        width: s.width || 0,
                        height: s.height || 0
                    });
                }
            }
        }

        // 2. 从 mediaV2 提取
        const mediaV2Str = videoData.mediaV2 || '';
        if (typeof mediaV2Str === 'string' && mediaV2Str.length > 0) {
            try {
                const mediaV2 = JSON.parse(mediaV2Str);
                if (mediaV2 && mediaV2.video && mediaV2.video.stream) {
                    const streamV2 = mediaV2.video.stream;
                    for (const codec of codecs) {
                        if (streamV2[codec] && Array.isArray(streamV2[codec])) {
                            for (const s of streamV2[codec]) {
                                allStreams.push({
                                    url: s.master_url || (s.backup_urls && s.backup_urls[0]) || '',
                                    width: s.width || 0,
                                    height: s.height || 0
                                });
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        // 过滤有效URL
        allStreams = allStreams.filter(s => s.url && s.url.indexOf('http') === 0);

        // 去重
        const seen = new Set();
        allStreams = allStreams.filter(s => {
            const base = s.url.split('?')[0];
            if (seen.has(base)) return false;
            seen.add(base);
            return true;
        });

        // 优先选择720P (1280x720)
        let target720 = allStreams.find(s => s.width === 1280 && s.height === 720);
        if (target720) return target720.url;

        // 如果没有精确720P，找接近的 (高度在 600-900 之间)
        let near720 = allStreams.filter(s => s.height >= 600 && s.height <= 900);
        if (near720.length > 0) {
            near720.sort((a, b) => b.height - a.height);
            return near720[0].url;
        }

        // 如果没有720P，返回最低清晰度
        if (allStreams.length > 0) {
            allStreams.sort((a, b) => (a.width * a.height) - (b.width * b.height));
            return allStreams[0].url;
        }

        return null;
    } catch(e) {
        return null;
    }
}

// ========== TVBOX 接口 ==========

async function init(cfg) {}

// 一级目录：分类
async function home(filter) {
    return JSON.stringify({
        class: [
            { type_id: 'replay', type_name: '全场回放' },
            { type_id: 'highlight', type_name: '全场集锦' },
            { type_id: 'report', type_name: '战报' },
            { type_id: 'high', type_name: '高光时刻' }
        ]
    });
}

// 二级目录：104场比赛列表
async function homeVod() {
    // 默认显示全部比赛（不分类）
    const matches = await getAllMatches();

    const videos = matches.map(match => ({
        vod_id: match.matchId + '#all',  // 添加 #all 表示全部
        vod_name: match.homeTeam + ' vs ' + match.awayTeam,
        vod_pic: match.homeLogo || 'https://via.placeholder.com/300x400?text=' + encodeURIComponent(match.homeTeam),
        vod_remarks: match.status + ' | ' + match.homeScore + '-' + match.awayScore,
        vod_content: match.round + ' ' + match.time + ' ' + match.venue
    }));

    return JSON.stringify({ list: videos });
}

// 分类内容：按 category 显示比赛
async function category(tid, pg, filter, extend) {
    const matches = await getAllMatches();
    const category = tid || 'all';

    const videos = matches.map(match => ({
        vod_id: match.matchId + '#' + category,
        vod_name: match.homeTeam + ' vs ' + match.awayTeam,
        vod_pic: match.homeLogo || 'https://via.placeholder.com/300x400?text=' + encodeURIComponent(match.homeTeam),
        vod_remarks: match.status + ' | ' + match.homeScore + '-' + match.awayScore,
        vod_content: match.round + ' ' + match.time
    }));

    return JSON.stringify({ list: videos });
}

// 详情页：根据 category 提取对应视频
async function detail(ids) {
    const idParts = ids[0].split('#');
    const matchId = idParts[0];
    const category = idParts[1] || 'all';

    // 获取比赛视频数据
    const matchData = await getMatchVideos(matchId);
    if (!matchData) {
        return JSON.stringify({
            list: [{
                vod_id: ids[0],
                vod_name: '数据获取失败',
                vod_pic: '',
                vod_remarks: '',
                vod_content: '无法获取比赛数据',
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }

    const videos = [];

    // 根据 category 提取对应视频
    if (category === 'replay' || category === 'all') {
        // 全场回放
        if (matchData.replayNoteId) {
            const videoUrl = await getNoteVideo720P(matchData.replayNoteId, matchData.replayXsecToken);
            if (videoUrl) {
                videos.push('全场回放$' + videoUrl);
            }
        }
    }

    if (category === 'highlight' || category === 'all') {
        // 全场集锦（从 reportList 中筛选标题包含"集锦"的）
        for (let i = 0; i < matchData.reportList.length; i++) {
            const item = matchData.reportList[i];
            if (item.noteId && item.type === 'video' && item.title && item.title.indexOf('集锦') !== -1) {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '集锦' + (i + 1)) + '$' + videoUrl);
                }
            }
        }
    }

    if (category === 'report' || category === 'all') {
        // 战报（从 reportList 中筛选非集锦的）
        for (let i = 0; i < matchData.reportList.length; i++) {
            const item = matchData.reportList[i];
            if (item.noteId && item.type === 'video' && (!item.title || item.title.indexOf('集锦') === -1)) {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '战报' + (i + 1)) + '$' + videoUrl);
                }
            }
        }
    }

    if (category === 'high' || category === 'all') {
        // 高光时刻
        for (let i = 0; i < matchData.highList.length; i++) {
            const item = matchData.highList[i];
            if (item.noteId && item.type === 'video') {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '高光' + (i + 1)) + '$' + videoUrl);
                }
            }
        }
    }

    if (videos.length === 0) {
        videos.push('暂无视频$https://www.baidu.com');
    }

    return JSON.stringify({
        list: [{
            vod_id: ids[0],
            vod_name: matchData.homeTeam + ' vs ' + matchData.awayTeam + ' (' + category + ')',
            vod_pic: matchData.homeLogo || '',
            vod_remarks: matchData.status || '',
            vod_content: matchData.homeTeam + ' ' + matchData.homeScore + ' - ' + matchData.awayScore + ' ' + matchData.awayTeam,
            vod_play_from: '小红书',
            vod_play_url: videos.join('#')
        }]
    });
}

async function search(wd, quick, pg) {
    return JSON.stringify({ page: pg, list: [] });
}

async function play(flag, id, flags) {
    return JSON.stringify({
        parse: 0,
        url: id,
        header: {
            'User-Agent': headers['User-Agent'],
            'Referer': 'https://www.xiaohongshu.com/',
            'Origin': 'https://www.xiaohongshu.com'
        }
    });
}

export default { init, home, homeVod, category, detail, search, play };
