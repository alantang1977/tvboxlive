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
    if (!title) return 'other';
    if (title.indexOf('回放') !== -1 || title.indexOf('全场') !== -1) return 'replay';
    if (title.indexOf('集锦') !== -1 || title.indexOf('高光') !== -1) return 'highlight';
    return 'other';
}

// ========== TVBOX 接口 ==========

async function init(cfg) {}

// 首页 - 固定四个分类
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

// 首页视频 - 请求 /worldcup26 获取所有比赛卡片
async function homeVod() {
    try {
        const r = await req(host + '/worldcup26', { headers });
        if (!r || !r.content) {
            return JSON.stringify({ list: [] });
        }

        const state = extractState(r.content);
        if (!state || !state.worldCupMatch || !state.worldCupMatch.matches) {
            return JSON.stringify({ list: [] });
        }

        const matches = state.worldCupMatch.matches;
        const videos = [];

        for (const match of matches) {
            const matchId = match.matchId || '';
            const homeTeam = match.homeTeamName || '';
            const awayTeam = match.awayTeamName || '';
            const homeScore = match.homeScore !== undefined ? match.homeScore : '-';
            const awayScore = match.awayScore !== undefined ? match.awayScore : '-';
            const status = match.statusDesc || '';
            const round = match.roundStage || '';
            const matchTime = match.matchTime || '';

            // 背景图：优先使用 homeTeamBg 或 awayTeamBg，否则用球队logo
            let bgPic = match.homeTeamBg || match.awayTeamBg || match.homeTeamLogo || match.awayTeamLogo || '';

            videos.push({
                vod_id: matchId,
                vod_name: homeTeam + ' vs ' + awayTeam,
                vod_pic: bgPic,
                vod_remarks: status + ' | ' + homeScore + '-' + awayScore,
                vod_content: round + ' | ' + matchTime
            });
        }

        return JSON.stringify({ list: videos });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

// 分类内容 - 显示某分类下的所有比赛（带分类标记）
async function category(tid, pg, filter, extend) {
    // tid: replay, highlight, report, high
    // 返回所有比赛，但标记该分类下的视频数量

    try {
        const r = await req(host + '/worldcup26', { headers });
        if (!r || !r.content) {
            return JSON.stringify({ list: [] });
        }

        const state = extractState(r.content);
        if (!state || !state.worldCupMatch || !state.worldCupMatch.matches) {
            return JSON.stringify({ list: [] });
        }

        const matches = state.worldCupMatch.matches;
        const videos = [];

        for (const match of matches) {
            const matchId = match.matchId || '';
            const homeTeam = match.homeTeamName || '';
            const awayTeam = match.awayTeamName || '';
            const homeScore = match.homeScore !== undefined ? match.homeScore : '-';
            const awayScore = match.awayScore !== undefined ? match.awayScore : '-';
            const status = match.statusDesc || '';
            const round = match.roundStage || '';

            let bgPic = match.homeTeamBg || match.awayTeamBg || match.homeTeamLogo || match.awayTeamLogo || '';

            // 计算该分类下的视频数量
            let videoCount = 0;
            const matchInfo = match.matchInfo || {};

            if (tid === 'replay') {
                const liveInfo = match.liveInfo || {};
                if (liveInfo.replayNoteId) videoCount = 1;
            } else if (tid === 'highlight') {
                const reportList = matchInfo.reportList || [];
                const highList = matchInfo.highList || [];
                for (const item of reportList) {
                    if (item.type === 'video' && getVideoCategory(item.title) === 'highlight') videoCount++;
                }
                for (const item of highList) {
                    if (item.type === 'video' && getVideoCategory(item.title) === 'highlight') videoCount++;
                }
            } else if (tid === 'report') {
                const reportList = matchInfo.reportList || [];
                for (const item of reportList) {
                    if (item.type === 'video') videoCount++;
                }
            } else if (tid === 'high') {
                const highList = matchInfo.highList || [];
                for (const item of highList) {
                    if (item.type === 'video') videoCount++;
                }
            }

            videos.push({
                vod_id: matchId + '_' + tid,
                vod_name: homeTeam + ' vs ' + awayTeam,
                vod_pic: bgPic,
                vod_remarks: status + ' | ' + homeScore + '-' + awayScore + ' | ' + videoCount + '个视频',
                vod_content: round + ' | ' + (match.matchTime || '')
            });
        }

        return JSON.stringify({ list: videos });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

// 详情页 - 提取对应比赛的指定分类视频
async function detail(id) {
    // id 格式: matchId_category
    // 例如: 4459814_replay, 4459814_highlight, 4459814_report, 4459814_high

    const parts = id.split('_');
    if (parts.length < 2) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: 'ID格式错误',
                vod_pic: '',
                vod_remarks: '',
                vod_content: 'ID格式应为: matchId_category',
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }

    const matchId = parts[0];
    const category = parts[1];

    const matchUrl = host + '/worldcup26/match/' + matchId + '?wcup_source=web_main_venue_page';

    try {
        const r = await req(matchUrl, { headers });
        if (!r || !r.content) {
            return JSON.stringify({
                list: [{
                    vod_id: id,
                    vod_name: '请求失败',
                    vod_pic: '',
                    vod_remarks: '',
                    vod_content: '无法获取比赛页面',
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const state = extractState(r.content);
        if (!state) {
            return JSON.stringify({
                list: [{
                    vod_id: id,
                    vod_name: '解析失败',
                    vod_pic: '',
                    vod_remarks: '',
                    vod_content: '无法解析页面数据',
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        const homeTeam = matchBase.homeTeamName || '未知';
        const awayTeam = matchBase.awayTeamName || '未知';
        const homeScore = matchBase.homeScore !== undefined ? matchBase.homeScore : '0';
        const awayScore = matchBase.awayScore !== undefined ? matchBase.awayScore : '0';

        // 根据分类提取视频
        const videos = [];

        if (category === 'replay') {
            // 全场回放
            const liveInfo = matchBase.liveInfo || {};
            if (liveInfo.replayNoteId) {
                const videoUrl = await getNoteVideo720P(liveInfo.replayNoteId, liveInfo.xsecToken || '');
                if (videoUrl) {
                    videos.push('官方全场回放$' + videoUrl);
                } else {
                    videos.push('官方全场回放$' + liveInfo.replayNoteId);
                }
            }
        } else if (category === 'highlight') {
            // 全场集锦 - reportList + highList 中标题含"集锦"的
            const allItems = [];

            const reportList = matchInfo.reportList || [];
            for (const item of reportList) {
                if (item.type === 'video' && getVideoCategory(item.title) === 'highlight') {
                    allItems.push(item);
                }
            }

            const highList = matchInfo.highList || [];
            for (const item of highList) {
                if (item.type === 'video' && getVideoCategory(item.title) === 'highlight') {
                    allItems.push(item);
                }
            }

            for (let i = 0; i < allItems.length; i++) {
                const item = allItems[i];
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '集锦' + (i + 1)) + '$' + videoUrl);
                }
            }
        } else if (category === 'report') {
            // 战报 - reportList 中所有 video
            const reportList = matchInfo.reportList || [];
            for (let i = 0; i < reportList.length; i++) {
                const item = reportList[i];
                if (item.type === 'video') {
                    const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                    if (videoUrl) {
                        videos.push((item.title || '战报' + (i + 1)) + '$' + videoUrl);
                    }
                }
            }
        } else if (category === 'high') {
            // 高光时刻 - highList 中所有 video
            const highList = matchInfo.highList || [];
            for (let i = 0; i < highList.length; i++) {
                const item = highList[i];
                if (item.type === 'video') {
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

        const categoryNames = {
            'replay': '全场回放',
            'highlight': '全场集锦',
            'report': '战报',
            'high': '高光时刻'
        };

        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: homeTeam + ' vs ' + awayTeam + ' - ' + (categoryNames[category] || category),
                vod_pic: matchBase.homeTeamBg || matchBase.awayTeamBg || matchBase.homeTeamLogo || '',
                vod_remarks: matchBase.statusDesc || '',
                vod_content: homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam,
                vod_play_from: '小红书',
                vod_play_url: videos.join('#')
            }]
        });

    } catch (e) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: '异常: ' + e.message,
                vod_pic: '',
                vod_remarks: '',
                vod_content: e.toString(),
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }
}

async function search(wd, quick, pg) {
    return JSON.stringify({ page: pg, list: [] });
}

async function play(flag, id, flags) {
    // id 是视频URL（已在detail中解析为720P地址）
    if (id && id.indexOf('http') === 0) {
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

    // 如果是笔记ID，尝试获取视频地址
    if (id && id.match(/^[a-f0-9]{24}$/i)) {
        const videoUrl = await getNoteVideo720P(id, '');
        if (videoUrl) {
            return JSON.stringify({
                parse: 0,
                url: videoUrl,
                header: {
                    'User-Agent': headers['User-Agent'],
                    'Referer': 'https://www.xiaohongshu.com/',
                    'Origin': 'https://www.xiaohongshu.com'
                }
            });
        }
    }

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
