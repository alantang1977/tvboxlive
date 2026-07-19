const host = 'https://www.xiaohongshu.com';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://www.xiaohongshu.com/'
};

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

// 获取所有比赛数据 - 带调试信息
async function getAllMatches() {
    const url = host + '/worldcup26/fixtures?wcup_source=web_main_venue_page&wcup_tab=calendar&wcup_redirect=home';

    try {
        const r = await req(url, { headers });

        if (!r || !r.content) {
            return { error: '请求fixtures页面失败', matches: [] };
        }

        const state = extractState(r.content);

        if (!state) {
            return { error: '解析window.__INITIAL_STATE__失败', matches: [] };
        }

        // 检查数据结构
        if (!state.worldCupMatch) {
            return { error: 'state中无worldCupMatch字段', state: Object.keys(state), matches: [] };
        }

        const worldCupMatch = state.worldCupMatch;

        // 检查可能的字段名
        const possibleKeys = ['matches', 'matchList', 'fixtureList', 'scheduleList', 'gameList'];
        let foundKey = null;
        let matches = [];

        for (const key of possibleKeys) {
            if (worldCupMatch[key] && Array.isArray(worldCupMatch[key]) && worldCupMatch[key].length > 0) {
                foundKey = key;
                matches = worldCupMatch[key];
                break;
            }
        }

        if (!foundKey) {
            return { 
                error: '未找到比赛数组', 
                availableKeys: Object.keys(worldCupMatch),
                matches: [] 
            };
        }

        // 提取比赛数据
        const allMatches = [];
        for (const match of matches) {
            if (match && match.matchId) {
                allMatches.push({
                    matchId: match.matchId,
                    homeTeam: match.homeTeamName || match.homeTeam || '未知',
                    awayTeam: match.awayTeamName || match.awayTeam || '未知',
                    homeScore: match.homeScore || '0',
                    awayScore: match.awayScore || '0',
                    homeLogo: match.homeTeamLogo || match.homeLogo || '',
                    status: match.statusDesc || match.status || '',
                    round: match.roundStage || match.round || '',
                    time: match.matchTime || match.time || ''
                });
            }
        }

        return { 
            foundKey: foundKey,
            total: allMatches.length,
            matches: allMatches 
        };

    } catch(e) {
        return { error: '异常: ' + e.message, matches: [] };
    }
}

// 获取单场比赛视频
async function getMatchVideos(matchId) {
    const matchUrl = host + '/worldcup26/match/' + matchId + '?wcup_source=web_main_venue_page';
    try {
        const r = await req(matchUrl, { headers });
        if (!r || !r.content) return null;

        const state = extractState(r.content);
        if (!state) return null;

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        return {
            homeTeam: matchBase.homeTeamName || '未知',
            awayTeam: matchBase.awayTeamName || '未知',
            homeScore: matchBase.homeScore || '0',
            awayScore: matchBase.awayScore || '0',
            homeLogo: matchBase.homeTeamLogo || '',
            status: matchBase.statusDesc || '',
            replayNoteId: matchBase.liveInfo?.replayNoteId || null,
            replayXsecToken: matchBase.liveInfo?.xsecToken || '',
            reportList: matchInfo.reportList || [],
            highList: matchInfo.highList || []
        };
    } catch(e) {
        return null;
    }
}

// 从笔记提取720P视频
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

        // media.stream
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

        // mediaV2
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

        allStreams = allStreams.filter(s => s.url && s.url.indexOf('http') === 0);

        const seen = new Set();
        allStreams = allStreams.filter(s => {
            const base = s.url.split('?')[0];
            if (seen.has(base)) return false;
            seen.add(base);
            return true;
        });

        let target720 = allStreams.find(s => s.width === 1280 && s.height === 720);
        if (target720) return target720.url;

        let near720 = allStreams.filter(s => s.height >= 600 && s.height <= 900);
        if (near720.length > 0) {
            near720.sort((a, b) => b.height - a.height);
            return near720[0].url;
        }

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

