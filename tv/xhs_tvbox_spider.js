const host = 'https://www.xiaohongshu.com';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://www.xiaohongshu.com/'
};

function extractState(html) {
    if (html.indexOf('window.__INITIAL_STATE__') === -1) return null;
    let match = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({.+?})<\/script>/s);
    if (!match) match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*<\/script>/s);
    if (!match) return null;
    let jsonStr = match[1];
    jsonStr = jsonStr.replace(/(?<=[:\[,\s])(undefined)(?=[\s:,\}\]])/g, 'null');
    jsonStr = jsonStr.replace(/NaN/g, 'null');
    try { return JSON.parse(jsonStr); } catch(e) { return null; }
}

async function init(cfg) {}

async function home(filter) {
    return JSON.stringify({
        class: [
            { type_id: 'all', type_name: '全部比赛' },
            { type_id: 'group', type_name: '小组赛' },
            { type_id: 'knockout', type_name: '淘汰赛' },
            { type_id: 'final', type_name: '决赛' }
        ]
    });
}

async function homeVod() {
    const url = host + '/worldcup26';
    const r = await req(url, { headers });
    if (!r.content) return JSON.stringify({ list: [] });

    const state = extractState(r.content);
    if (!state) return JSON.stringify({ list: [] });

    const matches = state.worldCupMatch?.matches || [];
    const videos = matches.map(match => ({
        vod_id: match.matchId || '',
        vod_name: (match.homeTeamName || '') + ' vs ' + (match.awayTeamName || ''),
        vod_pic: match.homeTeamLogo || '',
        vod_remarks: (match.statusDesc || '') + ' | ' + (match.homeScore || '0') + '-' + (match.awayScore || '0'),
        vod_content: (match.roundStage || '') + ' ' + (match.matchTime || '')
    }));

    return JSON.stringify({ list: videos });
}

async function category(tid, pg, filter, extend) {
    return homeVod();
}

async function detail(id) {
    const matchUrl = host + '/worldcup26/match/' + id + '?wcup_source=web_main_venue_page';
    const r = await req(matchUrl, { headers });
    if (!r.content) return JSON.stringify({ list: [] });

    const state = extractState(r.content);
    if (!state) return JSON.stringify({ list: [] });

    const matchBase = state.worldCupMatch?.matchBase || {};
    const matchInfo = state.worldCupMatch?.matchInfo || {};

    const homeTeam = matchBase.homeTeamName || '';
    const awayTeam = matchBase.awayTeamName || '';
    const homeScore = matchBase.homeScore || '0';
    const awayScore = matchBase.awayScore || '0';

    // 简化处理：只收集官方回放
    const videos = [];
    const liveInfo = matchBase.liveInfo || {};
    if (liveInfo.replayNoteId) {
        videos.push('官方全场回放$' + liveInfo.replayNoteId);
    }

    // reportList
    const reportList = matchInfo.reportList || [];
    for (let i = 0; i < reportList.length; i++) {
        const item = reportList[i];
        if (item.noteId && item.type === 'video') {
            videos.push((item.title || '战报' + (i + 1)) + '$' + item.noteId);
        }
    }

    // highList
    const highList = matchInfo.highList || [];
    for (let i = 0; i < highList.length; i++) {
        const item = highList[i];
        if (item.noteId && item.type === 'video') {
            videos.push((item.title || '高光' + (i + 1)) + '$' + item.noteId);
        }
    }

    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: homeTeam + ' vs ' + awayTeam,
            vod_pic: matchBase.homeTeamLogo || '',
            vod_remarks: matchBase.statusDesc || '',
            vod_content: homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam,
            vod_play_from: '小红书',
            vod_play_url: videos.join('#')
        }]
    });
}

async function search(wd, quick, pg) {
    return JSON.stringify({ page: pg, list: [] });
}

async function play(flag, id, flags) {
    // id 是笔记ID，需要获取真实视频地址
    // 这里简化处理，直接返回笔记ID（实际需要获取视频流）
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
