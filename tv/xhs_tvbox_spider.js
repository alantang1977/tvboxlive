const host = 'https://www.xiaohongshu.com';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://www.xiaohongshu.com/'
};

// ========== 工具函数 ==========

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

        // 找接近720P的 (高度 600-900)
        let near720 = allStreams.filter(s => s.height >= 600 && s.height <= 900);
        if (near720.length > 0) {
            near720.sort((a, b) => b.height - a.height);
            return near720[0].url;
        }

        // 返回最低清晰度
        if (allStreams.length > 0) {
            allStreams.sort((a, b) => (a.width * a.height) - (b.width * b.height));
            return allStreams[0].url;
        }

        return null;
    } catch(e) {
        return null;
    }
}

// 智能分类
function getVideoCategory(title) {
    if (!title) return '其他';
    if (title.indexOf('回放') !== -1 || title.indexOf('全场') !== -1) return '全场回放';
    if (title.indexOf('集锦') !== -1) return '全场集锦';
    return '其他';
}

// ========== 缓存比赛数据 ==========
let matchCache = null;
let cacheTime = 0;

async function getMatchData() {
    const now = Date.now();
    if (matchCache && (now - cacheTime) < 300000) { // 5分钟缓存
        return matchCache;
    }

    try {
        const r = await req(host + '/worldcup26', { headers });
        if (!r || !r.content) return null;

        const state = extractState(r.content);
        if (!state || !state.worldCupMatch) return null;

        matchCache = state.worldCupMatch;
        cacheTime = now;
        return matchCache;
    } catch(e) {
        return null;
    }
}

// ========== TVBOX 接口 ==========

async function init(cfg) {}

async function home(filter) {
    return JSON.stringify({
        class: [
            { type_id: 'all', type_name: '全部比赛' }
        ]
    });
}

async function homeVod() {
    // 从 worldcup26 首页提取所有比赛
    const matchData = await getMatchData();
    if (!matchData || !matchData.matches) {
        return JSON.stringify({ list: [] });
    }

    const matches = matchData.matches;
    const list = [];

    for (const match of matches) {
        // 构建背景图 - 使用球队logo组合或默认背景
        const homeLogo = match.homeTeamLogo || '';
        const awayLogo = match.awayTeamLogo || '';

        // 使用小红书CDN的背景图（如果有）
        let bgImage = match.backgroundImage || match.coverImage || '';
        if (!bgImage && homeLogo) {
            bgImage = homeLogo; // 使用主队logo作为封面
        }

        list.push({
            vod_id: match.matchId || '',
            vod_name: (match.homeTeamName || '主队') + ' vs ' + (match.awayTeamName || '客队'),
            vod_pic: bgImage,
            vod_remarks: (match.statusDesc || '') + ' | ' + (match.homeScore || '0') + '-' + (match.awayScore || '0'),
            vod_content: (match.roundStage || '') + '\n' + 
                        (match.matchTime || '') + '\n' +
                        (match.venue || '')
        });
    }

    return JSON.stringify({ list: list });
}

async function category(tid, pg, filter, extend) {
    return homeVod();
}

async function detail(id) {
    // id 是 matchId，如 4459814
    // 获取比赛数据
    const matchData = await getMatchData();
    if (!matchData) {
        return JSON.stringify({ list: [] });
    }

    // 找到对应比赛
    const matches = matchData.matches || [];
    const targetMatch = matches.find(m => m.matchId === id);

    if (!targetMatch) {
        return JSON.stringify({ list: [] });
    }

    // 获取比赛详情页面，提取 reportList 和 highList
    const matchUrl = host + '/worldcup26/match/' + id + '?wcup_source=web_main_venue_page';

    try {
        const r = await req(matchUrl, { headers });
        if (!r || !r.content) {
            return JSON.stringify({ list: [] });
        }

        const state = extractState(r.content);
        if (!state || !state.worldCupMatch) {
            return JSON.stringify({ list: [] });
        }

        const matchBase = state.worldCupMatch.matchBase || {};
        const matchInfo = state.worldCupMatch.matchInfo || {};

        // 收集四个分类的视频
        const categories = {
            '全场回放': [],
            '全场集锦': [],
            '战报': [],
            '高光时刻': []
        };

        // 1. 全场回放 - liveInfo.replayNoteId
        const liveInfo = matchBase.liveInfo || {};
        if (liveInfo.replayNoteId) {
            const videoUrl = await getNoteVideo720P(liveInfo.replayNoteId, liveInfo.xsecToken || '');
            if (videoUrl) {
                categories['全场回放'].push({
                    name: '官方全场回放',
                    url: videoUrl,
                    noteId: liveInfo.replayNoteId
                });
            }
        }

        // 2. 战报 - reportList
        const reportList = matchInfo.reportList || [];
        for (const item of reportList) {
            if (item.type === 'video' && item.noteId) {
                const cat = getVideoCategory(item.title);
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    if (cat === '全场集锦') {
                        categories['全场集锦'].push({
                            name: item.title || '集锦',
                            url: videoUrl,
                            noteId: item.noteId
                        });
                    } else {
                        categories['战报'].push({
                            name: item.title || '战报',
                            url: videoUrl,
                            noteId: item.noteId
                        });
                    }
                }
            }
        }

        // 3. 高光时刻 - highList
        const highList = matchInfo.highList || [];
        for (const item of highList) {
            if (item.type === 'video' && item.noteId) {
                const cat = getVideoCategory(item.title);
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    if (cat === '全场集锦') {
                        categories['全场集锦'].push({
                            name: item.title || '集锦',
                            url: videoUrl,
                            noteId: item.noteId
                        });
                    } else {
                        categories['高光时刻'].push({
                            name: item.title || '高光',
                            url: videoUrl,
                            noteId: item.noteId
                        });
                    }
                }
            }
        }

        // 构建 TVBOX 播放格式
        // 使用 $$$ 分隔不同分类
        const playFrom = [];
        const playUrl = [];

        for (const [catName, videos] of Object.entries(categories)) {
            if (videos.length > 0) {
                playFrom.push(catName);
                playUrl.push(videos.map(v => v.name + '$' + v.url).join('#'));
            }
        }

        if (playFrom.length === 0) {
            playFrom.push('暂无视频');
            playUrl.push('暂无$https://www.baidu.com');
        }

        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: (matchBase.homeTeamName || '') + ' vs ' + (matchBase.awayTeamName || ''),
                vod_pic: matchBase.homeTeamLogo || '',
                vod_remarks: matchBase.statusDesc || '',
                vod_content: (matchBase.homeTeamName || '') + ' ' + (matchBase.homeScore || '0') + 
                            ' - ' + (matchBase.awayScore || '0') + ' ' + (matchBase.awayTeamName || '') +
                            '\n\n全场回放: ' + categories['全场回放'].length + ' 个' +
                            '\n全场集锦: ' + categories['全场集锦'].length + ' 个' +
                            '\n战报: ' + categories['战报'].length + ' 个' +
                            '\n高光时刻: ' + categories['高光时刻'].length + ' 个',
                vod_play_from: playFrom.join('$$$'),
                vod_play_url: playUrl.join('$$$')
            }]
        });

    } catch (e) {
        return JSON.stringify({ list: [] });
    }
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