async function homeVod() {
    // 获取比赛数据
    const result = await getAllMatches();

    if (result.error) {
        // 返回错误信息作为调试
        return JSON.stringify({
            list: [{
                vod_id: 'error',
                vod_name: '错误: ' + result.error,
                vod_pic: '',
                vod_remarks: '',
                vod_content: '可用字段: ' + (result.availableKeys ? result.availableKeys.join(', ') : '无') + 
                            '\n找到字段: ' + (result.foundKey || '无') +
                            '\n总数: ' + (result.total || 0)
            }]
        });
    }

    const matches = result.matches || [];

    if (matches.length === 0) {
        return JSON.stringify({
            list: [{
                vod_id: 'empty',
                vod_name: '无比赛数据',
                vod_pic: '',
                vod_remarks: '',
                vod_content: '未找到任何比赛'
            }]
        });
    }

    const videos = matches.map(match => ({
        vod_id: match.matchId + '#all',
        vod_name: match.homeTeam + ' vs ' + match.awayTeam,
        vod_pic: match.homeLogo || 'https://via.placeholder.com/300x400?text=' + encodeURIComponent(match.homeTeam),
        vod_remarks: match.status + ' | ' + match.homeScore + '-' + match.awayScore,
        vod_content: match.round + ' ' + match.time
    }));

    return JSON.stringify({ list: videos });
}

async function category(tid, pg, filter, extend) {
    const result = await getAllMatches();

    if (result.error || !result.matches || result.matches.length === 0) {
        return JSON.stringify({
            list: [{
                vod_id: 'error',
                vod_name: '获取失败: ' + (result.error || '无数据'),
                vod_pic: '',
                vod_remarks: '',
                vod_content: '请检查网络'
            }]
        });
    }

    const category = tid || 'all';
    const matches = result.matches;

    const videos = matches.map(match => ({
        vod_id: match.matchId + '#' + category,
        vod_name: match.homeTeam + ' vs ' + match.awayTeam,
        vod_pic: match.homeLogo || 'https://via.placeholder.com/300x400?text=' + encodeURIComponent(match.homeTeam),
        vod_remarks: match.status + ' | ' + match.homeScore + '-' + match.awayScore,
        vod_content: match.round + ' ' + match.time
    }));

    return JSON.stringify({ list: videos });
}

async function detail(ids) {
    const idParts = ids[0].split('#');
    const matchId = idParts[0];
    const category = idParts[1] || 'all';

    if (matchId === 'error' || matchId === 'empty') {
        return JSON.stringify({
            list: [{
                vod_id: ids[0],
                vod_name: '无效ID',
                vod_pic: '',
                vod_remarks: '',
                vod_content: '请选择有效比赛',
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }

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

    if (category === 'replay' || category === 'all') {
        if (matchData.replayNoteId) {
            const videoUrl = await getNoteVideo720P(matchData.replayNoteId, matchData.replayXsecToken);
            if (videoUrl) videos.push('全场回放$' + videoUrl);
        }
    }

    if (category === 'highlight' || category === 'all') {
        for (let i = 0; i < matchData.reportList.length; i++) {
            const item = matchData.reportList[i];
            if (item.noteId && item.type === 'video' && item.title && item.title.indexOf('集锦') !== -1) {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) videos.push((item.title || '集锦' + (i + 1)) + '$' + videoUrl);
            }
        }
    }

    if (category === 'report' || category === 'all') {
        for (let i = 0; i < matchData.reportList.length; i++) {
            const item = matchData.reportList[i];
            if (item.noteId && item.type === 'video' && (!item.title || item.title.indexOf('集锦') === -1)) {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) videos.push((item.title || '战报' + (i + 1)) + '$' + videoUrl);
            }
        }
    }

    if (category === 'high' || category === 'all') {
        for (let i = 0; i < matchData.highList.length; i++) {
            const item = matchData.highList[i];
            if (item.noteId && item.type === 'video') {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) videos.push((item.title || '高光' + (i + 1)) + '$' + videoUrl);
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
