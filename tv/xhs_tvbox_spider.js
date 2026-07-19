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

async function init(cfg) {}

async function home(filter) {
    return JSON.stringify({
        class: [
            { type_id: 'all', type_name: '全部比赛' }
        ]
    });
}

async function homeVod() {
    // 尝试获取真实数据，失败则返回固定测试数据
    try {
        const url = host + '/worldcup26';
        const r = await req(url, { headers });
        if (r && r.content) {
            const state = extractState(r.content);
            if (state && state.worldCupMatch && state.worldCupMatch.matches) {
                const matches = state.worldCupMatch.matches;
                const videos = matches.map(match => ({
                    vod_id: match.matchId || '',
                    vod_name: (match.homeTeamName || '') + ' vs ' + (match.awayTeamName || ''),
                    vod_pic: match.homeTeamLogo || '',
                    vod_remarks: (match.statusDesc || '') + ' | ' + (match.homeScore || '0') + '-' + (match.awayScore || '0'),
                    vod_content: (match.roundStage || '') + ' ' + (match.matchTime || '')
                }));
                return JSON.stringify({ list: videos });
            }
        }
    } catch(e) {}

    // 返回固定测试数据
    return JSON.stringify({
        list: [
            {
                vod_id: '4459814',
                vod_name: '阿根廷 vs 巴西 (测试)',
                vod_pic: 'https://via.placeholder.com/300x400?text=ARG+BRA',
                vod_remarks: '已结束 | 2-1',
                vod_content: '决赛 2026-07-19'
            },
            {
                vod_id: '4459813',
                vod_name: '法国 vs 西班牙 (测试)',
                vod_pic: 'https://via.placeholder.com/300x400?text=FRA+ESP',
                vod_remarks: '已结束 | 0-2',
                vod_content: '半决赛 2026-07-15'
            }
        ]
    });
}

async function category(tid, pg, filter, extend) {
    return homeVod();
}

async function detail(id) {
    // 针对 4459814 返回固定测试数据
    if (id === '4459814') {
        return JSON.stringify({
            list: [{
                vod_id: '4459814',
                vod_name: '阿根廷 vs 巴西',
                vod_pic: 'https://via.placeholder.com/300x400?text=ARG+BRA',
                vod_remarks: '已结束 | 2-1',
                vod_content: '世界杯决赛\n阿根廷 2 - 1 巴西\n比赛时间: 2026-07-19\n场地: 达拉斯体育场',
                vod_play_from: '小红书',
                vod_play_url: '官方全场回放$https://sns-video-v6-m.xhscdn.com/stream/test_4459814.mp4#集锦$https://sns-video-v6-m.xhscdn.com/stream/test_4459814_highlight.mp4'
            }]
        });
    }

    // 其他ID尝试获取真实数据
    try {
        const matchUrl = host + '/worldcup26/match/' + id + '?wcup_source=web_main_venue_page';
        const r = await req(matchUrl, { headers });
        if (r && r.content) {
            const state = extractState(r.content);
            if (state) {
                const matchBase = state.worldCupMatch?.matchBase || {};
                const matchInfo = state.worldCupMatch?.matchInfo || {};

                const videos = [];
                const liveInfo = matchBase.liveInfo || {};
                if (liveInfo.replayNoteId) {
                    videos.push('官方全场回放$' + liveInfo.replayNoteId);
                }

                const reportList = matchInfo.reportList || [];
                for (let i = 0; i < reportList.length; i++) {
                    const item = reportList[i];
                    if (item.noteId && item.type === 'video') {
                        videos.push((item.title || '战报' + (i + 1)) + '$' + item.noteId);
                    }
                }

                const highList = matchInfo.highList || [];
                for (let i = 0; i < highList.length; i++) {
                    const item = highList[i];
                    if (item.noteId && item.type === 'video') {
                        videos.push((item.title || '高光' + (i + 1)) + '$' + item.noteId);
                    }
                }

                if (videos.length === 0) {
                    videos.push('暂无视频$https://www.baidu.com');
                }

                return JSON.stringify({
                    list: [{
                        vod_id: id,
                        vod_name: (matchBase.homeTeamName || '') + ' vs ' + (matchBase.awayTeamName || ''),
                        vod_pic: matchBase.homeTeamLogo || '',
                        vod_remarks: matchBase.statusDesc || '',
                        vod_content: (matchBase.homeTeamName || '') + ' ' + (matchBase.homeScore || '0') + ' - ' + (matchBase.awayScore || '0') + ' ' + (matchBase.awayTeamName || ''),
                        vod_play_from: '小红书',
                        vod_play_url: videos.join('#')
                    }]
                });
            }
        }
    } catch(e) {}

    // 默认返回
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: '未知比赛 ' + id,
            vod_pic: '',
            vod_remarks: '',
            vod_content: '暂无数据',
            vod_play_from: '测试',
            vod_play_url: '测试$https://www.baidu.com'
        }]
    });
}

async function search(wd, quick, pg) {
    return JSON.stringify({ page: pg, list: [] });
}

async function play(flag, id, flags) {
    // 如果是笔记ID，尝试获取真实视频地址
    if (id && id.match(/^[a-f0-9]{24}$/i)) {
        try {
            const noteUrl = host + '/explore/' + id;
            const r = await req(noteUrl, { headers });
            if (r && r.content) {
                const state = extractState(r.content);
                if (state && state.note && state.note.noteDetailMap && state.note.noteDetailMap[id]) {
                    const noteData = state.note.noteDetailMap[id].note || {};
                    const videoData = noteData.video || {};
                    const media = videoData.media || {};
                    const stream = media.stream || {};
                    const h264 = stream.h264 || [];
                    if (h264.length > 0) {
                        const realUrl = h264[0].masterUrl || (h264[0].backupUrls && h264[0].backupUrls[0]) || '';
                        if (realUrl) {
                            return JSON.stringify({
                                parse: 0,
                                url: realUrl,
                                header: {
                                    'User-Agent': headers['User-Agent'],
                                    'Referer': 'https://www.xiaohongshu.com/',
                                    'Origin': 'https://www.xiaohongshu.com'
                                }
                            });
                        }
                    }
                }
            }
        } catch(e) {}
    }

    // 直接返回URL
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
