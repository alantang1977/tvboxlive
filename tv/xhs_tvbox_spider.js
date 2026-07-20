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

// ========== 视频提取核心函数 ==========

async function extractVideoStreams(noteId, xsecToken) {
    let noteUrl = host + '/explore/' + noteId;
    if (xsecToken) {
        noteUrl += '?xsec_token=' + encodeURIComponent(xsecToken) + '&xsec_source=pc_stab';
    }

    try {
        const r = await req(noteUrl, { headers });
        if (!r || !r.content) return [];

        const state = extractState(r.content);
        if (!state) return [];

        const noteData = state.note?.noteDetailMap?.[noteId]?.note || {};
        const videoData = noteData.video || {};

        let allStreams = [];

        // 1. 从 media.stream 提取
        const media = videoData.media || {};
        const stream = media.stream || {};
        const codecs = ['h264', 'h265', 'av1', 'h266'];

        for (const codec of codecs) {
            if (stream[codec] && Array.isArray(stream[codec])) {
                for (const s of stream[codec]) {
                    const url = s.masterUrl || (s.backupUrls && s.backupUrls[0]) || '';
                    if (url) {
                        allStreams.push({
                            source: 'media',
                            codec: codec,
                            url: url,
                            width: s.width || 0,
                            height: s.height || 0,
                            quality: s.qualityType || ''
                        });
                    }
                }
            }
        }

        // 2. 从 mediaV2.stream 提取
        const mediaV2Str = videoData.mediaV2 || '';
        if (typeof mediaV2Str === 'string' && mediaV2Str.length > 0) {
            try {
                const mediaV2 = JSON.parse(mediaV2Str);
                if (mediaV2 && mediaV2.stream) {
                    const v2Stream = mediaV2.stream;
                    for (const codec of codecs) {
                        if (v2Stream[codec] && Array.isArray(v2Stream[codec])) {
                            for (const s of v2Stream[codec]) {
                                const url = s.master_url || (s.backup_urls && s.backup_urls[0]) || '';
                                if (url) {
                                    allStreams.push({
                                        source: 'mediaV2',
                                        codec: codec,
                                        url: url,
                                        width: s.width || 0,
                                        height: s.height || 0,
                                        quality: s.quality_type || ''
                                    });
                                }
                            }
                        }
                    }

                    // 从 mediaV2.video.opaque1 提取投屏流
                    if (mediaV2.video && mediaV2.video.opaque1) {
                        const opaque1 = mediaV2.video.opaque1;
                        for (const key of ['hd_screencast_stream', 'default_screencast_stream']) {
                            if (opaque1[key] && typeof opaque1[key] === 'string') {
                                allStreams.push({
                                    source: 'mediaV2.opaque1',
                                    codec: 'unknown',
                                    url: opaque1[key],
                                    width: 0,
                                    height: 0,
                                    quality: key
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
        const unique = [];
        for (const s of allStreams) {
            const base = s.url.split('?')[0];
            if (!seen.has(base)) {
                seen.add(base);
                unique.push(s);
            }
        }

        return unique;

    } catch(e) {
        return [];
    }
}

// 筛选720P视频
function select720P(streams) {
    if (!streams || streams.length === 0) return null;

    // 1. 优先精确匹配 1280x720
    const exact720 = streams.find(s => s.width === 1280 && s.height === 720);
    if (exact720) return exact720.url;

    // 2. 找接近720P的 (高度 600-900)
    const near720 = streams.filter(s => s.height >= 600 && s.height <= 900);
    if (near720.length > 0) {
        near720.sort((a, b) => b.height - a.height);
        return near720[0].url;
    }

    // 3. 返回最低清晰度
    const sorted = [...streams].sort((a, b) => (a.width * a.height) - (b.width * b.height));
    return sorted[0].url;
}

// ========== 数据缓存 ==========
let matchesCache = null;

async function getAllMatches() {
    if (matchesCache) return matchesCache;

    const r = await req(host + '/worldcup26', { headers });
    if (!r || !r.content) return null;

    const state = extractState(r.content);
    if (!state || !state.worldCupMatchSchedule || !state.worldCupMatchSchedule.data) return null;

    const matches = state.worldCupMatchSchedule.data.matches || [];
    matchesCache = matches;
    return matches;
}

async function getMatchById(matchId) {
    const matches = await getAllMatches();
    if (!matches) return null;

    const item = matches.find(m => m.match && m.match.matchId == matchId);
    return item ? item.match : null;
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
    // 只显示有回放的前10场比赛
    const matches = await getAllMatches();
    if (!matches || matches.length === 0) {
        return JSON.stringify({ list: [] });
    }

    // 筛选有 replayNoteId 的比赛，并取前10个
    const matchesWithReplay = [];
    for (const item of matches) {
        const match = item.match;
        if (!match) continue;
        if (match.liveInfo && match.liveInfo.replayNoteId) {
            matchesWithReplay.push(item);
        }
    }

    // 取前10个
    const top10 = matchesWithReplay.slice(0, 10);

    const list = [];
    for (const item of top10) {
        const match = item.match;
        const matchId = match.matchId || '';
        const homeTeam = match.homeTeamName || '';
        const awayTeam = match.awayTeamName || '';
        const homeScore = match.homeScore ?? '';
        const awayScore = match.awayScore ?? '';
        const status = match.statusDesc || '';
        const round = match.roundStage || '';
        const dateLabel = item.dateLabel || '';

        let bgPic = '';
        if (match.liveInfo && match.liveInfo.cover) {
            bgPic = match.liveInfo.cover;
        } else if (match.homeTeamLogo) {
            bgPic = match.homeTeamLogo;
        } else if (match.awayTeamLogo) {
            bgPic = match.awayTeamLogo;
        }

        let title = homeTeam + ' vs ' + awayTeam;
        if (homeScore !== '' && awayScore !== '') {
            title += ' ' + homeScore + '-' + awayScore;
        }

        let subTitle = round;
        if (dateLabel) subTitle += ' | ' + dateLabel;
        if (status) subTitle += ' | ' + status;

        list.push({
            vod_id: String(matchId),
            vod_name: title,
            vod_pic: bgPic,
            vod_remarks: subTitle,
            vod_content: homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam + '\n' +
                        '阶段: ' + round + '\n' +
                        '时间: ' + dateLabel + '\n' +
                        '状态: ' + status
        });
    }

    return JSON.stringify({ list: list });
}

async function category(tid, pg, filter, extend) {
    const matches = await getAllMatches();
    if (!matches || matches.length === 0) {
        return JSON.stringify({ list: [] });
    }

    const list = [];
    const categoryNames = {
        'replay': '全场回放',
        'highlight': '全场集锦',
        'report': '战报',
        'high': '高光时刻'
    };

    for (const item of matches) {
        const match = item.match;
        if (!match) continue;

        const matchId = match.matchId || '';
        const homeTeam = match.homeTeamName || '';
        const awayTeam = match.awayTeamName || '';
        const homeScore = match.homeScore ?? '';
        const awayScore = match.awayScore ?? '';
        const status = match.statusDesc || '';
        const round = match.roundStage || '';

        let bgPic = '';
        if (match.liveInfo && match.liveInfo.cover) {
            bgPic = match.liveInfo.cover;
        } else if (match.homeTeamLogo) {
            bgPic = match.homeTeamLogo;
        } else if (match.awayTeamLogo) {
            bgPic = match.awayTeamLogo;
        }

        let title = homeTeam + ' vs ' + awayTeam;
        if (homeScore !== '' && awayScore !== '') {
            title += ' ' + homeScore + '-' + awayScore;
        }

        list.push({
            vod_id: String(matchId) + '#' + tid,
            vod_name: title,
            vod_pic: bgPic,
            vod_remarks: (categoryNames[tid] || tid) + ' | ' + status,
            vod_content: '分类: ' + (categoryNames[tid] || tid) + '\n' +
                        homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam + '\n' +
                        '阶段: ' + round + '\n' +
                        '状态: ' + status
        });
    }

    return JSON.stringify({ list: list });
}

async function detail(id) {
    let matchId = id;
    let category = 'replay';

    if (id.indexOf('#') !== -1) {
        const parts = id.split('#');
        matchId = parts[0];
        category = parts[1];
    }

    const categoryNames = {
        'replay': '全场回放',
        'highlight': '全场集锦',
        'report': '战报',
        'high': '高光时刻'
    };

    const match = await getMatchById(matchId);
    if (!match) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: '比赛未找到: ' + matchId,
                vod_pic: '',
                vod_remarks: '',
                vod_content: 'ID: ' + id,
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }

    const homeTeam = match.homeTeamName || '';
    const awayTeam = match.awayTeamName || '';
    const homeScore = match.homeScore ?? '';
    const awayScore = match.awayScore ?? '';
    const round = match.roundStage || '';
    const status = match.statusDesc || '';
    const group = match.groupLabel || '';
    const dateLabel = match.dateLabel || '';

    let bgPic = '';
    if (match.liveInfo && match.liveInfo.cover) {
        bgPic = match.liveInfo.cover;
    } else if (match.homeTeamLogo) {
        bgPic = match.homeTeamLogo;
    }

    // 提取真实视频
    const videos = [];
    const matchInfo = match.matchInfo || {};

    if (category === 'replay') {
        // 全场回放
        if (match.liveInfo && match.liveInfo.replayNoteId) {
            const streams = await extractVideoStreams(match.liveInfo.replayNoteId, match.liveInfo.xsecToken || '');
            const url720 = select720P(streams);
            if (url720) {
                videos.push('官方全场回放$' + url720);
            } else {
                videos.push('官方全场回放(暂无视频)$https://www.baidu.com');
            }
        } else {
            videos.push('暂无回放$https://www.baidu.com');
        }
    } else if (category === 'highlight') {
        // 全场集锦 - 从 reportList 和 highList 筛选标题含"集锦"的
        const allItems = [];

        const reportList = matchInfo.reportList || [];
        for (const item of reportList) {
            if (item.type === 'video' && item.title && (item.title.indexOf('集锦') !== -1 || item.title.indexOf('高光') !== -1)) {
                allItems.push(item);
            }
        }

        const highList = matchInfo.highList || [];
        for (const item of highList) {
            if (item.type === 'video' && item.title && (item.title.indexOf('集锦') !== -1 || item.title.indexOf('高光') !== -1)) {
                allItems.push(item);
            }
        }

        // 倒序显示
        allItems.reverse();

        for (let i = 0; i < allItems.length; i++) {
            const item = allItems[i];
            const streams = await extractVideoStreams(item.noteId, item.xsecToken || '');
            const url720 = select720P(streams);
            if (url720) {
                videos.push((item.title || '集锦' + (i + 1)) + '$' + url720);
            }
        }

        if (videos.length === 0) {
            videos.push('暂无集锦$https://www.baidu.com');
        }
    } else if (category === 'report') {
        // 战报 - reportList 中所有 video
        const reportList = matchInfo.reportList || [];

        // 倒序显示
        const reversedList = [...reportList].reverse();

        for (let i = 0; i < reversedList.length; i++) {
            const item = reversedList[i];
            if (item.type === 'video' && item.noteId) {
                const streams = await extractVideoStreams(item.noteId, item.xsecToken || '');
                const url720 = select720P(streams);
                if (url720) {
                    videos.push((item.title || '战报' + (i + 1)) + '$' + url720);
                }
            }
        }
        if (videos.length === 0) {
            videos.push('暂无战报$https://www.baidu.com');
        }
    } else if (category === 'high') {
        // 高光时刻 - highList 中所有 video
        const highList = matchInfo.highList || [];

        // 倒序显示
        const reversedList = [...highList].reverse();

        for (let i = 0; i < reversedList.length; i++) {
            const item = reversedList[i];
            if (item.type === 'video' && item.noteId) {
                const streams = await extractVideoStreams(item.noteId, item.xsecToken || '');
                const url720 = select720P(streams);
                if (url720) {
                    videos.push((item.title || '高光' + (i + 1)) + '$' + url720);
                }
            }
        }
        if (videos.length === 0) {
            videos.push('暂无高光$https://www.baidu.com');
        }
    }

    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: homeTeam + ' vs ' + awayTeam + ' [' + (categoryNames[category] || category) + ']',
            vod_pic: bgPic,
            vod_remarks: status,
            vod_content: homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam + '\n' +
                        '阶段: ' + round + '\n' +
                        (group ? '小组: ' + group + '\n' : '') +
                        '时间: ' + dateLabel + '\n' +
                        '状态: ' + status,
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
