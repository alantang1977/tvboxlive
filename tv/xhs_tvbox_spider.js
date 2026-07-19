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

// 获取所有比赛数据
async function getAllMatches() {
    try {
        const url = host + '/worldcup26';
        const r = await req(url, { headers });
        if (!r || !r.content) return [];

        const state = extractState(r.content);
        if (!state || !state.worldCupMatch) return [];

        const matches = state.worldCupMatch.matches || [];
        return matches.map(match => ({
            matchId: match.matchId || '',
            homeTeam: match.homeTeamName || '',
            awayTeam: match.awayTeamName || '',
            homeScore: match.homeScore || '0',
            awayScore: match.awayScore || '0',
            homeLogo: match.homeTeamLogo || '',
            status: match.statusDesc || '',
            round: match.roundStage || '',
            time: match.matchTime || ''
        })).filter(m => m.matchId);
    } catch(e) {
        return [];
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

        // 优先720P
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

// 一级目录：4个分类
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

// 首页视频列表（默认显示）
async function homeVod() {
    const matches = await getAllMatches();

    const list = matches.map(match => ({
        vod_id: match.matchId,
        vod_name: match.homeTeam + ' vs ' + match.awayTeam,
        vod_pic: match.homeLogo || 'https://via.placeholder.com/300x400?text=' + encodeURIComponent(match.homeTeam),
        vod_remarks: match.status + ' | ' + match.homeScore + '-' + match.awayScore,
        vod_content: match.round + ' ' + match.time
    }));

    return JSON.stringify({
        page: 1,
        pagecount: 1,
        limit: 100,
        total: list.length,
        list: list
    });
}

// 分类内容：点击分类后显示比赛列表
async function category(tid, pg, filter, extend) {
    const matches = await getAllMatches();

    const list = matches.map(match => ({
        vod_id: match.matchId + '#' + tid,  // 带分类标记
        vod_name: match.homeTeam + ' vs ' + match.awayTeam,
        vod_pic: match.homeLogo || 'https://via.placeholder.com/300x400?text=' + encodeURIComponent(match.homeTeam),
        vod_remarks: match.status + ' | ' + match.homeScore + '-' + match.awayScore,
        vod_content: match.round + ' ' + match.time
    }));

    return JSON.stringify({
        page: parseInt(pg) || 1,
        pagecount: 1,
        limit: 100,
        total: list.length,
        list: list
    });
}

// 详情页
async function detail(ids) {
    const idParts = ids[0].split('#');
    const matchId = idParts[0];
    const category = idParts[1] || 'all';

    const matchUrl = host + '/worldcup26/match/' + matchId + '?wcup_source=web_main_venue_page';

    try {
        const r = await req(matchUrl, { headers });
        if (!r || !r.content) {
            return JSON.stringify({ list: [] });
        }

        const state = extractState(r.content);
        if (!state) {
            return JSON.stringify({ list: [] });
        }

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        const homeTeam = matchBase.homeTeamName || '未知';
        const awayTeam = matchBase.awayTeamName || '未知';

        const videos = [];

        // 根据分类提取视频
        if (category === 'replay' || category === 'all') {
            const replayNoteId = matchBase.liveInfo?.replayNoteId;
            if (replayNoteId) {
                const videoUrl = await getNoteVideo720P(replayNoteId, matchBase.liveInfo?.xsecToken || '');
                if (videoUrl) videos.push('全场回放$' + videoUrl);
            }
        }

        if (category === 'highlight' || category === 'all') {
            const reportList = matchInfo.reportList || [];
            for (let i = 0; i < reportList.length; i++) {
                const item = reportList[i];
                if (item.noteId && item.type === 'video' && item.title && item.title.indexOf('集锦') !== -1) {
                    const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                    if (videoUrl) videos.push((item.title || '集锦') + '$' + videoUrl);
                }
            }
        }

        if (category === 'report' || category === 'all') {
            const reportList = matchInfo.reportList || [];
            for (let i = 0; i < reportList.length; i++) {
                const item = reportList[i];
                if (item.noteId && item.type === 'video' && (!item.title || item.title.indexOf('集锦') === -1)) {
                    const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                    if (videoUrl) videos.push((item.title || '战报') + '$' + videoUrl);
                }
            }
        }

        if (category === 'high' || category === 'all') {
            const highList = matchInfo.highList || [];
            for (let i = 0; i < highList.length; i++) {
                const item = highList[i];
                if (item.noteId && item.type === 'video') {
                    const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                    if (videoUrl) videos.push((item.title || '高光') + '$' + videoUrl);
                }
            }
        }

        if (videos.length === 0) {
            videos.push('暂无视频$https://www.baidu.com');
        }

        return JSON.stringify({
            list: [{
                vod_id: ids[0],
                vod_name: homeTeam + ' vs ' + awayTeam,
                vod_pic: matchBase.homeTeamLogo || '',
                vod_remarks: matchBase.statusDesc || '',
                vod_content: homeTeam + ' ' + (matchBase.homeScore || '0') + ' - ' + (matchBase.awayScore || '0') + ' ' + awayTeam,
                vod_play_from: '小红书',
                vod_play_url: videos.join('#')
            }]
        });

    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

async function search(wd, quick, pg) {
    return JSON.stringify({ page: pg || 1, pagecount: 1, list: [] });
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
